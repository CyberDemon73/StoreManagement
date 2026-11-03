/**
 * Deterministic mock dataset. Generated once per page load from a seeded PRNG so the
 * numbers are stable between renders but dates are relative to "now".
 *
 * Invariant kept here and asserted by the store: variant.quantity === Σ movement.qtyDelta.
 */
import type {
  AuditEntry, Brand, Category, ColorRef, MovementType, Notification, ParkedSale, PaymentMethod,
  Product, Purchase, Return, Sale, SaleItem, Settings, StockCount, StockMovement, Supplier, User, Variant,
} from '@/types';

/* ---------- PRNG ---------- */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261102);
const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)] as T;
const chance = (p: number) => rnd() < p;

const DAY = 86_400_000;
const NOW = new Date();
const todayStart = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate()).getTime();
const daysAgo = (d: number, hour = 10, minute = 0) => new Date(todayStart - d * DAY + hour * 3_600_000 + minute * 60_000).toISOString();

let idCounter = 1000;
const uid = (prefix: string) => `${prefix}_${(idCounter++).toString(36)}`;

/* ---------- Users ---------- */
export const users: User[] = [
  { id: 'u_omar', name: 'Omar Mansour', email: 'omar@avenue.eg', role: 'ADMIN', roles: ['ADMIN'], status: 'ACTIVE', lastLoginAt: daysAgo(0, 18, 40), lastDevice: 'iPhone · Safari', sessions: 2 },
  { id: 'u_salma', name: 'Salma Fawzy', email: 'salma@avenue.eg', role: 'MANAGER', roles: ['MANAGER'], status: 'ACTIVE', lastLoginAt: daysAgo(0, 9, 12), lastDevice: 'iPad · Safari', sessions: 1 },
  { id: 'u_nour', name: 'Nour Adel', email: 'nour@avenue.eg', role: 'SELLER', roles: ['SELLER', 'MANAGER'], status: 'ACTIVE', lastLoginAt: daysAgo(0, 18, 58), lastDevice: 'iPad · Safari', sessions: 1 },
  { id: 'u_karim', name: 'Karim Samir', email: 'karim@avenue.eg', role: 'SELLER', roles: ['SELLER'], status: 'INVITED', sessions: 0 },
  { id: 'u_hana', name: 'Hana Tarek', email: 'hana@avenue.eg', role: 'SELLER', roles: ['SELLER'], status: 'DISABLED', lastLoginAt: daysAgo(49, 14, 3), lastDevice: 'Android · Chrome', sessions: 0 },
];
const userName = (id: string) => users.find((u) => u.id === id)?.name ?? 'System';

/* ---------- Catalog ---------- */
export const brands: Brand[] = [
  { id: 'b_northline', name: 'Northline', isActive: true },
  { id: 'b_casalino', name: 'Casa Lino', isActive: true },
  { id: 'b_dunekids', name: 'Dune Kids', isActive: true },
];

export const categories: Category[] = [
  { id: 'c_shirts', name: 'Shirts', isActive: true },
  { id: 'c_trousers', name: 'Trousers', isActive: true },
  { id: 'c_tees', name: 'T-shirts', isActive: true },
  { id: 'c_outerwear', name: 'Outerwear', isActive: true },
  { id: 'c_shoes', name: 'Shoes', isActive: true },
  { id: 'c_kids', name: 'Kids', isActive: true },
  { id: 'c_accessories', name: 'Accessories', isActive: false },
];

export const suppliers: Supplier[] = [
  { id: 's_northline', name: 'Northline Trading Co.', phone: '+20 2 2735 0012', notes: 'Net 30. Contact: Hossam.', isActive: true },
  { id: 's_casalino', name: 'Casa Lino Import', phone: '+20 10 0442 1180', notes: 'Pays in EUR. Lead time 3 weeks.', isActive: true },
  { id: 's_dune', name: 'Dune Kids Wholesale', phone: '+20 12 8800 5522', isActive: true },
  { id: 's_pack', name: 'Cairo Packaging', notes: 'Bags & boxes · not a stock supplier', isActive: true },
];

export const COLORS: Record<string, ColorRef> = {
  Black: { name: 'Black', hex: '#1F2421' },
  White: { name: 'White', hex: '#FFFFFF' },
  Sand: { name: 'Sand', hex: '#C8B89A' },
  Navy: { name: 'Navy', hex: '#3B4A6B' },
  Olive: { name: 'Olive', hex: '#6B7A4A' },
  Clay: { name: 'Clay', hex: '#B04A3F' },
  Mauve: { name: 'Mauve', hex: '#B89AA6' },
  Sage: { name: 'Sage', hex: '#8E9B8A' },
  Charcoal: { name: 'Charcoal', hex: '#6B6259' },
  Blue: { name: 'Blue', hex: '#7A8BA5' },
  Brown: { name: 'Brown', hex: '#5A4634' },
  Cream: { name: 'Cream', hex: '#F0EBE0' },
};
const C = (...names: string[]) => names.map((n) => COLORS[n] as ColorRef);

const SIZES = {
  apparel: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  trousers: ['28', '30', '32', '34', '36', '38'],
  shoes: ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45'],
  kids: ['2', '4', '6', '8', '10', '12', '14'],
  one: ['One size'],
};

