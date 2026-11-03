'use client';
/**
 * Hex for a typed colour name ("Red", "navy", "olive"…) using the browser's own CSS colour list:
 * a canvas normalises any valid CSS colour to #rrggbb. Unknown names return undefined.
 */
let ctx: CanvasRenderingContext2D | null | undefined;

export function hexFromColorName(name: string): string | undefined {
  const n = name.trim().toLowerCase().replace(/\s+/g, '');
  if (!n || typeof document === 'undefined') return undefined;
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return undefined;
  // Two different sentinels: an invalid name leaves fillStyle unchanged, so both runs differ.
  ctx.fillStyle = '#000001';
  ctx.fillStyle = n;
  const a = String(ctx.fillStyle);
  ctx.fillStyle = '#000002';
  ctx.fillStyle = n;
  const b = String(ctx.fillStyle);
  return a === b && /^#[0-9a-f]{6}$/i.test(a) ? a.toUpperCase() : undefined;
}
