'use client';
/**
 * Print on desktop; on phones and the installed app, turn the visible `.print-area` into a PDF
 * and open the share sheet (Save to Files, WhatsApp, AirDrop, a printer app…). iOS Safari has no
 * usable window.print() inside an installed web app, and sharing a PDF works everywhere.
 */

function isPhoneLike(): boolean {
  if (typeof window === 'undefined') return false;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  return standalone || window.matchMedia('(pointer: coarse)').matches;
}

/** The `.print-area` the user is looking at (dialogs render later in the DOM, so prefer the last visible one). */
function visiblePrintArea(): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>('.print-area')];
  return all.reverse().find((el) => el.offsetParent !== null || el.getClientRects().length > 0) ?? null;
}

async function renderPdf(el: HTMLElement): Promise<Blob> {
  const [{ domToCanvas }, { jsPDF }] = await Promise.all([import('modern-screenshot'), import('jspdf')]);
  const canvas = await domToCanvas(el, { scale: 2, backgroundColor: '#ffffff' });
  const widthPx = el.getBoundingClientRect().width;
  // Receipts are an 80 mm roll: one tall page. Anything wider (labels) goes on A4 pages.
  const narrow = widthPx <= 420;
  const pageW = narrow ? 80 : 210;
  const margin = narrow ? 4 : 10;
  const contentW = pageW - margin * 2;
  const scale = contentW / canvas.width; // mm per canvas px
  const fullH = canvas.height * scale;
  if (narrow) {
    const pdf = new jsPDF({ unit: 'mm', format: [pageW, fullH + margin * 2] });
    pdf.addImage(canvas, 'PNG', margin, margin, contentW, fullH);
    return pdf.output('blob');
  }
  const pageH = 297;
  const sliceHmm = pageH - margin * 2;
  const slicePx = Math.floor(sliceHmm / scale);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  for (let y = 0, page = 0; y < canvas.height; y += slicePx, page++) {
    const h = Math.min(slicePx, canvas.height - y);
    const part = document.createElement('canvas');
    part.width = canvas.width;
    part.height = h;
    part.getContext('2d')?.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
    if (page > 0) pdf.addPage();
    pdf.addImage(part, 'PNG', margin, margin, contentW, h * scale);
  }
  return pdf.output('blob');
}

function download(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * iOS only lets share() run straight from a tap. Rendering the PDF takes a moment, so when the
 * original tap has expired we show one "Share PDF" button whose tap is fresh.
 */
function offerShareButton(file: File): void {
  document.getElementById('share-pdf-offer')?.remove();
  const btn = document.createElement('button');
  btn.id = 'share-pdf-offer';
  btn.type = 'button';
  btn.textContent = 'Share PDF';
  btn.className = 'no-print fixed inset-x-6 bottom-28 z-[95] mx-auto max-w-xs rounded-full bg-accent px-6 py-3 text-[15px] font-semibold text-accent-ink shadow-float';
  btn.onclick = async () => {
    btn.remove();
    try { await navigator.share({ files: [file], title: file.name }); } catch { /* cancelled */ }
  };
  document.body.appendChild(btn);
  setTimeout(() => btn.remove(), 30_000);
}

export async function printOrShare(filename: string): Promise<void> {
  if (!isPhoneLike()) { window.print(); return; }
  const el = visiblePrintArea();
  if (!el) { window.print(); return; }
  const blob = await renderPdf(el);
  const file = new File([blob], filename.endsWith('.pdf') ? filename : `${filename}.pdf`, { type: 'application/pdf' });
  if (!navigator.canShare?.({ files: [file] })) { download(file); return; }
  try {
    await navigator.share({ files: [file], title: file.name });
  } catch (e) {
    if ((e as DOMException).name === 'NotAllowedError') offerShareButton(file);
    // AbortError = the user closed the sheet; nothing to do.
  }
}