interface ProductSeed { name: string; brand: string; cat: string; sku: string; price: number; cost: number; sizes: string[]; colors: ColorRef[]; tags: string[]; desc: string; tint: string }
const seeds: ProductSeed[] = [
  { name: 'Linen Shirt Relaxed', brand: 'b_northline', cat: 'c_shirts', sku: 'NL-LSR', price: 89000, cost: 42000, sizes: SIZES.apparel.slice(0, 5), colors: C('Black', 'Sand', 'Navy', 'White'), tags: ['linen', 'summer', 'relaxed-fit'], desc: 'Relaxed-fit shirt in 100% European linen. Mother-of-pearl buttons, single chest pocket.', tint: '#DDD5C4' },
  { name: 'Linen Shirt Classic', brand: 'b_northline', cat: 'c_shirts', sku: 'NL-LSC', price: 85000, cost: 40000, sizes: SIZES.apparel.slice(1, 5), colors: C('White', 'Cream'), tags: ['linen'], desc: 'Classic-fit linen shirt.', tint: '#F0EBE0' },
  { name: 'Oxford Shirt', brand: 'b_northline', cat: 'c_shirts', sku: 'NL-OXF', price: 79000, cost: 36000, sizes: SIZES.apparel.slice(1, 5), colors: C('White', 'Blue'), tags: ['cotton'], desc: 'Button-down oxford in brushed cotton.', tint: '#E4E9F0' },
  { name: 'Flannel Overshirt', brand: 'b_northline', cat: 'c_shirts', sku: 'NL-FLO', price: 119000, cost: 58000, sizes: SIZES.apparel.slice(1, 5), colors: C('Olive', 'Charcoal'), tags: ['autumn'], desc: 'Heavy flannel overshirt with two chest pockets.', tint: '#7E8A66' },
  { name: 'Camp Collar Shirt', brand: 'b_casalino', cat: 'c_shirts', sku: 'CL-CCS', price: 95000, cost: 46000, sizes: SIZES.apparel.slice(1, 5), colors: C('Sand', 'Sage'), tags: ['summer'], desc: 'Short-sleeve camp collar shirt in Tencel.', tint: '#C9CFBF' },
  { name: 'Poplin Shirt', brand: 'b_casalino', cat: 'c_shirts', sku: 'CL-POP', price: 82000, cost: 38000, sizes: SIZES.apparel.slice(1, 5), colors: C('White', 'Black'), tags: [], desc: 'Crisp poplin shirt.', tint: '#F4F3F0' },
  { name: 'Denim Shirt', brand: 'b_northline', cat: 'c_shirts', sku: 'NL-DNS', price: 99000, cost: 47000, sizes: SIZES.apparel.slice(1, 5), colors: C('Blue'), tags: ['denim'], desc: 'Mid-wash denim shirt.', tint: '#7A8BA5' },
  { name: 'Short-Sleeve Linen Shirt', brand: 'b_casalino', cat: 'c_shirts', sku: 'CL-SSL', price: 78000, cost: 37000, sizes: SIZES.apparel.slice(1, 5), colors: C('Cream', 'Olive', 'Clay'), tags: ['linen', 'summer'], desc: 'Short-sleeve linen shirt.', tint: '#E8DFCF' },

  { name: 'Chino Slim', brand: 'b_northline', cat: 'c_trousers', sku: 'NL-CHS', price: 109000, cost: 51000, sizes: SIZES.trousers.slice(1, 5), colors: C('Black', 'Sand', 'Navy', 'Olive'), tags: ['chino'], desc: 'Slim chino in stretch cotton twill.', tint: '#C8B89A' },
  { name: 'Chino Relaxed', brand: 'b_northline', cat: 'c_trousers', sku: 'NL-CHR', price: 109000, cost: 51000, sizes: SIZES.trousers.slice(1, 5), colors: C('Sand', 'Charcoal'), tags: ['chino'], desc: 'Relaxed tapered chino.', tint: '#B9AE98' },
  { name: 'Linen Wide Trouser', brand: 'b_casalino', cat: 'c_trousers', sku: 'CL-LWT', price: 129000, cost: 61000, sizes: SIZES.apparel.slice(0, 5), colors: C('Cream', 'Black', 'Sand'), tags: ['linen'], desc: 'Wide-leg linen trouser with drawstring.', tint: '#E8E0D0' },
  { name: 'Pleated Midi Skirt', brand: 'b_casalino', cat: 'c_trousers', sku: 'CL-PMS', price: 119000, cost: 52000, sizes: SIZES.apparel.slice(0, 4), colors: C('Mauve', 'Black'), tags: [], desc: 'Knife-pleated midi skirt.', tint: '#B89AA6' },
  { name: 'Selvedge Jean', brand: 'b_northline', cat: 'c_trousers', sku: 'NL-SLJ', price: 149000, cost: 72000, sizes: SIZES.trousers, colors: C('Blue', 'Black'), tags: ['denim'], desc: '14 oz selvedge denim, straight leg.', tint: '#4A5B7A' },
  { name: 'Jogger Fleece', brand: 'b_northline', cat: 'c_trousers', sku: 'NL-JGF', price: 69000, cost: 31000, sizes: SIZES.apparel.slice(1, 5), colors: C('Charcoal', 'Sage'), tags: ['loungewear'], desc: 'Brushed fleece jogger.', tint: '#8E9B8A' },

  { name: 'Oversized Tee', brand: 'b_northline', cat: 'c_tees', sku: 'NL-OVT', price: 39000, cost: 16000, sizes: SIZES.apparel.slice(1, 5), colors: C('Black', 'White', 'Navy', 'Sand'), tags: ['basics'], desc: 'Heavyweight oversized tee, 240 gsm.', tint: '#3B4A6B' },
  { name: 'Classic Tee', brand: 'b_northline', cat: 'c_tees', sku: 'NL-CLT', price: 29000, cost: 12000, sizes: SIZES.apparel, colors: C('White', 'Black', 'Sage'), tags: ['basics'], desc: 'Classic crew-neck tee.', tint: '#F4F3F0' },
  { name: 'Striped Breton Tee', brand: 'b_casalino', cat: 'c_tees', sku: 'CL-SBT', price: 45000, cost: 19000, sizes: SIZES.apparel.slice(1, 5), colors: C('Navy', 'Clay'), tags: [], desc: 'Breton stripe long-sleeve tee.', tint: '#5B6A8A' },
  { name: 'Pocket Tee', brand: 'b_casalino', cat: 'c_tees', sku: 'CL-PKT', price: 35000, cost: 14000, sizes: SIZES.apparel.slice(1, 5), colors: C('Cream', 'Olive'), tags: ['basics'], desc: 'Slub cotton pocket tee.', tint: '#E8E0D0' },
  { name: 'Polo Piqué', brand: 'b_northline', cat: 'c_tees', sku: 'NL-PLP', price: 59000, cost: 26000, sizes: SIZES.apparel.slice(1, 5), colors: C('Navy', 'White', 'Sand'), tags: [], desc: 'Piqué polo with ribbed collar.', tint: '#3B4A6B' },
  { name: 'Henley Long Sleeve', brand: 'b_northline', cat: 'c_tees', sku: 'NL-HLS', price: 49000, cost: 21000, sizes: SIZES.apparel.slice(1, 5), colors: C('Charcoal', 'Cream'), tags: [], desc: 'Waffle-knit henley.', tint: '#6B6259' },
  { name: 'Tank Rib', brand: 'b_casalino', cat: 'c_tees', sku: 'CL-TKR', price: 25000, cost: 9000, sizes: SIZES.apparel.slice(0, 4), colors: C('White', 'Black', 'Mauve'), tags: ['summer'], desc: 'Ribbed cotton tank.', tint: '#F4F3F0' },

  { name: 'Wool Blend Coat', brand: 'b_casalino', cat: 'c_outerwear', sku: 'CL-WBC', price: 299000, cost: 145000, sizes: SIZES.apparel.slice(1, 5), colors: C('Charcoal', 'Sand'), tags: ['winter'], desc: 'Single-breasted wool blend coat.', tint: '#6B6259' },
  { name: 'Quilted Liner Jacket', brand: 'b_northline', cat: 'c_outerwear', sku: 'NL-QLJ', price: 189000, cost: 88000, sizes: SIZES.apparel.slice(1, 5), colors: C('Olive', 'Navy'), tags: ['autumn'], desc: 'Lightweight quilted liner jacket.', tint: '#6B7A4A' },
  { name: 'Denim Trucker Jacket', brand: 'b_northline', cat: 'c_outerwear', sku: 'NL-DTJ', price: 169000, cost: 79000, sizes: SIZES.apparel.slice(1, 5), colors: C('Blue', 'Black'), tags: ['denim'], desc: 'Classic trucker in rigid denim.', tint: '#4A5B7A' },
  { name: 'Trench Coat', brand: 'b_casalino', cat: 'c_outerwear', sku: 'CL-TRC', price: 279000, cost: 132000, sizes: SIZES.apparel.slice(0, 4), colors: C('Sand'), tags: [], desc: 'Double-breasted cotton trench.', tint: '#C8B89A' },

  { name: 'Canvas Low Sneaker', brand: 'b_casalino', cat: 'c_shoes', sku: 'CL-CLS', price: 139000, cost: 64000, sizes: SIZES.shoes.slice(3, 9), colors: C('White', 'Black'), tags: ['sneaker'], desc: 'Vulcanised canvas low-top.', tint: '#E9E6DF' },
  { name: 'Leather Loafer', brand: 'b_casalino', cat: 'c_shoes', sku: 'CL-LLF', price: 249000, cost: 118000, sizes: SIZES.shoes.slice(3, 9), colors: C('Brown', 'Black'), tags: [], desc: 'Penny loafer in full-grain leather.', tint: '#5A4634' },
  { name: 'Suede Desert Boot', brand: 'b_casalino', cat: 'c_shoes', sku: 'CL-SDB', price: 229000, cost: 108000, sizes: SIZES.shoes.slice(4, 10), colors: C('Sand'), tags: [], desc: 'Crepe-sole desert boot.', tint: '#C8B89A' },
  { name: 'Slide Sandal', brand: 'b_casalino', cat: 'c_shoes', sku: 'CL-SLS', price: 69000, cost: 28000, sizes: SIZES.shoes.slice(0, 8), colors: C('Black', 'Cream'), tags: ['summer'], desc: 'Moulded slide sandal.', tint: '#1F2421' },
  { name: 'Running Trainer', brand: 'b_northline', cat: 'c_shoes', sku: 'NL-RNT', price: 189000, cost: 92000, sizes: SIZES.shoes.slice(3, 9), colors: C('White', 'Navy'), tags: ['sneaker'], desc: 'Lightweight knit trainer.', tint: '#E4E9F0' },
  { name: 'Espadrille', brand: 'b_casalino', cat: 'c_shoes', sku: 'CL-ESP', price: 79000, cost: 33000, sizes: SIZES.shoes.slice(0, 6), colors: C('Sand', 'Navy'), tags: ['summer'], desc: 'Jute-sole espadrille.', tint: '#D9CBB0' },

  { name: 'Kids Denim Jacket', brand: 'b_dunekids', cat: 'c_kids', sku: 'DK-KDJ', price: 79000, cost: 38000, sizes: SIZES.kids.slice(1, 6), colors: C('Blue'), tags: ['kids'], desc: 'Soft denim jacket for kids.', tint: '#7A8BA5' },
  { name: 'Kids Graphic Tee', brand: 'b_dunekids', cat: 'c_kids', sku: 'DK-KGT', price: 25000, cost: 10000, sizes: SIZES.kids.slice(0, 6), colors: C('White', 'Clay', 'Sage'), tags: ['kids'], desc: 'Printed cotton tee.', tint: '#F4F3F0' },
  { name: 'Kids Jogger', brand: 'b_dunekids', cat: 'c_kids', sku: 'DK-KJG', price: 35000, cost: 15000, sizes: SIZES.kids.slice(0, 6), colors: C('Charcoal', 'Navy'), tags: ['kids'], desc: 'Fleece jogger for kids.', tint: '#6B6259' },
  { name: 'Kids Linen Set', brand: 'b_dunekids', cat: 'c_kids', sku: 'DK-KLS', price: 59000, cost: 27000, sizes: SIZES.kids.slice(0, 5), colors: C('Cream', 'Sand'), tags: ['kids', 'summer'], desc: 'Two-piece linen set.', tint: '#E8E0D0' },
  { name: 'Kids Rain Jacket', brand: 'b_dunekids', cat: 'c_kids', sku: 'DK-KRJ', price: 69000, cost: 32000, sizes: SIZES.kids.slice(1, 6), colors: C('Clay', 'Navy'), tags: ['kids'], desc: 'Packable rain jacket.', tint: '#B04A3F' },
  { name: 'Ribbed Beanie', brand: 'b_dunekids', cat: 'c_kids', sku: 'DK-RBB', price: 15000, cost: 6000, sizes: SIZES.one, colors: C('Sage', 'Charcoal', 'Clay', 'Cream'), tags: ['kids', 'winter'], desc: 'Ribbed knit beanie.', tint: '#8E9B8A' },
  { name: 'Kids Canvas Sneaker', brand: 'b_dunekids', cat: 'c_kids', sku: 'DK-KCS', price: 59000, cost: 26000, sizes: ['28', '29', '30', '31', '32', '33'], colors: C('White', 'Navy'), tags: ['kids', 'sneaker'], desc: 'Velcro canvas sneaker.', tint: '#E9E6DF' },

  { name: 'Leather Belt Classic', brand: 'b_northline', cat: 'c_trousers', sku: 'NL-LBC', price: 49000, cost: 21000, sizes: ['85', '90', '95', '100'], colors: C('Brown', 'Black'), tags: ['accessory'], desc: 'Full-grain leather belt, brass buckle.', tint: '#5A4634' },
  { name: 'Wool Scarf', brand: 'b_casalino', cat: 'c_outerwear', sku: 'CL-WSC', price: 59000, cost: 24000, sizes: SIZES.one, colors: C('Charcoal', 'Sand', 'Clay'), tags: ['winter', 'accessory'], desc: 'Merino wool scarf.', tint: '#6B6259' },
];

