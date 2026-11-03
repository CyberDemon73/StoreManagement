'use client';
import { useTheme, type Theme } from '@/lib/theme-context';
import { cn } from '@/lib/cn';
import { Card, CardHeader } from '@/components/ui/Card';

const OPTIONS: { value: Theme; label: string; swatch: string }[] = [
  { value: 'light', label: 'Light', swatch: 'bg-[#F7F6F3] border border-[#E6E3DC]' },
  { value: 'dark', label: 'Dark', swatch: 'bg-[#141715]' },
  { value: 'system', label: 'System', swatch: 'bg-[linear-gradient(90deg,#F7F6F3_50%,#141715_50%)] border border-[#E6E3DC]' },
];

export function AppearanceSection() {
  const { theme, setTheme, resolved } = useTheme();
  return (
    <Card as="section" id="s-app" className="flex flex-col gap-3 xl:col-span-2" aria-labelledby="s-app-h">
      <CardHeader id="s-app-h" title="Appearance" description="Per device. Saved on this browser only, not in store settings." />
      <fieldset className="flex flex-wrap items-start gap-3">
        <legend className="sr-only">Theme</legend>
        {OPTIONS.map((o) => (
          <label key={o.value} className={cn('flex w-40 cursor-pointer flex-col gap-2 rounded-card border p-3 transition-colors', theme === o.value ? 'border-accent bg-accent-soft/40' : 'border-line hover:bg-surface-2')}>
            <span aria-hidden className={cn('block h-14 rounded-lg', o.swatch)} />
            <span className="flex items-center gap-2 text-sm"><input type="radio" name="theme" value={o.value} checked={theme === o.value} onChange={() => setTheme(o.value)} className="size-4 accent-[var(--accent)]" />{o.label}</span>
          </label>
        ))}
        <p className="max-w-xs text-xs text-ink-2">“System” follows prefers-color-scheme (currently {resolved}). The theme toggle is also in the profile menu.</p>
      </fieldset>
    </Card>
  );
}
