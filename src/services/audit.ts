import { and, count, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/db/client';
import { auditLog, users } from '@/db/schema';
import { isoDate, localDayBounds } from '@/analytics/range';
import { paginationQuery } from '@/schemas/common';
import { escapeLike } from './products-list';

/** Frontend `AuditEntry`; optional keys are omitted when the column is null. */
export interface AuditEntry {
  id: string;
  userId?: string;
  userName: string;
  action: string;
  entity: string;
  entityId?: string;
  entityLabel: string;
  summary: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  createdAt: string;
}

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

// An empty `?q=` from a cleared search box means "no filter", not a validation error.
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optional = <T extends z.ZodType>(s: T) => z.preprocess(blankToUndefined, s.optional());

export const auditQuery = paginationQuery
  .extend({
    q: optional(z.string().trim().max(100)),
    userId: optional(z.string().uuid()),
    entity: optional(z.string().trim().max(50)),
    action: optional(z.string().trim().max(100)),
    from: optional(isoDate),
    to: optional(isoDate),
  })
  .strict();
export type AuditQuery = z.infer<typeof auditQuery>;

const LABEL_KEYS = ['number', 'name', 'sku', 'email'] as const;

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function labelOf(before: Record<string, unknown> | null, after: Record<string, unknown> | null, entityId: string | null, entity: string): string {
  for (const src of [after, before]) {
    if (!src) continue;
    for (const k of LABEL_KEYS) {
      const v = src[k];
      if ((typeof v === 'string' && v !== '') || typeof v === 'number') return String(v);
    }
  }
  return entityId ? entityId.slice(0, 8) : entity;
}

function summaryOf(action: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null): string {
  if (!before || !after) return action;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changed = keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  return changed.length ? `${action}: ${changed.join(', ')}` : action;
}

/** Newest first, filtered by free text, actor, entity, action and store-local day range. */
export async function listAudit(db: Db, query: AuditQuery): Promise<Paginated<AuditEntry>> {
  const { page, pageSize, q, userId, entity, action, from, to } = query;
  const where: SQL[] = [];
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(sql`(${auditLog.action} ilike ${like} escape '\\'
      or ${auditLog.entity} ilike ${like} escape '\\'
      or ${auditLog.entityId}::text ilike ${like} escape '\\')`);
  }
  if (userId) where.push(eq(auditLog.userId, userId));
  if (entity) where.push(eq(auditLog.entity, entity));
  if (action) where.push(eq(auditLog.action, action));
  const { start, end } = await localDayBounds(db, from, to);
  if (start) where.push(gte(auditLog.createdAt, start));
  if (end) where.push(lt(auditLog.createdAt, end));
  const cond = where.length ? and(...where) : undefined;

  const [rows, [totalRow]] = await Promise.all([
    db
      .select({ log: auditLog, userName: users.name })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .where(cond)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(auditLog).where(cond),
  ]);

  const data = rows.map(({ log, userName }): AuditEntry => {
    const before = asObject(log.before);
    const after = asObject(log.after);
    const entry: AuditEntry = {
      id: log.id,
      userName: userName ?? 'System',
      action: log.action,
      entity: log.entity,
      entityLabel: labelOf(before, after, log.entityId, log.entity),
      summary: summaryOf(log.action, before, after),
      createdAt: log.createdAt.toISOString(),
    };
    if (log.userId) entry.userId = log.userId;
    if (log.entityId) entry.entityId = log.entityId;
    if (before) entry.before = before;
    if (after) entry.after = after;
    if (log.ip) entry.ip = log.ip;
    if (log.userAgent) entry.userAgent = log.userAgent;
    return entry;
  });

  return { data, page, pageSize, total: totalRow?.total ?? 0 };
}