export const products: Product[] = [];
export const variants: Variant[] = [];
export const productTint: Record<string, string> = {};
export const productSizes: Record<string, string[]> = {};
export const productColors: Record<string, ColorRef[]> = {};

const skuCode = (s: string) => s.replace(/\s+/g, '').slice(0, 3).toUpperCase();
let barcodeCounter = 6220001000010;

seeds.forEach((s, i) => {
  const id = `p_${s.sku.toLowerCase().replace('-', '_')}`;
  const createdAt = daysAgo(120 - i * 2, 11);
  products.push({
    id, name: s.name, brandId: s.brand, categoryId: s.cat, description: s.desc, baseSku: s.sku, images: [],
    defaultCost: s.cost, defaultPrice: s.price, status: s.sku === 'NL-LSC' ? 'ARCHIVED' : 'ACTIVE', tags: s.tags,
    createdBy: 'u_omar', createdAt, updatedAt: daysAgo(int(0, 14), int(9, 19), int(0, 59)),
  });
  productTint[id] = s.tint;
  productSizes[id] = s.sizes;
  productColors[id] = s.colors;
  const hero = ['NL-LSR', 'NL-CHS', 'NL-OVT'].includes(s.sku);
  const sizes = hero ? s.sizes.slice(0, 5) : s.sizes.slice(0, 4);
  const colors = hero ? s.colors : s.colors.slice(0, i % 3 === 0 ? 1 : 2);
  productSizes[id] = sizes;
  productColors[id] = colors;
  for (const size of sizes) {
    for (const color of colors) {
      variants.push({
        id: uid('v'), productId: id, size, color, sku: `${s.sku}-${size.replace(/\s+/g, '')}-${skuCode(color.name)}`,
        barcode: String(barcodeCounter++), costPrice: s.cost, sellPrice: s.price, quantity: 0,
        lowStockThreshold: s.cat === 'c_shoes' ? 3 : s.cat === 'c_kids' ? 4 : 5, isActive: true,
      });
    }
  }
});

