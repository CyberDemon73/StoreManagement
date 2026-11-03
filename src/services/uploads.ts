import sharp, { type Metadata } from 'sharp';
import type { Db } from '@/db/client';
import { audit } from '@/lib/audit';
import type { AuthUser, ReqCtx } from '@/lib/auth';
import { putBlob } from '@/lib/blob';
import { AppError } from '@/lib/errors';

/** 4 MB: Vercel caps request bodies at 4.5 MB, so leave room for multipart overhead. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
/** Reject decompression bombs before decoding pixels. */
const MAX_PIXELS = 25_000_000;
const MAX_DIMENSION = 2000;

export interface UploadFile {
  bytes: Buffer;
  size: number;
  /** Client-declared MIME type; informational only — the format is sniffed from the bytes. */
  declaredType: string;
}

type ImageFormat = 'jpeg' | 'png' | 'webp';

const EXT: Record<ImageFormat, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' };
const CONTENT_TYPE: Record<ImageFormat, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function isAllowedFormat(f: string | undefined): f is ImageFormat {
  return f === 'jpeg' || f === 'png' || f === 'webp';
}

async function detectFormat(bytes: Buffer): Promise<ImageFormat> {
  let meta: Metadata | undefined;
  try {
    meta = await sharp(bytes).metadata();
  } catch {
    meta = undefined;
  }
  const format = meta?.format;
  if (!meta || !isAllowedFormat(format)) throw new AppError('VALIDATION', 'Unsupported image');
  if ((meta.width ?? 0) * (meta.height ?? 0) > MAX_PIXELS) {
    throw new AppError('VALIDATION', 'Image too large (max 25 megapixels)');
  }
  return format;
}

/** Re-encode (auto-orient, fit within 2000px, drop EXIF/ICC/XMP) in the same format. */
async function reencode(bytes: Buffer, format: ImageFormat): Promise<Buffer> {
  const img = sharp(bytes)
    .rotate()
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true });
  try {
    if (format === 'jpeg') return await img.jpeg({ quality: 85 }).toBuffer();
    if (format === 'png') return await img.png().toBuffer();
    return await img.webp({ quality: 85 }).toBuffer();
  } catch {
    throw new AppError('VALIDATION', 'Unsupported image');
  }
}

export async function storeImage(db: Db, user: AuthUser, file: UploadFile, ctx: ReqCtx): Promise<{ url: string }> {
  if (file.size > MAX_UPLOAD_BYTES || file.bytes.length > MAX_UPLOAD_BYTES) {
    throw new AppError('VALIDATION', 'File too large (max 4 MB)', { status: 413 });
  }
  const format = await detectFormat(file.bytes);
  const encoded = await reencode(file.bytes, format);
  const name = `products/${crypto.randomUUID()}.${EXT[format]}`;
  const { url } = await putBlob(name, encoded, CONTENT_TYPE[format]);
  await audit(db, { userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent }, 'upload.create', 'upload', null, null, {
    url,
    bytes: encoded.length,
    format,
  });
  return { url };
}
