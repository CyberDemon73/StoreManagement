import { z } from 'zod';
import { uuidSchema } from './common';

/** POST /products/import — `?dryRun=1` previews; anything else commits. */
export const importQuery = z
  .object({
    dryRun: z
      .enum(['0', '1', 'true', 'false'])
      .optional()
      .transform((v) => v === '1' || v === 'true'),
  })
  .strict();
export type ImportQuery = z.infer<typeof importQuery>;

/** GET /products/export takes no parameters. */
export const productExportQuery = z.object({}).strict();

export const MAX_LABEL_IDS = 200;

/** GET /labels?variantIds=a,b — comma-separated uuids, order kept (duplicates = extra copies). */
export const labelsQuery = z
  .object({
    variantIds: z
      .string()
      .min(1)
      .max(MAX_LABEL_IDS * 37)
      .transform((s) => s.split(',').map((id) => id.trim()))
      .pipe(z.array(uuidSchema).min(1).max(MAX_LABEL_IDS, `At most ${MAX_LABEL_IDS} variants`)),
  })
  .strict();
export type LabelsQuery = z.infer<typeof labelsQuery>;