/* ---------- Ledger (movements) → quantities ---------- */
export const movements: StockMovement[] = [];
export const purchases: Purchase[] = [];
export const sales: Sale[] = [];
export const returns: Return[] = [];
export const audit: AuditEntry[] = [];

const qty: Record<string, number> = {};
const lastSaleAt: Record<string, string> = {};
const vById = new Map(variants.map((v) => [v.id, v]));
const pById = new Map(products.map((p) => [p.id, p]));

function move(v: Variant, type: MovementType, delta: number, at: string, userId: string, extra: Partial<StockMovement> = {}) {
  qty[v.id] = (qty[v.id] ?? 0) + delta;
  const p = pById.get(v.productId)!;
  movements.push({
    id: uid('mv'), variantId: v.id, variant: { size: v.size, color: v.color, sku: v.sku, productName: p.name }, type,
    qtyDelta: delta, qtyAfter: qty[v.id] ?? 0, unitCost: v.costPrice, userId, userName: userName(userId), createdAt: at, ...extra,
  });
}

// INITIAL at creation
for (const v of variants) {
  const p = pById.get(v.productId)!;
  const n = p.status === 'ARCHIVED' ? int(2, 6) : int(5, 24);
  move(v, 'INITIAL', n, p.createdAt, 'u_omar', { reason: 'Product created' });
}

