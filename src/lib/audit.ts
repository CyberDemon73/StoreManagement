import type { Db } from '@/db/client';
import { auditLog } from '@/db/schema';

export interface AuditActor {
  userId: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

const SECRET_KEYS = new Set(['passwordHash', 'password', 'token', 'tokenHash']);

/** Drop credential-bearing keys so the audit trail can never leak a hash or token. */
export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v)) as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.has(k)) continue;
      out[k] = redactSecrets(v);
    }
    return out as T;
  }
  return value;
}

export async function audit(
  db: Db,
  actor: AuditActor,
  action: string,
  entity: string,
  entityId: string | null,
  before: unknown,
  after: unknown,
): Promise<void> {
  await db.insert(auditLog).values({
    userId: actor.userId,
    action,
    entity,
    entityId,
    before: before === undefined ? null : redactSecrets(before),
    after: after === undefined ? null : redactSecrets(after),
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
  });
}
