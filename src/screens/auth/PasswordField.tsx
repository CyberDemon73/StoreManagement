'use client';
/** Password input with show/hide and a 4-segment strength bar shared by the reset, invite and setup screens. */
import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Field, Input } from '@/components/ui/Field';

const COMMON = new Set(['password', 'password1', '123456789012', 'qwertyuiop12', 'avenuestock1', 'letmein12345']);

/** 0–4. Length is the main signal; variety adds; common words zero it. */
export function passwordStrength(pw: string): { score: number; label: string } {
  if (!pw) return { score: 0, label: '' };
  if (COMMON.has(pw.toLowerCase())) return { score: 0, label: 'Too common' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length >= 16) score = Math.min(4, score + 1);
  const label = pw.length < 12 ? 'Too short · 12+ characters' : score >= 4 ? 'Strong · 12+ characters, not a common password.' : score >= 3 ? 'Good' : 'Fair · add numbers or symbols';
  return { score: Math.min(4, score), label };
}

export const passwordOk = (pw: string) => pw.length >= 12 && passwordStrength(pw).score >= 2;

export function PasswordField({ id, label, value, onChange, autoComplete = 'new-password', placeholder, showStrength = true, error, autoFocus }: { id: string; label: string; value: string; onChange: (v: string) => void; autoComplete?: string; placeholder?: string; showStrength?: boolean; error?: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  const s = passwordStrength(value);
  const tone = s.score >= 4 ? 'bg-ok' : s.score >= 3 ? 'bg-accent' : s.score >= 2 ? 'bg-warn' : 'bg-danger';
  return (
    <Field label={label} htmlFor={id} error={error} help={showStrength && value && !error ? s.label : undefined}>
      <Input id={id} type={show ? 'text' : 'password'} size="lg" autoComplete={autoComplete} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} invalid={!!error} autoFocus={autoFocus} required
        trailing={<button type="button" aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} onClick={() => setShow((v) => !v)} className="rounded p-1 hover:bg-surface-2">{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>} />
      {showStrength && (
        <div className="mt-0.5 flex gap-1" aria-hidden>
          {[0, 1, 2, 3].map((i) => <i key={i} className={cn('h-1 flex-1 rounded-full transition-colors', value && i < s.score ? tone : 'bg-line')} />)}
        </div>
      )}
    </Field>
  );
}
