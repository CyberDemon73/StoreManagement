import { describe, expect, it } from 'vitest';
import { brandBody, brandPatch } from '@/schemas/catalog';

describe('brand schema', () => {
  it('accepts only https logo URLs', () => {
    expect(brandBody.safeParse({ name: 'A', logoUrl: 'https://cdn.example.com/a.png' }).success).toBe(true);
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'http://x.example/a.png', 'ftp://x/a.png']) {
      expect(brandPatch.safeParse({ logoUrl: bad }).success, bad).toBe(false);
    }
  });
});
