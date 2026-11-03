import { describe, expect, it } from 'vitest';
import { moneyInputText, parseMoneyInput } from '@/lib/money-input';

describe('money input (whole pounds)', () => {
  it('shows whole pounds without decimals', () => {
    expect(moneyInputText(undefined)).toBe('');
    expect(moneyInputText(500)).toBe('5');
    expect(moneyInputText(109_000)).toBe('1090');
    expect(moneyInputText(0)).toBe('0');
  });

  it('keeps existing piastres visible instead of rounding them away', () => {
    expect(moneyInputText(109_050)).toBe('1090.50');
  });

  it('parses typed digits as pounds into minor units', () => {
    expect(parseMoneyInput('5')).toBe(500);
    expect(parseMoneyInput('1,090')).toBe(109_000);
    expect(parseMoneyInput('1090.5')).toBe(109_050);
    expect(parseMoneyInput('')).toBeUndefined();
    expect(parseMoneyInput('abc')).toBeUndefined();
  });
});
