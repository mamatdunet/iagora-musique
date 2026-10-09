import { issueSignedToken } from '@vercel/blob';
import { handleUpload, handleUploadPresigned } from '@vercel/blob/client';
import { json, blobToken, blobStoreId, blobWebhookKey, blobAuth, playableUrl } from './_lib/store.js';

const MEDIA_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'video/mp4', 'video/quicktime', 'video/webm'];
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function rules(pathname) {
  const isCover = pathname.startsWith('pochettes/');
  if (!isCover && !pathname.startsWith('tubes/')) throw new Error('Chemin refusé');
  return {
    allowedContentTypes: isCover ? IMAGE_TYPES : MEDIA_TYPES,
    maximumSizeInBytes: (isCover ? 10 : 200) * 1024 * 1024,
  };
}

// Mode d'envoi disponible : « token » (jeton lecture-écriture), « presigned » (store + OIDC) ou null.
const uploadMode = () => (blobToken() ? 'token' : blobStoreId() ? 'presigned' : null);

// Diagnostic : le stockage des fichiers est-il branché ? (jamais de valeur de variable)
export async function GET(request) {
  const mode = uploadMode();
  // DIAGNOSTIC TEMPORAIRE : lecture signée du fichier de test.
  if (new URL(request.url).searchParams.has('diag')) {
    const url = await playableUrl('https://f91qfnoemoyoveph.private.blob.vercel-storage.com/tubes/zz-test-diagnostic.mp3', request);
    const res = await fetch(url, { headers: { range: 'bytes=0-15' } }).catch((e) => ({ status: e.message }));
    return json({ mode, signed: url.includes('?'), status: res.status });
  }
  return json({ blob: Boolean(mode), mode });
}

// Autorise le navigateur à envoyer un fichier directement vers Vercel Blob
// (contourne la limite de 4,5 Mo des fonctions).
export async function POST(request) {
  const body = await request.json();
  try {
    if (body.type === 'blob.generate-client-token') {
      const result = await handleUpload({
        body,
        request,
        token: blobToken(),
        onBeforeGenerateToken: async (pathname) => ({ ...rules(pathname), addRandomSuffix: true }),
      });
      return json(result);
    }
    const auth = blobAuth(request);
    const result = await handleUploadPresigned({
      body,
      request,
      webhookPublicKey: blobWebhookKey() || 'non-utilisee',
      getSignedToken: async (pathname) => {
        const constraints = rules(pathname);
        const token = await issueSignedToken({ ...auth, pathname, operations: ['put'], ...constraints });
        // Le navigateur ajoute lui-même un suffixe aléatoire au nom du fichier.
        return { token, urlOptions: { ...constraints, addRandomSuffix: false } };
      },
    });
    return json(result);
  } catch (error) {
    return json({ error: error.message }, 400);
  }
}
