/**
 * Browser-side shrink before POST /uploads. Vercel rejects request bodies over 4.5 MB before our
 * handler runs, so a 50 MB phone photo has to be made smaller on the device. The server still
 * validates magic bytes, size and pixel count, and re-encodes to ≤ 2000 px, so nothing here is trusted.
 */
export const MAX_PICK_BYTES = 50 * 1024 * 1024;
/** Must match MAX_UPLOAD_BYTES in services/uploads.ts. */
export const MAX_SEND_BYTES = 4 * 1024 * 1024;
const MAX_EDGE = 2000;

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Returns a file the upload route will accept, or throws with a message for the user. */
export async function shrinkForUpload(file: File): Promise<File> {
  if (file.size > MAX_PICK_BYTES) throw new Error(`${file.name} is over 50 MB.`);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name} could not be read as an image. Use JPG, PNG or WebP.`);
  }
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    // Already small enough in both bytes and pixels: send the original untouched.
    if (scale === 1 && file.size <= MAX_SEND_BYTES && /^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const g = canvas.getContext('2d');
    if (!g) throw new Error('This browser cannot resize images.');
    g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.9, 0.8, 0.7, 0.55]) {
      const blob = await toBlob(canvas, 'image/webp', quality) ?? await toBlob(canvas, 'image/jpeg', quality);
      if (blob && blob.size <= MAX_SEND_BYTES) {
        const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
        return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.' + ext, { type: blob.type });
      }
    }
    throw new Error(`${file.name} is still too large after resizing.`);
  } finally {
    bitmap.close();
  }
}