// Purchases: 6 POs over the last 60 days
let poCounter = 142;
const poPlan: { day: number; supplier: string; invoice: string; brand: string; lines: number; by: string }[] = [
  { day: 56, supplier: 's_casalino', invoice: 'CL-2201', brand: 'b_casalino', lines: 10, by: 'u_omar' },
  { day: 44, supplier: 's_northline', invoice: 'INV-8740', brand: 'b_northline', lines: 14, by: 'u_omar' },
  { day: 33, supplier: 's_dune', invoice: 'DK-0090', brand: 'b_dunekids', lines: 8, by: 'u_salma' },
  { day: 15, supplier: 's_dune', invoice: '', brand: 'b_dunekids', lines: 8, by: 'u_salma' },
  { day: 9, supplier: 's_casalino', invoice: 'CL-2290', brand: 'b_casalino', lines: 12, by: 'u_omar' },
  { day: 3, supplier: 's_northline', invoice: 'INV-8812', brand: 'b_northline', lines: 20, by: 'u_omar' },
];
for (const po of poPlan) {
  const pool = variants.filter((v) => pById.get(v.productId)!.brandId === po.brand);
  const chosen = [...pool].sort(() => rnd() - 0.5).slice(0, po.lines);
  const at = daysAgo(po.day, 9, 40);
  const id = uid('po');
  const number = `PO-${String(poCounter++).padStart(4, '0')}`;
  const items = chosen.map((v) => {
    const unitCost = Math.round((v.costPrice ?? 0) * (0.96 + rnd() * 0.06) / 100) * 100;
    const q = int(2, 8);
    // weighted-average cost
    const old = qty[v.id] ?? 0;
    v.costPrice = Math.round(((old * (v.costPrice ?? 0)) + q * unitCost) / (old + q));
    move(v, 'PURCHASE', q, at, po.by, { unitCost, reference: { kind: 'purchase', id, label: `${number}${po.invoice ? ' · ' + po.invoice : ''}` } });
    return { variantId: v.id, qty: q, unitCost };
  });
  const total = items.reduce((a, i) => a + i.qty * i.unitCost, 0);
  purchases.push({
    id, number, supplierId: po.supplier, supplierName: suppliers.find((s) => s.id === po.supplier)?.name, invoiceRef: po.invoice || undefined,
    items, lineCount: items.length, unitCount: items.reduce((a, i) => a + i.qty, 0), total, receivedAt: at, createdBy: po.by, createdByName: userName(po.by),
  });
  audit.push({ id: uid('au'), userId: po.by, userName: userName(po.by), action: 'purchase.post', entity: 'Purchase', entityId: id, entityLabel: number, summary: `${items.reduce((a, i) => a + i.qty, 0)} units · ${(total / 100).toLocaleString('en-EG', { minimumFractionDigits: 2 })} · ${suppliers.find((s) => s.id === po.supplier)?.name}`, createdAt: at });
}

