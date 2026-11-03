import { put } from '@vercel/blob';
import { getEnv } from './env';
import { AppError } from './errors';

export type BlobWriter = (name: string, body: Buffer, contentType: string) => Promise<{ url: string }>;

let testWriter: BlobWriter | null = null;

/** Test seam: capture blob writes instead of calling Vercel Blob. Pass null to restore. */
export function setBlobForTests(fn: BlobWriter | null): void {
  testWriter = fn;
}

/** Store a public blob under an exact name (callers pick a random, unguessable one). */
export async function putBlob(name: string, body: Buffer, contentType: string): Promise<{ url: string }> {
  if (testWriter) return testWriter(name, body, contentType);
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  if (!token) throw new AppError('INTERNAL', 'Storage not configured');
  const res = await put(name, body, { access: 'public', contentType, addRandomSuffix: false, token });
  return { url: res.url };
}
