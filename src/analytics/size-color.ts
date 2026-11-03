import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/db/client';
import { uuidSchema } from '@/schemas/common';
import { getSettings } from '@/services/settings';
import type { SizeColorMatrix } from '@/types';
import { returnLines, saleLines, stockOnHand } from './facts';
import { isoDate, resolveRange } from './range';

/*
 * Size × colour matrix over active variants of ACTIVE products (optionally one brand):
 *   qty  = current on-hand, max(quantity, 0), summed per size × colour name
 *   sold = Σ saleLines.qty − Σ returnLines.qty in the range (default: the last 30 local days ending today)
 * Sizes: XS, S, M, L, XL, XXL, then numeric ascending, then the rest alphabetically.
 * Colours are distinct by name (ordered by name); every size × colour gets a cell, zeros included.
 */

export const sizeColorQuery = z
  .object({ brandId: uuidSchema.optional(), from: isoDate.optional(), to: isoDate.optional() })
  .strict()
  .refine((q) => (q.from === undefined) === (q.to === undefined), { message: 'Give both `from` and `to`, or neither', path: ['to'] });

export type SizeColorQuery = z.infer<typeof sizeColorQuery>;

export const DEFAULT_DAYS = 30;
const APPAREL = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const NUMERIC = /^\d+(\.\d+)?$/;

function sizeKey(s: string): [number, number, string] {
  const i = APPAREL.indexOf(s);
  if (i >= 0) return [0, i, ''];
  if (NUMERIC.test(s)) return [1, Number(s), ''];
  return [2, 0, s];
}

export function sortSizes(sizes: string[]): string[] {
  return [...sizes].sort((a, b) => {
    const ka = sizeKey(a);
    const kb = sizeKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
  });
}

/** Local calendar date in `tz` (YYYY-MM-DD), shifted by `offsetDays`. */
function localDate(tz: string, offsetDays = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const t = Date.parse(`${today}T00:00:00Z`) + offsetDays * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export async function sizeColor(db: Db, q: SizeColorQuery): Promise<SizeColorMatrix> {
  let from = q.from;
  let to = q.to;
  if (!from || !to) {
    const { timezone } = await getSettings(db);
    to = localDate(timezone);
    from = localDate(timezone, -(DEFAULT_DAYS - 1));
  }
  const r = await resolveRange(db, { from, to });
  const brandFilter = q.brandId ? sql`where brand_id = ${q.brandId}` : sql``;
  const res = (await db.execute(sql`
    with sl as (${saleLines(r)}), rl as (${returnLines(r)}),
    soh as (select * from (${stockOnHand()}) x ${brandFilter}),
    sold as (
      select variant_id, sum(qty) as qty from (
        select variant_id, qty from sl union all select variant_id, -qty from rl
      ) f group by variant_id
    )
    select soh.size, soh.color_name, min(soh.color_hex) as color_hex,
           sum(soh.qty)::float8 as qty, coalesce(sum(sold.qty), 0)::float8 as sold
    from soh
    left join sold on sold.variant_id = soh.variant_id
    group by soh.size, soh.color_name`)) as { rows: { size: string; color_name: string; color_hex: string; qty: number; sold: number }[] };

  const sizes = sortSizes([...new Set(res.rows.map((x) => x.size))]);
  const hex = new Map<string, string>();
  for (const x of res.rows) if (!hex.has(x.color_name) || x.color_hex < hex.get(x.color_name)!) hex.set(x.color_name, x.color_hex);
  const colors = [...hex.keys()].sort((a, b) => a.localeCompare(b)).map((name) => ({ name, hex: hex.get(name)! }));
  const byCell = new Map(res.rows.map((x) => [`${x.size}\u0000${x.color_name}`, x]));
  const cells = sizes.flatMap((size) =>
    colors.map((c) => {
      const x = byCell.get(`${size}\u0000${c.name}`);
      return { size, color: c.name, qty: x?.qty ?? 0, sold: x?.sold ?? 0 };
    }),
  );
  return { sizes, colors, cells };
}
