import { describe, expect, it } from 'vitest';
import { scanText } from '../../scripts/scan-secrets.mjs';

// Fixtures are assembled at runtime so this file never holds a real-looking secret literal
// (the repo-wide `pnpm secrets:scan` must stay clean).
const hex = (n: number) => '9f3a1c7e5b2d8046'.repeat(Math.ceil(n / 16)).slice(0, n);
const mixed = ['Qz7', 'Lp2', 'Xw9', 'Rk4', 'Tn8', 'Vb3', 'Hm6', 'Jc1', 'Fd5', 'Gs0'].join('');
const eq = '=';
const colon = ':';

const scan = (name: string, text: string) => scanText(name, text) as string[];

describe('scanText', () => {
  it('returns no hits for clean text', () => {
    expect(scan('src/a.ts', 'const x = 1;\nexport const y = "hello";')).toEqual([]);
  });

  describe('hex secrets (below the entropy threshold, so a separate rule)', () => {
    it('flags a >= 32-char hex value assigned to a SECRET/TOKEN/KEY/PASSWORD-like name', () => {
      for (const name of ['SESSION_SECRET', 'CRON_SECRET', 'API_TOKEN', 'SIGNING_KEY', 'ADMIN_PASSWORD']) {
        const hits = scan('src/config.ts', `${name}${eq}${hex(64)}`);
        expect(hits.length, name).toBeGreaterThan(0);
        expect(hits.join('\n')).toMatch(/hex/i);
      }
      expect(scan('.env.example', `CRON_SECRET${eq}"${hex(32)}"`).length).toBeGreaterThan(0);
    });

    it('ignores short hex, hex under unrelated names, and degenerate values', () => {
      expect(scan('src/config.ts', `CRON_SECRET${eq}${hex(31)}`)).toEqual([]);
      expect(scan('src/config.ts', `COMMIT_SHA${eq}${hex(40)}`)).toEqual([]);
      expect(scan('src/config.ts', `CRON_SECRET${eq}${'0'.repeat(64)}`)).toEqual([]);
    });
  });

  describe('JSON keys (closing quote before the colon)', () => {
    it('flags a high-entropy value under a quoted secret-like key', () => {
      const hits = scan('config/vercel.json', `{ "SESSION_SECRET"${colon} "${mixed}" }`);
      expect(hits.length).toBeGreaterThan(0);
    });

    it('still ignores placeholder values in JSON', () => {
      expect(scan('config/vercel.json', `{ "SESSION_SECRET"${colon} "changeme" }`)).toEqual([]);
    });
  });

  describe('Neon npg_ passwords', () => {
    it('flags an npg_ token anywhere, including tests and docs', () => {
      const value = ['npg', '_', 'A1b2C3d4E5f6G7'].join('');
      expect(scan('src/a.ts', `const p = "${value}";`).length).toBeGreaterThan(0);
      expect(scan('docs/SETUP.md', `use ${value} here`).length).toBeGreaterThan(0);
    });

    it('does not flag a too-short npg_ string', () => {
      expect(scan('src/a.ts', ['npg', '_', 'abc'].join(''))).toEqual([]);
    });
  });

  describe('*PASSWORD values of any length >= 8', () => {
    it('flags a short, low-entropy password that the generic rule would miss', () => {
      const pw = ['Hun', 'ter', '2Pass'].join('');
      expect(scan('config/app.env.sample', `DB_PASSWORD${eq}${pw}`).length).toBeGreaterThan(0);
      expect(scan('docker-compose.yml', `      POSTGRES_PASSWORD${colon} "${pw}"`).length).toBeGreaterThan(0);
    });

    it('ignores placeholders, short values, env references and code', () => {
      expect(scan('docker-compose.yml', `POSTGRES_PASSWORD${colon} postgres # throwaway`)).toEqual([]);
      expect(scan('a.env.sample', `DB_PASSWORD${eq}changeme`)).toEqual([]);
      expect(scan('a.env.sample', `DB_PASSWORD${eq}`)).toEqual([]);
      expect(scan('a.env.sample', `DB_PASSWORD${eq}short`)).toEqual([]);
      expect(scan('ci.yml', `DB_PASSWORD${colon} \${{ secrets.DB_PASSWORD }}`)).toEqual([]);
      expect(scan('src/a.ts', `const ADMIN_PASSWORD${eq} process.env.ADMIN_PASSWORD;`)).toEqual([]);
      expect(scan('src/a.ts', `const schema = { newPassword${colon} z.string().min(8) };`)).toEqual([]);
    });
  });

  it('a "secrets-scan: allow" marker suppresses the line', () => {
    expect(scan('src/a.ts', `CRON_SECRET${eq}${hex(64)} // secrets-scan: allow`)).toEqual([]);
  });
});
