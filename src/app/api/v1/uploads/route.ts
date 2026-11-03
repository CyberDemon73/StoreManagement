import { UNAUTHENTICATED_MESSAGE, withAuth } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { json } from '@/lib/http';
import { storeImage } from '@/services/uploads';

export const runtime = 'nodejs';

export const POST = withAuth({ permission: 'products.write' }, async (req, { db, user, req: ctx }) => {
  if (!user) throw new AppError('UNAUTHENTICATED', UNAUTHENTICATED_MESSAGE);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError('VALIDATION', 'Expected multipart form-data');
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    throw new AppError('VALIDATION', 'Invalid input', { fields: { file: 'An image file is required' } });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const { url } = await storeImage(db, user, { bytes, size: file.size, declaredType: file.type }, ctx);
  return json({ url }, 201);
});