// Sales: 120 over 60 days, denser recently, ≥ 8 today
const PAYMENTS: PaymentMethod[] = ['CASH', 'CASH', 'CASH', 'CARD', 'CARD', 'CARD', 'WALLET', 'TRANSFER'];
const sellerPool = ['u_nour', 'u_nour', 'u_nour', 'u_nour', 'u_nour', 'u_karim', 'u_karim', 'u_karim', 'u_karim', 'u_omar'];
const saleDays: number[] = [];
for (let i = 0; i < 112; i++) saleDays.push(Math.floor(Math.pow(rnd(), 1.6) * 59) + 1);
for (let i = 0; i < 8; i++) saleDays.push(0);
saleDays.sort((a, b) => b - a);
let saleNo = 1923;
const CUSTOMERS = ['Mona H.', 'Youssef A.', 'Dina S.', 'Ahmed R.', 'Laila K.'];

saleDays.forEach((d, idx) => {
  const hour = d === 0 ? 11 + Math.floor((idx - 112) * 1.0) : int(11, 20);
  const at = daysAgo(d, Math.min(hour, 19), int(0, 59));
  const sellerId = pick(sellerPool);
  const nItems = pick([1, 1, 1, 2, 2, 3, 4]);
  const available = variants.filter((v) => (qty[v.id] ?? 0) > 0 && pById.get(v.productId)!.status === 'ACTIVE');
  const picked = [...available].sort(() => rnd() - 0.5).slice(0, nItems);
  if (picked.length === 0) return;
  const id = uid('sa');
  const number = `AV-${saleNo++}`;
  const items: SaleItem[] = picked.map((v) => {
    const p = pById.get(v.productId)!;
    const q = chance(0.15) && (qty[v.id] ?? 0) > 1 ? 2 : 1;
    move(v, 'SALE', -q, at, sellerId, { reference: { kind: 'sale', id, label: number } });
    lastSaleAt[v.id] = at;
    return { id: uid('si'), variantId: v.id, productName: p.name, size: v.size, color: v.color, sku: v.sku, tint: productTint[p.id] ?? '#ddd', qty: q, unitPrice: v.sellPrice, unitCost: v.costPrice, lineTotal: q * v.sellPrice, returnedQty: 0 };
  });
  const subtotal = items.reduce((a, i) => a + i.lineTotal, 0);
  const discountPct = chance(0.25) ? pick([5, 10, 10, 15]) : 0;
  const discount = Math.round((subtotal * discountPct) / 100);
  const total = subtotal - discount;
  const cost = items.reduce((a, i) => a + (i.unitCost ?? 0) * i.qty, 0);
  const sale: Sale = {
    id, number, sellerId, sellerName: userName(sellerId), items, subtotal, discount, discountPct: discountPct || undefined, total,
    paymentMethod: pick(PAYMENTS), status: 'COMPLETED', customerName: chance(0.2) ? pick(CUSTOMERS) : undefined,
    device: sellerId === 'u_omar' ? 'iPhone · Shop floor' : 'iPad · Shop floor', cost, profit: total - cost, returns: [], createdAt: at,
  };
  sales.push(sale);
  audit.push({ id: uid('au'), userId: sellerId, userName: userName(sellerId), action: 'sale.create', entity: 'Sale', entityId: id, entityLabel: number, summary: `${items.length} item(s) · ${(total / 100).toLocaleString('en-EG', { minimumFractionDigits: 2 })} · ${sale.paymentMethod}`, createdAt: at });
});

// Returns on ~6 sales (not today's), one void
const refundable = sales.filter((s) => new Date(s.createdAt).getTime() < todayStart - DAY && s.items.length > 0);
const REASONS = ['Wrong size', 'Changed mind', 'Defective', 'Other'];
refundable.slice(5, 11).forEach((s, i) => {
  const item = s.items[0]!;
  const full = s.items.length === 1 && i % 3 === 0;
  const restock = i % 4 !== 1;
  const at = new Date(new Date(s.createdAt).getTime() + int(1, 3) * DAY).toISOString();
  const v = vById.get(item.variantId)!;
  const refundAmount = Math.round(item.unitPrice * item.qty * (1 - (s.discountPct ?? 0) / 100));
  const rt: Return = { id: uid('rt'), saleId: s.id, items: [{ saleItemId: item.id, qty: item.qty, restock }], refundAmount, refundMethod: s.paymentMethod, reason: pick(REASONS), createdBy: s.sellerId, createdAt: at };
  returns.push(rt);
  s.returns.push(rt);
  item.returnedQty = item.qty;
  s.status = full ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  if (restock) move(v, 'RETURN', item.qty, at, s.sellerId, { reference: { kind: 'return', id: rt.id, label: `RT-${String(31 + i).padStart(4, '0')} ← ${s.number}` } });
  audit.push({ id: uid('au'), userId: s.sellerId, userName: userName(s.sellerId), action: 'return.create', entity: 'Sale', entityId: s.id, entityLabel: s.number, summary: `Refund ${(refundAmount / 100).toLocaleString('en-EG', { minimumFractionDigits: 2 })} · ${rt.reason}${restock ? ' · restocked' : ''}`, createdAt: at });
});
{
  const s = refundable[12];
  if (s) {
    s.status = 'VOID';
    s.voidReason = 'Duplicate entry';
    const at = new Date(new Date(s.createdAt).getTime() + 20 * 60_000).toISOString();
    for (const it of s.items) move(vById.get(it.variantId)!, 'ADJUSTMENT', it.qty, at, 'u_omar', { reason: `Void ${s.number}`, reference: { kind: 'sale', id: s.id, label: s.number } });
    audit.push({ id: uid('au'), userId: 'u_omar', userName: 'Omar Mansour', action: 'sale.void', entity: 'Sale', entityId: s.id, entityLabel: s.number, summary: `Voided · “Duplicate entry” · ${s.items.length} item(s) restocked`, createdAt: at });
  }
}

