import type { Db } from '@/db/client';
import type { AuthUser } from '@/lib/auth';
import { createSale } from '@/services/sales';
import type { SaleOut } from '@/serializers/sales';
import { stockFixture, type StockFixture } from './stock';
import { createUser, type CreatedUser } from './users';

export interface SaleFixture extends StockFixture {
  seller: CreatedUser;
  manager: CreatedUser;
  /** COMPLETED sale by `seller`: A×2 @1000 + B×1 @1000, no discount, CASH → subtotal 3000. */
  sale: SaleOut;
}

export function authUserOf(u: CreatedUser, name: string = u.role): AuthUser {
  return { id: u.id, name, email: u.email, role: u.role, status: 'ACTIVE', mustChangePassword: false, sessionId: 'test-session' };
}

const CTX = { ip: '203.0.113.10', userAgent: 'vitest', requestId: 'test' };

/** Stock fixture (A 10, B 5, C 0) plus a seller, a manager and one completed sale. */
export async function saleFixture(db: Db): Promise<SaleFixture> {
  const seller = await createUser(db, { role: 'SELLER', name: 'Sam' });
  const manager = await createUser(db, { role: 'MANAGER', name: 'Mona' });
  const fx = await stockFixture(db, manager.id);
  const [a, b] = fx.variants;
  const sale = await createSale(
    db,
    authUserOf(seller, 'Sam'),
    { items: [{ variantId: a.id, qty: 2 }, { variantId: b.id, qty: 1 }], paymentMethod: 'CASH' },
    CTX,
  );
  return { ...fx, seller, manager, sale };
}
