import { handleUpload } from '@vercel/blob/client';
import { json, blobToken } from './_lib/store.js';

const MEDIA_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'video/mp4', 'video/quicktime', 'video/webm'];
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Diagnostic : le stockage des fichiers est-il branché ?
export function GET() {
  return json({ blob: Boolean(blobToken()) });
}

// Délivre au navigateur un jeton d'envoi direct vers Vercel Blob
// (contourne la limite de 4,5 Mo des fonctions).
export async function POST(request) {
  const body = await request.json();
  try {
    const result = await handleUpload({
      body,
      request,
      token: blobToken(),
      onBeforeGenerateToken: async (pathname) => {
        const isCover = pathname.startsWith('pochettes/');
        if (!isCover && !pathname.startsWith('tubes/')) throw new Error('Chemin refusé');
        return {
          allowedContentTypes: isCover ? IMAGE_TYPES : MEDIA_TYPES,
          maximumSizeInBytes: (isCover ? 10 : 200) * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
    });
    return json(result);
  } catch (error) {
    return json({ error: error.message }, 400);
  }
}
