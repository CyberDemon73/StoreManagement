import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { POST } from '@/app/api/v1/uploads/route';
import { getDb } from '@/db/client';
import { setBlobForTests } from '@/lib/blob';
import { call } from '../helpers/http';
import { createUser, sessionCookieFor } from '../helpers/users';

/** Sniffing gaps not covered by tests/uploads: script-capable formats and polyglots. */

let stored: Buffer[] = [];

beforeEach(() => {
  stored = [];
  setBlobForTests(async (name, body) => {
    stored.push(body);
    return { url: `https://store.public.blob.vercel-storage.com/${name}` };
  });
});

afterEach(() => setBlobForTests(null));

async function upload(bytes: Buffer, filename: string, type: string): Promise<Response> {
  const db = getDb();
  const m = await createUser(db, { role: 'MANAGER' });
  const form = new FormData();
  form.append('file', new File([new Uint8Array(bytes)], filename, { type }));
  return call(POST, { method: 'POST', path: '/api/v1/uploads', form, cookie: await sessionCookieFor(db, m.id) });
}

const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(document.cookie)</script><rect width="10" height="10"/></svg>',
);

describe('upload sniffing (security)', () => {
  it('rejects an SVG (scriptable) named .png even though sharp can decode it', async () => {
    const res = await upload(SVG, 'logo.png', 'image/png');
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe('Unsupported image');
    expect(stored).toHaveLength(0);
  });

  it('rejects HTML declared as image/png', async () => {
    const res = await upload(Buffer.from('<!doctype html><script>alert(1)</script>'), 'x.png', 'image/png');
    expect(res.status).toBe(400);
    expect(stored).toHaveLength(0);
  });

  it('rejects a GIF (not on the allowlist) named .jpg', async () => {
    const gif = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#00f' } }).gif().toBuffer();
    const res = await upload(gif, 'x.jpg', 'image/jpeg');
    expect(res.status).toBe(400);
    expect(stored).toHaveLength(0);
  });

  it('a PNG/HTML polyglot is re-encoded, so the appended payload never reaches storage', async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#f00' } }).png().toBuffer();
    const payload = '<script>alert("polyglot")</script>';
    const res = await upload(Buffer.concat([png, Buffer.from(payload)]), 'x.png', 'image/png');
    expect(res.status).toBe(201);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.includes(Buffer.from('<script>'))).toBe(false);
    expect((await sharp(stored[0]!).metadata()).format).toBe('png');
  });

  it('rejects an empty file', async () => {
    const res = await upload(Buffer.alloc(0), 'x.png', 'image/png');
    expect([400, 413]).toContain(res.status);
    expect(stored).toHaveLength(0);
  });
});
