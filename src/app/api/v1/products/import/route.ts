import { withAuth } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { json } from '@/lib/http';
import { parse } from '@/lib/validate';
import { importQuery } from '@/schemas/import';
import { importProducts, MAX_IMPORT_BYTES } from '@/services/product-import';
import { requireUser } from '@/services/products';

/** Allowance for multipart boundaries and part headers on top of the file itself. */
const MULTIPART_OVERHEAD = 64 * 1024;
const TOO_LARGE = 'File too large (max 2 MB)';

export const runtime = 'nodejs';
// A 5,000-row commit (bulk inserts + bulk opening stock) needs more than the 10 s Hobby default.
export const maxDuration = 60;

/**
 * POST /products/import[?dryRun=1] — multipart field `file` (CSV).
 * Dry run → 200 { rows, ok, errors }. Commit → 201 { rows, ok, errors: [], created } or, when any
 * row fails, 400 with the error envelope plus the same report and nothing written.
 */
export const POST = withAuth({ permission: 'export.csv' }, async (req, { db, user, req: ctx }) => {
  const { dryRun } = await parse(importQuery, new URL(req.url).searchParams);
  const actor = requireUser(user);
  if (Number(req.headers.get('content-length') ?? 0) > MAX_IMPORT_BYTES + MULTIPART_OVERHEAD) {
    throw new AppError('VALIDATION', 'Invalid file', { fields: { file: TOO_LARGE } });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError('VALIDATION', 'Expected multipart form-data', { fields: { file: 'A CSV file is required' } });
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    throw new AppError('VALIDATION', 'Invalid input', { fields: { file: 'A CSV file is required' } });
  }
  if (file.size > MAX_IMPORT_BYTES) {
    throw new AppError('VALIDATION', 'Invalid file', { fields: { file: TOO_LARGE } });
  }

  const outcome = await importProducts(db, actor, new Uint8Array(await file.arrayBuffer()), { dryRun }, ctx);
  if (outcome.kind === 'preview') return json(outcome.report);
  if (outcome.kind === 'committed') return json(outcome.result, 201);
  const n = outcome.report.errors.length;
  return json({ error: { code: 'VALIDATION', message: `Import has ${n} row error${n === 1 ? '' : 's'}; nothing was imported` }, ...outcome.report }, 400);
});
