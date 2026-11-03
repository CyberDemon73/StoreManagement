import { describe, expect, it } from 'vitest';
import { toCsv } from '@/lib/csv';

describe('toCsv', () => {
  it('writes a header from the first row and quotes as needed', () => {
    const csv = toCsv([
      { name: 'Plain', total: 1200 },
      { name: 'Has, comma', total: 0 },
      { name: 'Has "quote"', total: -5 },
    ]);
    expect(csv).toBe('name,total\r\nPlain,1200\r\n"Has, comma",0\r\n"Has ""quote""",-5\r\n');
  });

  it('neutralises spreadsheet formulas in text cells (CSV injection)', () => {
    const csv = toCsv([{ a: '=SUM(1)', b: '+1', c: '-cmd', d: '@x', e: '\tx' }]);
    expect(csv.split('\r\n')[1]).toBe("'=SUM(1),'+1,'-cmd,'@x,'\tx");
  });

  it('leaves numbers alone (negative numbers are not formulas) and writes empty cells for null', () => {
    expect(toCsv([{ n: -12, x: null, y: undefined, b: true }])).toBe('n,x,y,b\r\n-12,,,true\r\n');
  });

  it('returns an empty string for no rows', () => {
    expect(toCsv([])).toBe('');
  });
});