// A few adjustments
const adjPlan: { skuPrefix: string; delta: number; reason: string; note: string; day: number; by: string }[] = [
  { skuPrefix: 'NL-LSR-M-WHI', delta: -1, reason: 'DAMAGED', note: 'Stain on sleeve, written off', day: 0, by: 'u_omar' },
  { skuPrefix: 'NL-CHS-32-SAN', delta: 2, reason: 'FOUND', note: 'Stock count SC-0009', day: 1, by: 'u_salma' },
  { skuPrefix: 'NL-OVT-L-NAV', delta: -1, reason: 'LOST', note: '', day: 6, by: 'u_salma' },
  { skuPrefix: 'CL-CLS-42-BLA', delta: -2, reason: 'CORRECTION', note: 'Mis-scanned at receive', day: 12, by: 'u_omar' },
];
for (const a of adjPlan) {
  const v = variants.find((x) => x.sku.startsWith(a.skuPrefix));
  if (!v) continue;
  if ((qty[v.id] ?? 0) + a.delta < 0) continue;
  const at = daysAgo(a.day, a.day === 0 ? 17 : 11, 12);
  const before = qty[v.id] ?? 0;
  move(v, 'ADJUSTMENT', a.delta, at, a.by, { reason: a.reason + (a.note ? ` · “${a.note}”` : '') });
  audit.push({ id: uid('au'), userId: a.by, userName: userName(a.by), action: 'variant.adjust', entity: 'Variant', entityId: v.id, entityLabel: v.sku, summary: `Quantity ${before} → ${before + a.delta} · ${a.reason}${a.note ? ` · “${a.note}”` : ''}`, before: { quantity: before, lowStockThreshold: v.lowStockThreshold }, after: { quantity: before + a.delta, lowStockThreshold: v.lowStockThreshold }, ip: '197.54.xx.xx', userAgent: 'iPad Safari', requestId: '8f1c…a2', createdAt: at });
}

// Force a handful of out-of-stock cells that the design relies on
for (const sku of ['NL-LSR-M-BLA', 'DK-KDJ-8-BLU', 'CL-CLS-42-BLA']) {
  const v = variants.find((x) => x.sku === sku);
  if (v && (qty[v.id] ?? 0) > 0) {
    const n = qty[v.id] ?? 0;
    const at = daysAgo(3, 18, 42);
    const id = uid('sa');
    const number = `AV-${saleNo++}`;
    const p = pById.get(v.productId)!;
    move(v, 'SALE', -n, at, 'u_nour', { reference: { kind: 'sale', id, label: number } });
    lastSaleAt[v.id] = at;
    const item: SaleItem = { id: uid('si'), variantId: v.id, productName: p.name, size: v.size, color: v.color, sku: v.sku, tint: productTint[p.id] ?? '#ddd', qty: n, unitPrice: v.sellPrice, unitCost: v.costPrice, lineTotal: n * v.sellPrice, returnedQty: 0 };
    sales.push({ id, number, sellerId: 'u_nour', sellerName: 'Nour Adel', items: [item], subtotal: item.lineTotal, discount: 0, total: item.lineTotal, paymentMethod: 'CARD', status: 'COMPLETED', device: 'iPad · Shop floor', cost: (v.costPrice ?? 0) * n, profit: item.lineTotal - (v.costPrice ?? 0) * n, returns: [], createdAt: at });
  }
}

// Commit quantities
for (const v of variants) v.quantity = qty[v.id] ?? 0;
sales.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
movements.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

export const variantLastSaleAt = lastSaleAt;

