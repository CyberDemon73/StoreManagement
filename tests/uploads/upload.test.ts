import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { POST } from '@/app/api/v1/uploads/route';
import { getDb } from '@/db/client';
import { auditLog } from '@/db/schema';
import { setBlobForTests } from '@/lib/blob';
import { call } from '../helpers/http';
import { createUser, sessionCookieFor } from '../helpers/users';

interface Captured {
  name: string;
  body: Buffer;
  contentType: string;
}

let captured: Captured[] = [];

beforeEach(() => {
  captured = [];
  setBlobForTests(async (name, body, contentType) => {
    captured.push({ name, body, contentType });
    return { url: `https://store.public.blob.vercel-storage.com/${name}` };
  });
});

afterEach(() => {
  setBlobForTests(null);
});

function formWith(bytes: Uint8Array | Buffer, filename: string, type: string): FormData {
  const f = new FormData();
  f.append('file', new File([new Uint8Array(bytes)], filename, { type }));
  return f;
}

async function managerCookie(): Promise<string> {
  const db = getDb();
  const m = await createUser(db, { role: 'MANAGER' });
  return sessionCookieFor(db, m.id);
}

/** Uncompressed + EXIF, so a faithful re-encode must produce different bytes (sharp output is deterministic). */
function redPng(): Promise<Buffer> {
  return sharp({ create: { width: 2, height: 2, channels: 3, background: '#ff0000' } })
    .png({ compressionLevel: 0 })
    .withMetadata({ exif: { IFD0: { Artist: 'Someone' } } })
    .toBuffer();
}

describe('POST /uploads', () => {
  it('stores a re-encoded PNG under a random name and returns 201 { url }', async () => {
    const input = await redPng();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const res = await call(POST, { method: 'POST', path: '/api/v1/uploads', form: formWith(input, 'a.png', 'image/png'), cookie: await managerCookie() });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.url).toMatch(/^https:\/\/.+\/products\/[0-9a-f-]{36}\.png$/);
    expect(captured).toHaveLength(1);
    const [blob] = captured;
    expect(blob!.name).toMatch(/^products\/[0-9a-f-]{36}\.png$/);
    expect(blob!.contentType).toBe('image/png');
    expect(Buffer.compare(blob!.body, input)).not.toBe(0);
    const meta = await sharp(blob!.body).metadata();
    expect(meta.format).toBe('png');
    expect(meta.exif).toBeUndefined();

    const rows = await getDb().select().from(auditLog);
    const entry = rows.find((r) => r.action === 'upload.create');
    expect(entry).toBeDefined();
    expect(entry!.entity).toBe('upload');
    expect(entry!.after).toMatchObject({ url: body.url, format: 'png' });
  });

  it('strips EXIF from a JPEG', async () => {
    const input = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#00ff00' } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'secret-camera', Artist: 'Someone' } } })
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const res = await call(POST, { method: 'POST', path: '/api/v1/uploads', form: formWith(input, 'p.jpg', 'image/jpeg'), cookie: await managerCookie() });
    expect(res.status).toBe(201);
    expect((await res.json()).url).toMatch(/\/products\/[0-9a-f-]{36}\.jpg$/);
    expect(captured[0]!.contentType).toBe('image/jpeg');
    const meta = await sharp(captured[0]!.body).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
  });

  it('rejects a text file named .jpg with 400 Unsupported image and stores nothing', async () => {
    const res = await call(POST, {
      method: 'POST',
      path: '/api/v1/uploads',
      form: formWith(Buffer.from('definitely not an image'), 'evil.jpg', 'image/jpeg'),
      cookie: await managerCookie(),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.message).toBe('Unsupported image');
    expect(captured).toHaveLength(0);
  });

  it('rejects a file over 4 MB with 413 and stores nothing', async () => {
    const big = Buffer.alloc(6 * 1024 * 1024, 1);
    const res = await call(POST, { method: 'POST', path: '/api/v1/uploads', form: formWith(big, 'big.png', 'image/png'), cookie: await managerCookie() });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.message).toBe('File too large (max 4 MB)');
    expect(captured).toHaveLength(0);
  });

  it('rejects a 4.5 MB file with 413', async () => {
    const big = Buffer.alloc(4.5 * 1024 * 1024, 1);
    const res = await call(POST, { method: 'POST', path: '/api/v1/uploads', form: formWith(big, 'big.png', 'image/png'), cookie: await managerCookie() });
    expect(res.status).toBe(413);
    expect((await res.json()).error.message).toBe('File too large (max 4 MB)');
    expect(captured).toHaveLength(0);
  });

  it('rejects by content-length header before reading the body', async () => {
    const res = await call(POST, {
      method: 'POST',
      path: '/api/v1/uploads',
      form: formWith(await redPng(), 'a.png', 'image/png'),
      headers: { 'content-length': '6000000' },
      cookie: await managerCookie(),
    });
    expect(res.status).toBe(413);
    expect((await res.json()).error.message).toBe('File too large (max 4 MB)');
    expect(captured).toHaveLength(0);
  });

  it('downscales wide images to fit within 2000px', async () => {
    const input = await sharp({ create: { width: 3000, height: 100, channels: 3, background: '#0000ff' } }).png().toBuffer();
    const res = await call(POST, { method: 'POST', path: '/api/v1/uploads', form: formWith(input, 'w.png', 'image/png'), cookie: await managerCookie() });
    expect(res.status).toBe(201);
    const meta = await sharp(captured[0]!.body).metadata();
    expect(meta.width).toBe(2000);
  });

  it('rejects images over 25 megapixels with 400', async () => {
    const input = await sharp({ create: { width: 6000, height: 5000, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const res = await call(POST, { method: 'POST', path: '/api/v1/uploads', form: formWith(input, 'huge.png', 'image/png'), cookie: await managerCookie() });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.message).toBe('Image too large (max 25 megapixels)');
    expect(captured).toHaveLength(0);
  });

  it('returns 400 with fields.file when the file field is missing', async () => {
    const f = new FormData();
    f.append('other', 'x');
    const res = await call(POST, { method: 'POST', path: '/api/v1/uploads', form: f, cookie: await managerCookie() });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.fields.file).toBeTypeOf('string');
  });

  it('returns 400 for a non-multipart body', async () => {
    const res = await call(POST, { method: 'POST', path: '/api/v1/uploads', body: { file: 'x' }, cookie: await managerCookie() });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe('Expected multipart form-data');
  });

  it('returns 403 for a SELLER and 401 anonymously', async () => {
    const db = getDb();
    const s = await createUser(db, { role: 'SELLER' });
    const input = await redPng();
    const forbidden = await call(POST, { method: 'POST', path: '/api/v1/uploads', form: formWith(input, 'a.png', 'image/png'), cookie: await sessionCookieFor(db, s.id) });
    expect(forbidden.status).toBe(403);
    const anon = await call(POST, { method: 'POST', path: '/api/v1/uploads', form: formWith(input, 'a.png', 'image/png') });
    expect(anon.status).toBe(401);
    expect(captured).toHaveLength(0);
  });
});
