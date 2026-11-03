'use client';
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Badge, Chip, ColorSwatch } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { Dialog } from '@/components/ui/Overlay';
import type { SizePreset } from '@/types';
import type { SectionProps } from './shared';

const HEX = /^#[0-9a-fA-F]{6}$/;

export function InventorySection({ draft, patch }: SectionProps) {
  const [editing, setEditing] = useState<{ index: number; name: string; sizes: string } | null>(null);
  const [addingColor, setAddingColor] = useState(false);
  const [color, setColor] = useState({ name: '', hex: '#3F6B5C' });

  const savePreset = () => {
    if (!editing) return;
    const sizes = editing.sizes.split(',').map((s) => s.trim()).filter(Boolean);
    const preset: SizePreset = { name: editing.name.trim() || 'Untitled', sizes };
    const next = [...draft.sizePresets];
    if (editing.index >= next.length) next.push(preset); else next[editing.index] = preset;
    patch({ sizePresets: next });
    setEditing(null);
  };

  const addColor = () => {
    const name = color.name.trim();
    if (!name || !HEX.test(color.hex) || draft.colorPresets.some((c) => c.name.toLowerCase() === name.toLowerCase())) return;
    patch({ colorPresets: [...draft.colorPresets, { name, hex: color.hex.toUpperCase() }] });
    setColor({ name: '', hex: '#3F6B5C' }); setAddingColor(false);
  };

  return (
    <Card as="section" id="s-inv" className="flex flex-col gap-4" aria-labelledby="s-inv-h">
      <CardHeader id="s-inv-h" title="Inventory" />
      <Field label="Default low-stock threshold" htmlFor="in-thr" className="max-w-[220px]" help="New variants start with this threshold.">
        <Input id="in-thr" type="number" inputMode="numeric" min={0} align="right" value={draft.lowStockDefault} onChange={(e) => patch({ lowStockDefault: Math.max(0, parseInt(e.target.value, 10) || 0) })} />
      </Field>
      <div className="flex flex-col gap-1.5">
        <p className="text-[13px] font-medium">Size presets</p>
        <ul className="flex flex-col gap-1.5">
          {draft.sizePresets.map((p, i) => (
            <li key={`${p.name}-${i}`} className="flex flex-wrap items-center gap-1">
              <span className="w-24 shrink-0 truncate text-xs text-ink-2" title={p.name}>{p.name}</span>
              {p.sizes.map((s) => <Badge key={s}>{s}</Badge>)}
              <Button size="sm" variant="ghost" onClick={() => setEditing({ index: i, name: p.name, sizes: p.sizes.join(', ') })}>Edit</Button>
              <Button size="sm" variant="ghost" iconOnly aria-label={`Remove preset ${p.name}`} onClick={() => patch({ sizePresets: draft.sizePresets.filter((_, j) => j !== i) })}><X /></Button>
            </li>
          ))}
        </ul>
        <Button size="sm" className="self-start" leading={<Plus />} onClick={() => setEditing({ index: draft.sizePresets.length, name: '', sizes: '' })}>New preset</Button>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-[13px] font-medium">Color presets</p>
        <div className="flex flex-wrap gap-2">
          {draft.colorPresets.map((c) => <Chip key={c.name} leading={<ColorSwatch hex={c.hex} name={c.name} size="xs" />} onRemove={() => patch({ colorPresets: draft.colorPresets.filter((x) => x.name !== c.name) })}>{c.name}</Chip>)}
          {!addingColor && <Chip onClick={() => setAddingColor(true)} leading={<Plus className="size-3.5" aria-hidden />}>Add</Chip>}
        </div>
        {addingColor && (
          <form className="flex flex-wrap items-end gap-2 rounded-card border border-dashed border-line p-3" onSubmit={(e) => { e.preventDefault(); addColor(); }}>
            <Field label="Name" htmlFor="col-name" className="min-w-[140px] flex-1"><Input id="col-name" size="sm" autoFocus value={color.name} onChange={(e) => setColor({ ...color, name: e.target.value })} placeholder="e.g. Terracotta" /></Field>
            <Field label="Hex" htmlFor="col-hex" className="w-32"><Input id="col-hex" size="sm" value={color.hex} invalid={!HEX.test(color.hex)} onChange={(e) => setColor({ ...color, hex: e.target.value })} leading={<ColorSwatch hex={HEX.test(color.hex) ? color.hex : '#FFFFFF'} name="Preview" size="sm" />} /></Field>
            <input type="color" aria-label="Pick colour" value={HEX.test(color.hex) ? color.hex : '#3F6B5C'} onChange={(e) => setColor({ ...color, hex: e.target.value.toUpperCase() })} className="size-8 cursor-pointer rounded-input border border-line bg-surface" />
            <Button size="sm" variant="primary" type="submit" disabled={!color.name.trim() || !HEX.test(color.hex)}>Add colour</Button>
            <Button size="sm" variant="ghost" onClick={() => setAddingColor(false)}>Cancel</Button>
          </form>
        )}
      </div>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing && editing.index < draft.sizePresets.length ? 'Edit size preset' : 'New size preset'} description="Sizes are comma-separated and keep the order you type."
        footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" onClick={savePreset} disabled={!editing?.sizes.trim()}>Save preset</Button></>}>
        {editing && (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); savePreset(); }}>
            <Field label="Preset name" htmlFor="sp-name"><Input id="sp-name" data-autofocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Apparel" /></Field>
            <Field label="Sizes" htmlFor="sp-sizes" help="e.g. XS, S, M, L, XL"><Input id="sp-sizes" value={editing.sizes} onChange={(e) => setEditing({ ...editing, sizes: e.target.value })} /></Field>
            <div className="flex flex-wrap gap-1">{editing.sizes.split(',').map((s) => s.trim()).filter(Boolean).map((s, i) => <Badge key={`${s}-${i}`}>{s}</Badge>)}</div>
          </form>
        )}
      </Dialog>
    </Card>
  );
}
