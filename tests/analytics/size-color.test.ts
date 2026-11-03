import { inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/analytics/size-color/route';
import { getDb } from '@/db/client';
import { variants } from '@/db/schema';
import { sizeColor, sortSizes } from '@/analytics/size-color';
import { EXPECTED, analyticsFixture } from '../helpers/analytics';
import { call } from '../helpers/http';
import { sessionCookieFor } from '../helpers/users';

describe('sortSizes', () => {
  it('orders apparel sizes, then numeric ascending, then the rest alphabetically', () => {
    expect(sortSizes(['XL', '10', 'S', 'One size', '8', 'XS', 'XXL', 'M', 'L', 'Free'])).toEqual([
      'XS', 'S', 'M', 'L', 'XL', 'XXL', '8', '10', 'Free', 'One size',
    ]);
  });
});

describe('size × colour matrix', () => {
  it('gives stock on hand and net units sold for every size × colour', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const m = await sizeColor(db, { ...EXPECTED.range });
    const vs = await db.select().from(variants).where(inArray(variants.id, [fx.n1.id, fx.n2.id, fx.c1.id]));
    const qty = (id: string) => Math.max(0, vs.find((v) => v.id === id)!.quantity);

    expect(m.sizes).toEqual(['S', 'M']);
    expect(m.colors).toEqual([{ name: 'Black', hex: '#111111' }, { name: 'White', hex: '#FAFAFA' }]);
    expect(m.cells).toEqual([
      { size: 'S', color: 'Black', qty: qty(fx.n1.id), sold: 2 },
      { size: 'S', color: 'White', qty: qty(fx.c1.id), sold: 2 },
      { size: 'M', color: 'Black', qty: qty(fx.n2.id), sold: 1 },
      { size: 'M', color: 'White', qty: 0, sold: 0 },
    ]);
  });

  it('filters by brand', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const m = await sizeColor(db, { brandId: fx.brandC.id, ...EXPECTED.range });
    expect(m.sizes).toEqual(['S']);
    expect(m.colors).toEqual([{ name: 'White', hex: '#FAFAFA' }]);
    expect(m.cells).toEqual([{ size: 'S', color: 'White', qty: expect.any(Number), sold: 2 }]);
  });

  it('GET /analytics/size-color: manager 200 (range optional), seller 403, only `from` → 400', async () => {
    const db = getDb();
    const fx = await analyticsFixture(db);
    const manager = await sessionCookieFor(db, fx.manager.id);
    const ok = await call(GET, { path: `/api/v1/analytics/size-color?from=${EXPECTED.range.from}&to=${EXPECTED.range.to}`, cookie: manager });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toBe('private, max-age=60');
    expect((await ok.json()).sizes).toEqual(['S', 'M']);

    const defaults = await call(GET, { path: '/api/v1/analytics/size-color', cookie: manager });
    expect(defaults.status).toBe(200);
    expect((await defaults.json()).cells.every((c: { sold: number }) => c.sold === 0)).toBe(true);

    const seller = await sessionCookieFor(db, fx.sellerA.id);
    expect((await call(GET, { path: '/api/v1/analytics/size-color', cookie: seller })).status).toBe(403);
    expect((await call(GET, { path: `/api/v1/analytics/size-color?from=${EXPECTED.range.from}`, cookie: manager })).status).toBe(400);
  });
});
