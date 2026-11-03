# Avenue Stock — brand kit

Calm, quiet, confident: a well-run boutique's back office. The brand is one mark, one typeface and one accent colour, used sparingly.

## Logo

**Mark** — an "A" whose crossbar runs on as a clothes rail, with a sand dot for the hanger: stock on the rail. Rounded 6.5-unit strokes on a 64-unit grid, sage tile with 16-unit corners.

| File | Use |
|---|---|
| `public/brand/mark.svg` | Primary tile mark (sage tile, white glyph, sand dot). Any size ≥ 20 px. |
| `public/brand/mark-mono.svg` | Glyph only in `currentColor` — receipts, labels, embossing, on photos. |
| `public/brand/logo-horizontal.svg` / `-dark.svg` | Mark + wordmark lockup for light / dark backgrounds. |
| `public/brand/wordmark.svg` | Wordmark alone (only next to the mark elsewhere on the page). |
| `public/brand/og-image.png` | 1200×630 social preview. |
| `public/icons/*` | PWA icons 192/512 (maskable, glyph inside the central 80 %), Apple touch 180, favicon PNGs. |
| `src/app/favicon.ico`, `src/app/icon.svg` | Picked up by Next.js automatically. |

In code use `<LogoMark size variant />`, `<Wordmark />` and `<LogoLockup subtitle />` from `src/components/app/Brand.tsx`. Never retype the glyph.

**Clear space** = the height of the crossbar stroke on every side. **Minimum size** 20 px (tile), 10 px (mono glyph on labels). Do not rotate, recolour the tile, add shadows or gradients, outline the glyph, or set the wordmark in another typeface.

## Wordmark

"Avenue" in Inter 600, "Stock" in Inter 400, −0.02 em tracking, one space between. Ink on light, `--ink` dark value on dark. Spoken name: "Avenue Stock"; short name (home screen): "Avenue".

## Colour

| Token | Light | Dark | Role |
|---|---|---|---|
| `--accent` sage | `#3F6B5C` | `#7FB5A0` | mark tile, primary actions, active nav, chart line |
| `--accent-soft` | `#E3EDE8` | `#223229` | selected states, tints |
| sand (brand secondary) | `#C8B89A` | same | the hanger dot, underline rule, warm highlights only — never for text |
| `--bg` | `#F7F6F3` | `#141715` | page |
| `--surface` | `#FFFFFF` | `#1C201E` | cards |
| `--ink` / `--ink-2` | `#1F2421` / `#5B625D` | `#ECEEEB` / `#AEB5B0` | text |
| status ok / warn / danger / info | `#2F7D5B` / `#B7791F` / `#B04A3F` / `#3D6A8A` | lighter variants | meaning only, never decoration |

Every token is defined once in `src/app/globals.css`.

## Type

Inter (Google Fonts, self-hosted by `next/font`). Headings 600, body 400, small caps labels 11 px / 600 / 0.08 em. Numbers always `font-variant-numeric: tabular-nums`. Base size 15 px on phones, 14 px on desktop tables.

## Shape & motion

12 px card radius, 8 px inputs, 16 px mark tile (at 64). 1 px `--line` borders; one soft shadow for floating sheets and menus only. 150–200 ms ease-out; sheets slide up, drawers slide in from the right; nothing bounces.

## Voice

Short, specific, calm. Numbers in EGP with two decimals. No exclamation marks. Errors say what happened and that nothing was changed. The product is "Avenue Stock"; the store is "Avenue".

## Applications

- **App chrome**: mark 32 px + wordmark in the sidebar; mark alone in the icon rail and phone top bar.
- **Auth pages**: mark 64 px centred above the wordmark and "Zamalek store".
- **Receipts**: mono glyph 28 px above the store name (toggle in Settings → Receipt).
- **Labels (A4)**: mono glyph 10 px before the product name when "Show store logo" is on.
- **PWA**: theme colour `#3F6B5C`, background `#F7F6F3`, short name "Avenue".
