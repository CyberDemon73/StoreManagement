'use client';
/**
 * Screen: /components · Roles: all (internal stories page)
 * Calls: GET /products (States demo only, through mockControls). Reproduces Components.dc.html
 * and States.dc.html: every ui/app primitive with its variants and sizes, live.
 */
import { useState } from 'react';
import { Plus, ScanLine } from 'lucide-react';
import { useTheme } from '@/lib/theme-context';
import { formatMoney } from '@/lib/format';
import { Page, PageHeader } from '@/components/app/PageHeader';
import { MatrixLegend, VariantMatrix } from '@/components/app/VariantMatrix';
import { Receipt } from '@/components/app/Receipt';
import { ChartCard, TrendChart, trendSummary } from '@/components/app/Charts';
import { Avatar, Badge, Chip, ColorSwatch, Kbd, RoleBadge, SaleStatusBadge, StockBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, KpiCard, Progress } from '@/components/ui/Card';
import { Checkbox, Field, Input, MoneyInput, Segmented, Select, Textarea, Toggle } from '@/components/ui/Field';
import { Combobox, DateRangePicker, FilterBar, QuantityInput, SearchInput, SizeChip, Stepper, Tabs } from '@/components/ui/Controls';
import { ConfirmDialog, Dialog, MenuItem, Panel, Popover } from '@/components/ui/Overlay';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { ApiError } from '@/lib/api';
import { dateRangeFor } from '@/lib/format';
import type { ColorRef, DateRange, PaymentMethod, Sale, TrendPoint, Variant } from '@/types';
import { BindDismiss, StatesDemo } from './StatesDemo';

const COLORS: ColorRef[] = [{ name: 'Black', hex: '#1F2421' }, { name: 'Sand', hex: '#C8B89A' }, { name: 'Navy', hex: '#3B4A6B' }, { name: 'White', hex: '#FFFFFF' }];
const SIZES = ['S', 'M', 'L'];
const QTY: Record<string, number> = { 'S|Black': 12, 'S|Sand': 8, 'S|Navy': 3, 'S|White': 9, 'M|Black': 0, 'M|Sand': 14, 'M|Navy': 7, 'M|White': 2, 'L|Black': 10, 'L|Sand': 4, 'L|Navy': 11 };
const VARIANTS: Variant[] = Object.entries(QTY).map(([k, q], i) => { const [size = 'M', color = 'Black'] = k.split('|'); return { id: `v${i}`, productId: 'p1', size, color: COLORS.find((c) => c.name === color) ?? COLORS[0]!, sku: `NL-LSR-${size}-${color.slice(0, 3).toUpperCase()}`, sellPrice: 89000, quantity: q, lowStockThreshold: 5, isActive: true }; });
const TREND: TrendPoint[] = Array.from({ length: 14 }).map((_, i) => ({ bucket: new Date(Date.now() - (13 - i) * 86_400_000).toISOString().slice(0, 10), revenue: 400000 + Math.round(Math.sin(i / 2) * 120000) + i * 15000, profit: 180000 + Math.round(Math.cos(i / 2) * 50000) + i * 7000, cogs: 220000, count: 10 + i }));
const SAMPLE_SALE: Sale = { id: 's1', number: 'AV-2041', sellerId: 'u_nour', sellerName: 'Nour Adel', items: [{ id: 'i1', variantId: 'v1', productName: 'Linen Shirt', size: 'M', color: COLORS[0]!, sku: 'NL-LSR-M-BLA', tint: '#DDD5C4', qty: 1, unitPrice: 89000, lineTotal: 89000, returnedQty: 0 }, { id: 'i2', variantId: 'v2', productName: 'Chino Slim', size: '32', color: COLORS[1]!, sku: 'NL-CHS-32-SAN', tint: '#C8B89A', qty: 1, unitPrice: 109000, lineTotal: 109000, returnedQty: 0 }], subtotal: 198000, discount: 19800, discountPct: 10, total: 178200, paymentMethod: 'CARD', status: 'COMPLETED', returns: [], createdAt: new Date().toISOString() };
interface Row { id: string; name: string; brand: string; variants: number; qty: number; cost: number; price: number; status: 'ok' | 'low' | 'out' }
const ROWS: Row[] = [{ id: '1', name: 'Linen Shirt Relaxed', brand: 'Northline', variants: 12, qty: 86, cost: 42000, price: 89000, status: 'ok' }, { id: '2', name: 'Chino Slim', brand: 'Northline', variants: 16, qty: 54, cost: 51000, price: 109000, status: 'low' }, { id: '3', name: 'Canvas Low Sneaker', brand: 'Casa Lino', variants: 20, qty: 0, cost: 64000, price: 139000, status: 'out' }];

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return <Card as="section" className={className ? `flex flex-col gap-3 ${className}` : 'flex flex-col gap-3'}><h2 className="text-[15px] font-semibold">{title}</h2>{children}</Card>;
}

