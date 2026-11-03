/** Uppercase and keep only A-Z0-9, so "Navy Blue" → "NAVYBLUE", "32 W" → "32W". */
export function skuPart(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Variant SKU per docs/SPRINTS.md: BASE-SIZE-COLOR. */
export function buildSku(baseSku: string, size: string, colorName: string): string {
  return `${baseSku}-${skuPart(size)}-${skuPart(colorName)}`;
}

function padTo(value: string, length: number): string {
  return value.slice(0, length).padEnd(length, 'X');
}

/** Default product base SKU: two letters of the brand, three of the name (padded with X). */
export function defaultBaseSku(brandName: string, productName: string): string {
  return `${padTo(skuPart(brandName), 2)}-${padTo(skuPart(productName), 3)}`;
}
