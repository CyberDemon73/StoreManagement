'use client';
/** Users · admin-set password fields (create user, set password) and the shown-once generated password. */
import { useId, useState } from 'react';
import { Copy, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Input } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';

/** Matches passwordSchema in schemas/auth.ts; the server checks again (and rejects common passwords). */
export const MIN_PASSWORD = 10;

export interface PasswordChoiceValue { password: string; mustChange: boolean }
export const EMPTY_CHOICE: PasswordChoiceValue = { password: '', mustChange: true };

/** Client hint only: blank is valid (the server generates one). */
export function passwordChoiceError(v: PasswordChoiceValue): string | undefined {
  return v.password && v.password.length < MIN_PASSWORD ? `Use at least ${MIN_PASSWORD} characters, or leave it blank.` : undefined;
}

/** Body fields for POST /users (TEMP) and POST /users/:id/reset-password (TEMP). */
export function choiceBody(v: PasswordChoiceValue): { password?: string; mustChange: boolean } {
  return v.password ? { password: v.password, mustChange: v.mustChange } : { mustChange: v.mustChange };
}

export function PasswordChoice({ value, onChange, error }: { value: PasswordChoiceValue; onChange: (v: PasswordChoiceValue) => void; error?: string }) {
  const id = useId();
  const [show, setShow] = useState(false);
  const eye = <button type="button" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow((s) => !s)} className="rounded p-1 hover:bg-surface-2">{show ? <EyeOff /> : <Eye />}</button>;
  return (
    <div className="flex flex-col gap-3">
      <Field label="Password" htmlFor={`${id}-pw`} error={error} help={error ? undefined : `Leave blank to generate a strong one. At least ${MIN_PASSWORD} characters.`}>
        <Input id={`${id}-pw`} type={show ? 'text' : 'password'} size="lg" autoComplete="new-password" value={value.password} onChange={(e) => onChange({ ...value, password: e.target.value })} invalid={!!error} trailing={eye} />
      </Field>
      <Checkbox checked={value.mustChange} onChange={(mustChange) => onChange({ ...value, mustChange })} label="Ask them to choose their own password at next sign-in" />
    </div>
  );
}

export function GeneratedPassword({ password }: { password: string }) {
  const { toast } = useToast();
  const copy = () => { void navigator.clipboard?.writeText(password).then(() => toast({ kind: 'info', title: 'Password copied' })).catch(() => undefined); };
  return (
    <div className="flex items-center gap-2 rounded-input border border-line bg-surface-2 px-3 py-2">
      <span className="tabular flex-1 select-all break-all font-mono text-sm" aria-label="Generated password">{password}</span>
      <Button size="sm" variant="ghost" leading={<Copy />} onClick={copy} data-autofocus>Copy</Button>
    </div>
  );
}