/* ---------- Stock count (open) ---------- */
export const stockCounts: StockCount[] = (() => {
  const scope = variants.filter((v) => { const p = pById.get(v.productId)!; return p.brandId === 'b_northline' && (p.categoryId === 'c_shirts' || p.categoryId === 'c_trousers'); });
  const items = scope.map((v, i) => {
    const p = pById.get(v.productId)!;
    const counted = i % 9 === 8 ? null : v.quantity + (i % 11 === 0 ? 1 : i % 13 === 0 ? -1 : i % 23 === 0 ? 5 : 0);
    return { variantId: v.id, variant: { size: v.size, color: v.color, sku: v.sku, costPrice: v.costPrice, productName: p.name }, systemQty: v.quantity, countedQty: counted, countedBy: counted === null ? undefined : i % 2 ? 'Salma' : 'Omar', countedAt: counted === null ? undefined : daysAgo(0, 9, 40 + (i % 20)) };
  });
  return [{ id: 'sc_0010', number: 'SC-0010', status: 'OPEN', scope: 'Northline · Shirts & Trousers', startedBy: 'u_omar', startedByName: 'Omar Mansour', startedAt: daysAgo(0, 9, 10), counters: ['Omar', 'Salma'], items }];
})();

/* ---------- Settings ---------- */
export const settings: Settings = {
  storeName: 'Avenue', phone: '02 2735 1180', address: '26 Brazil St, Zamalek, Cairo', currency: 'EGP', timezone: 'Africa/Cairo', dateFormat: 'DD/MM/YYYY',
  lowStockDefault: 5, saleNumberPrefix: 'AV-', nextSaleNumber: saleNo, sellerDiscountCapPct: 10, allowNegativeStock: false, requirePhoneOnTransfer: true,
  sizePresets: [
    { name: 'Apparel', sizes: SIZES.apparel },
    { name: 'Shoes 36–45', sizes: SIZES.shoes },
    { name: 'Kids 2–14', sizes: SIZES.kids },
  ],
  colorPresets: Object.values(COLORS),
  receiptHeader: '26 Brazil St, Zamalek · 02 2735 1180', receiptFooter: 'Exchanges within 14 days with receipt. Thank you.', receiptShowLogo: true,
  sessionIdleHours: 12, passwordRotationDays: 90, lockoutEnabled: true, largeRefundAlert: 100000,
};

/* ---------- Notifications ---------- */
export const notifications: Notification[] = [
  { id: 'n1', kind: 'LOW_STOCK', title: 'Low stock', body: 'Linen Shirt Relaxed · M · Black hit 0. 14 variants are now low.', href: '/stock/receive', actionLabel: 'Receive', createdAt: daysAgo(0, 18, 42) },
  { id: 'n2', kind: 'LARGE_REFUND', title: 'Large refund', body: 'EGP 1,480.00 refunded on a sale by Karim, above your EGP 1,000.00 alert.', href: '/sales', actionLabel: 'Review sale', createdAt: daysAgo(0, 17, 35) },
  { id: 'n3', kind: 'NEW_DEVICE_LOGIN', title: 'New device sign-in', body: 'Nour signed in on Android Chrome, Cairo.', href: '/users', actionLabel: 'Not Nour? Sign out everywhere', createdAt: daysAgo(1, 22, 14) },
  { id: 'n4', kind: 'COUNT_APPLIED', title: 'Stock count applied', body: 'SC-0009 applied by Salma · 8 adjustments.', href: '/stock/movements', readAt: daysAgo(1, 12, 0), createdAt: daysAgo(1, 11, 12) },
];

/* ---------- Extra audit entries ---------- */
audit.push(
  { id: uid('au'), userId: 'u_salma', userName: 'Salma Fawzy', action: 'settings.update', entity: 'Settings', entityLabel: 'Settings', summary: 'sellerDiscountCapPct 15 → 10', before: { sellerDiscountCapPct: 15 }, after: { sellerDiscountCapPct: 10 }, createdAt: daysAgo(0, 14, 40) },
  { id: uid('au'), userId: 'u_salma', userName: 'Salma Fawzy', action: 'count.apply', entity: 'Stock count', entityId: 'sc_0009', entityLabel: 'SC-0009', summary: '8 adjustments applied · net +4 units · +2,810.00', createdAt: daysAgo(1, 11, 12) },
  { id: uid('au'), userId: 'u_omar', userName: 'Omar Mansour', action: 'user.create', entity: 'User', entityId: 'u_karim', entityLabel: 'karim@avenue.eg', summary: 'Created with role SELLER · invite sent', after: { role: 'SELLER', status: 'INVITED' }, createdAt: daysAgo(0, 9, 3) },
  { id: uid('au'), userId: 'u_nour', userName: 'Nour Adel', action: 'auth.login', entity: 'Session', entityLabel: 'Session', summary: 'New device · Android Chrome · Cairo', ip: '41.33.xx.xx', userAgent: 'Android Chrome', createdAt: daysAgo(1, 22, 14) },
);
audit.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

/* ---------- Parked sale ---------- */
export const parkedSales: ParkedSale[] = (() => {
  const v = variants.find((x) => x.sku.startsWith('NL-OVT-M-BLA')) ?? variants[0]!;
  const p = pById.get(v.productId)!;
  return [{
    id: 'pk1', parkedAt: daysAgo(0, 16, 20), label: 'Customer trying sizes',
    cart: { lines: [{ variantId: v.id, productId: p.id, productName: p.name, size: v.size, color: v.color, sku: v.sku, tint: productTint[p.id] ?? '#ddd', unitPrice: v.sellPrice, qty: 1, available: v.quantity }], discount: { type: 'PCT', value: 0 }, paymentMethod: 'CASH' },
  }];
})();
