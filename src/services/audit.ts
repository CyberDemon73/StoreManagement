import { count, desc } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { auditLog } from '@/db/schema';
import type { PaginationQuery } from '@/schemas/common';

export interface AuditEntry {
  id: string;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Newest first. Filters (q, userId, entity, action, date range) arrive in Sprint 5. */
export async function listAudit(db: Db, { page, pageSize }: PaginationQuery): Promise<Paginated<AuditEntry>> {
  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(auditLog)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(auditLog),
  ]);
  return {
    data: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    page,
    pageSize,
    total: totalRow?.total ?? 0,
  };
}