export function ComponentsGallery() {
  const { resolved, setTheme } = useTheme();
  const [qty, setQty] = useState(1);
  const [size, setSize] = useState('M');
  const [pay, setPay] = useState<PaymentMethod>('CASH');
  const [swatch, setSwatch] = useState('Black');
  const [price, setPrice] = useState<number | undefined>(89000);
  const [remember, setRemember] = useState(true);
  const [toggle, setToggle] = useState(true);
  const [tab, setTab] = useState('variants');
  const [range, setRange] = useState<DateRange>(() => dateRangeFor('30d'));
  const [search, setSearch] = useState('');
  const [brand, setBrand] = useState<string>();
  const [selected, setSelected] = useState<Set<string>>(new Set(['1']));
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: 'name', desc: false });
  const [cell, setCell] = useState<string>('v6');
  const [dialog, setDialog] = useState<'dialog' | 'confirm' | 'panel' | null>(null);
  const [menu, setMenu] = useState(false);
  const [reason, setReason] = useState('');

  const columns: Column<Row>[] = [
    { key: 'name', header: 'Product', sortable: true, cell: (r) => <span className="flex items-center gap-2.5"><span className="size-8 rounded-md bg-surface-2" aria-hidden />{r.name}</span> },
    { key: 'brand', header: 'Brand', cell: (r) => <span className="text-ink-2">{r.brand}</span> },
    { key: 'variants', header: 'Variants', align: 'right', cell: (r) => r.variants },
    { key: 'qty', header: 'Qty', align: 'right', sortable: true, cell: (r) => r.qty },
    { key: 'cost', header: 'Cost', align: 'right', cell: (r) => <span className="text-ink-2">{formatMoney(r.cost)}</span> },
    { key: 'price', header: 'Price', align: 'right', cell: (r) => formatMoney(r.price) },
    { key: 'margin', header: 'Margin', align: 'right', cell: (r) => `${(((r.price - r.cost) / r.price) * 100).toFixed(1)}%` },
    { key: 'status', header: 'Status', cell: (r) => <StockBadge status={r.status} /> },
  ];

  return (
    <>
      <BindDismiss />
      <PageHeader title="Component library" description="components/ui · components/app — the primitives every screen is composed from" actions={<Toggle checked={resolved === 'dark'} onChange={(v) => setTheme(v ? 'dark' : 'light')} label="Dark mode" />} />
      <Page wide>
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          <Section title="Button">
            <div className="flex flex-wrap gap-2"><Button variant="primary">Primary</Button><Button>Secondary</Button><Button variant="soft">Soft</Button><Button variant="ghost">Ghost</Button><Button variant="danger">Danger</Button><Button variant="dangerSoft">Danger soft</Button><Button disabled>Disabled</Button><Button loading>Saving</Button></div>
            <div className="flex flex-wrap items-center gap-2"><Button size="sm">Small 32</Button><Button>Default 40</Button><Button size="lg" variant="primary">Large 48</Button><Button iconOnly aria-label="Add"><Plus /></Button><Button size="sm" leading={<ScanLine />}>Scan</Button></div>
            <Button size="xl" variant="primary" block className="justify-between"><span>Charge</span><span className="tabular">EGP 1,250.00</span></Button>
          </Section>

          <Section title="Input · Select · MoneyInput · Textarea">
            <Field label="Product name" htmlFor="g-name"><Input id="g-name" defaultValue="Linen Shirt Relaxed" /></Field>
            <Field label="Brand" htmlFor="g-brand" help="Combobox with create"><Combobox aria-label="Brand" value={brand} onChange={setBrand} onCreate={(t) => setBrand(t)} options={[{ value: 'nl', label: 'Northline', hint: '22 products' }, { value: 'cl', label: 'Casa Lino', hint: '12 products' }, { value: 'dk', label: 'Dune Kids', hint: '6 products' }]} placeholder="Search or create…" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Price" htmlFor="g-price"><MoneyInput id="g-price" value={price} onChange={setPrice} /></Field>
              <Field label="SKU" htmlFor="g-sku" error="Already used by “Linen Shirt Classic”."><Input id="g-sku" defaultValue="NL-LSR" invalid /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Select" htmlFor="g-sel"><Select id="g-sel" defaultValue="EGP"><option>EGP</option><option>USD</option></Select></Field>
              <Field label="Small" htmlFor="g-sm"><Input id="g-sm" size="sm" placeholder="size sm" /></Field>
            </div>
            <Textarea placeholder="Textarea" aria-label="Notes" className="min-h-14" />
          </Section>

          <Section title="Badge · RoleBadge · Chip · ColorSwatch · SizeChip">
            <div className="flex flex-wrap gap-1.5"><StockBadge status="ok" /><StockBadge status="low" qty={3} /><StockBadge status="out" /><SaleStatusBadge status="PARTIALLY_REFUNDED" /><Badge>Archived</Badge><Badge tone="accent">Accent</Badge><Badge tone="info" dot>Info</Badge><RoleBadge role="ADMIN" /><RoleBadge role="MANAGER" /><RoleBadge role="SELLER" /></div>
            <div className="flex flex-wrap gap-1.5"><Chip selected onRemove={() => undefined}>Brand: Northline</Chip><Chip>Category</Chip><Chip size="sm">Small</Chip><Chip struck>Struck</Chip><Chip disabled>Disabled</Chip><Chip leading={<Kbd>⌘K</Kbd>}>With Kbd</Chip></div>
            <div className="flex flex-wrap gap-1.5">{['XS', 'S', 'M', 'L'].map((s) => <SizeChip key={s} size={s} touch selected={size === s} available={s === 'XS' ? 2 : 9} onClick={() => setSize(s)} />)}<SizeChip size="XL" touch available={0} /></div>
            <div className="flex items-center gap-2.5">{COLORS.map((c) => <ColorSwatch key={c.name} hex={c.hex} name={c.name} size="touch" selected={swatch === c.name} onClick={() => setSwatch(c.name)} />)}<ColorSwatch hex="#6B7A4A" name="Olive" size="touch" disabled onClick={() => undefined} /><span className="text-xs text-ink-2">Dashed/struck = out · tap to pick</span></div>
          </Section>

          <Section title="QuantityInput · Toggle · Segmented · Checkbox">
            <div className="flex flex-wrap items-center gap-4"><QuantityInput value={qty} onChange={setQty} min={1} /><QuantityInput value={2} onChange={() => undefined} size="sm" /><span className="text-xs text-ink-2">44px for thumbs · 32px in tables</span></div>
            <Segmented size="lg" grow value={pay} onChange={setPay} aria-label="Payment method" options={[{ value: 'CASH', label: 'Cash' }, { value: 'CARD', label: 'Card' }, { value: 'WALLET', label: 'Wallet' }, { value: 'TRANSFER', label: 'Transfer' }]} />
            <Segmented size="sm" value={size} onChange={setSize} options={SIZES.map((s) => ({ value: s, label: s }))} aria-label="Size" />
            <div className="flex flex-wrap items-center gap-5"><Checkbox checked={remember} onChange={setRemember} label="Remember this device" /><Checkbox checked={false} label="Restock" /><Checkbox checked indeterminate label="Some" /><Toggle checked={toggle} onChange={setToggle} label="Toggle" description="With description" /></div>
          </Section>

          <Section title="KpiCard · ChartCard · Progress">
            <div className="grid grid-cols-2 gap-3">
              <KpiCard label="Gross profit" value={formatMoney(7186000, 'EGP', { compact: true })} delta={10.1} deltaLabel="vs previous" sparkline={TREND.map((t) => t.profit)} />
              <KpiCard label="Avg basket" value={formatMoney(59054)} delta={-2.1} compact />
              <KpiCard label="Loading" value="" loading />
              <KpiCard label="Returns" value="4.2%" delta={1.3} invert sub="lower is better" compact />
            </div>
            <ChartCard title="Sales & profit trend" description="TrendChart" fallback={trendSummary(TREND)}><TrendChart data={TREND} height={120} /></ChartCard>
            <div className="flex flex-col gap-1.5"><Progress value={62} /><Progress value={30} tone="warn" /><Progress value={10} tone="danger" /></div>
            <p className="text-xs text-ink-2">Delta colour never alone: arrow icon + sign. Sparkline is decorative (aria-hidden); value is the text.</p>
          </Section>

          <Section title="VariantMatrix">
            <VariantMatrix sizes={SIZES} colors={COLORS} variants={VARIANTS} selectedId={cell} onSelect={(v) => setCell(v.id)} showTotals />
            <MatrixLegend threshold={5} />
            <p className="text-xs text-ink-2">Numbers always shown; tap a cell to select it. Grey = not a variant.</p>
          </Section>

          <Section title="DataTable" className="md:col-span-2">
            <p className="-mt-2 text-xs text-ink-2">sortable · sticky header · row select · column visibility · 25/50/100</p>
            <DataTable aria-label="Products" columns={columns} rows={[...ROWS].sort((a, b) => { const k = sort.key as keyof Row; const d = a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0; return sort.desc ? -d : d; })} rowKey={(r) => r.id} selectedKeys={selected} onSelectionChange={setSelected} sort={sort} onSortChange={setSort} page={{ page: 1, pageSize: 25, total: 40, onPage: () => undefined, onPageSize: () => undefined }} />
          </Section>

          <Section title="SearchInput · FilterBar · DateRangePicker · Tabs">
            <SearchInput value={search} onChange={setSearch} placeholder="Name, SKU or barcode" onScan={() => undefined} showKbd />
            <FilterBar chips={[{ key: 'stock', label: 'Stock', value: 'In stock', onClear: () => undefined }, { key: 'brand', label: 'Brand', onClick: () => undefined }, { key: 'size', label: 'Size', onClick: () => undefined }]} onMore={() => undefined} />
            <DateRangePicker value={range} onChange={setRange} compact />
            <Tabs value={tab} onChange={setTab} items={[{ value: 'variants', label: 'Variants', count: 12 }, { value: 'movements', label: 'Movements' }, { value: 'sales', label: 'Sales' }, { value: 'details', label: 'Details' }]} />
          </Section>

          <Section title="Dialog · ConfirmDialog · Panel · Popover · MenuItem">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setDialog('dialog')}>Dialog</Button>
              <Button variant="danger" onClick={() => setDialog('confirm')}>Confirm (danger)</Button>
              <Button onClick={() => setDialog('panel')}>Panel</Button>
              <Popover open={menu} onClose={() => setMenu(false)} anchor={<Button aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>Popover</Button>}>
                <MenuItem onClick={() => setMenu(false)}>Rename</MenuItem><MenuItem selected onClick={() => setMenu(false)}>Selected</MenuItem><div className="my-1 h-px bg-line" /><MenuItem danger onClick={() => setMenu(false)}>Archive</MenuItem>
              </Popover>
            </div>
            <Dialog open={dialog === 'dialog'} onClose={() => setDialog(null)} title="Void sale AV-2038?" description="Items return to stock and the sale is excluded from reports. This is recorded in the audit log." footer={<><Button onClick={() => setDialog(null)}>Cancel</Button><Button variant="danger" disabled={!reason} onClick={() => setDialog(null)}>Void sale</Button></>}>
              <Field label="Reason (required)" htmlFor="g-reason"><Input id="g-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Duplicate entry" data-autofocus /></Field>
            </Dialog>
            <ConfirmDialog open={dialog === 'confirm'} onClose={() => setDialog(null)} onConfirm={() => setDialog(null)} danger title="Disable Hana Tarek?" description="They are signed out immediately." confirmLabel="Disable user" />
            <Panel open={dialog === 'panel'} onClose={() => setDialog(null)} title="Panel" description="Sheet on mobile, Drawer on larger screens." footer={<Button variant="primary" block onClick={() => setDialog(null)}>Done</Button>}><p className="text-sm text-ink-2">Forms and quick views live here.</p></Panel>
            <p className="text-xs text-ink-2">Esc closes · focus returns to the trigger · scrim click closes.</p>
          </Section>

          <Section title="EmptyState · ErrorState · Skeleton">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[10px] bg-surface-2"><EmptyState compact title="No products yet" body="Add your first product or import a CSV." action={<Button size="sm" variant="primary">Add product</Button>} /></div>
              <div className="rounded-[10px] bg-surface-2"><ErrorState compact title="Couldn't load sales" error={new ApiError('INTERNAL', 'Request failed', 500)} onRetry={() => undefined} /></div>
            </div>
            <SkeletonRows rows={2} />
          </Section>

          <Section title="Stepper · Avatar · Receipt">
            <Stepper steps={['Basics', 'Images', 'Variants', 'Pricing', 'Review']} current={2} onStep={() => undefined} />
            <div className="flex items-center gap-2"><Avatar name="Omar Mansour" /><Avatar name="Nour Adel" /><Avatar name="Karim Samir" /><Avatar name="Salma Fawzy" size="xs" /><Avatar name="Avenue" size="lg" tone="accent" /></div>
            <Receipt sale={SAMPLE_SALE} className="max-w-[240px] text-[10px]" />
          </Section>
        </div>

        <StatesDemo />
      </Page>
    </>
  );
}
