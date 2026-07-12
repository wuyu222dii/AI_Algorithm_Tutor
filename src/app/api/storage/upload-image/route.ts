import { md5 } from '@/shared/lib/hash';
import {
  legacyFeatureDisabledResponse,
  legacyFeaturesEnabled,
} from '@/shared/lib/legacy-features';
import { respData, respErr } from '@/shared/lib/resp';
import { getUserInfo } from '@/shared/models/user';
import { getStorageService } from '@/shared/services/storage';

const MAX_FILES = 4;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
]);

const extFromMime = (mimeType: string) => {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
  };
  return map[mimeType] || '';
};

export async function POST(req: Request) {
  if (!legacyFeaturesEnabled()) {
    return legacyFeatureDisabledResponse();
  }

  try {
    const user = await getUserInfo();
    if (!user) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const files = formData.getAll('files') as File[];

    if (!files || files.length === 0) {
      return respErr('No files provided');
    }
    if (files.length > MAX_FILES) {
      return Response.json({ error: 'too_many_files' }, { status: 413 });
    }

    const storageService = await getStorageService();
    const uploadResults = [];

    for (const file of files) {
      // Validate file type
      if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        return Response.json(
          { error: 'unsupported_file_type', filename: file.name },
          { status: 415 }
        );
      }
      if (file.size > MAX_FILE_BYTES) {
        return Response.json(
          { error: 'file_too_large', filename: file.name },
          { status: 413 }
        );
      }

      // Convert file to buffer
      const arrayBuffer = await file.arrayBuffer();
      const body = new Uint8Array(arrayBuffer);

      const digest = md5(body);
      const ext = extFromMime(file.type) || file.name.split('.').pop() || 'bin';
      const key = `${digest}.${ext}`;

      // If the same image already exists, reuse its URL to save storage space.
      // (Still depends on provider supporting signed HEAD + public url generation.)
      const exists = await storageService.exists({ key });
      if (exists) {
        const publicUrl = storageService.getPublicUrl({ key });
        if (publicUrl) {
          uploadResults.push({
            url: publicUrl,
            key,
            filename: file.name,
            deduped: true,
          });
          continue;
        }
      }

      // Upload to storage
      const result = await storageService.uploadFile({
        body,
        key: key,
        contentType: file.type,
        disposition: 'inline',
      });

      if (!result.success) {
        console.error('[API] Upload failed:', result.error);
        return respErr(result.error || 'Upload failed');
      }

      uploadResults.push({
        url: result.url,
        key: result.key,
        filename: file.name,
        deduped: false,
      });
    }

    return respData({
      urls: uploadResults.map((r) => r.url),
      results: uploadResults,
    });
  } catch (e) {
    console.error('upload image failed:', e);
    return respErr('upload image failed');
  }
}
