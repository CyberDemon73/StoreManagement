import { and, asc, count, eq, gt, lte, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { parkedSales, type ParkedSaleRow } from '@/db/schema';
import type { AuthUser } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import type { ParkInput } from '@/schemas/sales';
import type { ParkedSaleOut } from '@/serializers/sales';

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PARKED = 3;

function toOut(row: ParkedSaleRow): ParkedSaleOut {
  return { id: row.id, cart: row.payload, parkedAt: row.createdAt.toISOString(), label: row.label };
}

async function purgeExpired(db: Db, userId: string): Promise<void> {
  await db.delete(parkedSales).where(and(eq(parkedSales.userId, userId), lte(parkedSales.expiresAt, sql`now()`)));
}

export async function listParked(db: Db, user: AuthUser): Promise<ParkedSaleOut[]> {
  await purgeExpired(db, user.id);
  const rows = await db
    .select()
    .from(parkedSales)
    .where(and(eq(parkedSales.userId, user.id), gt(parkedSales.expiresAt, sql`now()`)))
    .orderBy(asc(parkedSales.createdAt), asc(parkedSales.id));
  return rows.map(toOut);
}

export async function parkSale(db: Db, user: AuthUser, input: ParkInput): Promise<ParkedSaleOut> {
  return db.transaction(async (tx) => {
    // Serialise parks per user so concurrent requests cannot exceed the cap.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'parked:' + user.id}))`);
    await purgeExpired(tx, user.id);
    const [active] = await tx.select({ n: count() }).from(parkedSales).where(eq(parkedSales.userId, user.id));
    if ((active?.n ?? 0) >= MAX_PARKED) throw new AppError('CONFLICT', `You can park at most ${MAX_PARKED} sales`);
    const [row] = await tx
      .insert(parkedSales)
      .values({ userId: user.id, label: input.label, payload: input.cart, expiresAt: new Date(Date.now() + TTL_MS) })
      .returning();
    if (!row) throw new Error('parked sale insert failed');
    return toOut(row);
  });
}

export async function unparkSale(db: Db, user: AuthUser, id: string): Promise<ParkedSaleOut> {
  const [row] = await db
    .delete(parkedSales)
    .where(and(eq(parkedSales.id, id), eq(parkedSales.userId, user.id), gt(parkedSales.expiresAt, sql`now()`)))
    .returning();
  if (!row) throw new AppError('NOT_FOUND', 'Parked sale not found');
  return toOut(row);
}
