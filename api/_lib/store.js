import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { issueSignedToken, presignUrl } from '@vercel/blob';

export const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

export const KEYS = {
  entries: 'tube:entries', // hash id -> entrée (JSON)
  votes: 'tube:votes', // zset id -> nombre de votes
  cooldown: (voter) => `tube:cooldown:${voter}`,
  ipVotes: (ip) => `tube:ipvotes:${ip}`,
  ipUploads: (ip) => `tube:ipuploads:${ip}`,
};

export const VOTE_COOLDOWN = Number(process.env.VOTE_COOLDOWN_SECONDS) || 120;
export const VOTES_PER_IP_PER_MINUTE = Number(process.env.VOTES_PER_IP_PER_MINUTE) || 20;
export const UPLOADS_PER_IP_PER_HOUR = 200; // tout l'atelier partage souvent la même IP (Wi-Fi)

export const VOTER_COOKIE = 'tube_voter';

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function clientIp(request) {
  const fwd = request.headers.get('x-forwarded-for') || '';
  return fwd.split(',')[0].trim() || request.headers.get('x-real-ip') || 'inconnu';
}

export function readCookie(request, name) {
  const cookies = request.headers.get('cookie') || '';
  const match = cookies.split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

// Identifiant de poste signé : impossible d'en fabriquer à la volée sans passer par le serveur.
const SECRET = process.env.VOTE_SECRET || process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || 'tube';
const sign = (id) => createHmac('sha256', SECRET).update(id).digest('base64url').slice(0, 22);

export function newVoter() {
  const id = randomUUID();
  return { id, cookie: `${VOTER_COOKIE}=${id}.${sign(id)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax` };
}

export function readVoter(request) {
  const [id, sig] = (readCookie(request, VOTER_COOKIE) || '').split('.');
  if (!id || !sig) return null;
  const expected = Buffer.from(sign(id));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}

// Fenêtre fixe : renvoie false si la limite est dépassée.
export async function underLimit(key, max, windowSeconds) {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  return count <= max;
}

// Accès à Vercel Blob. Deux cas selon la façon dont le store a été relié au projet :
// - ancien mode : un jeton lecture-écriture (BLOB_READ_WRITE_TOKEN) ;
// - nouveau mode : un identifiant de store + l'OIDC de Vercel, sans jeton.
// Les variables peuvent porter un préfixe choisi à la connexion du store.
function blobEnv(suffix, validate = () => true) {
  const exact = process.env[`BLOB_${suffix}`];
  if (exact && validate(exact)) return exact;
  const found = Object.entries(process.env).find(([key, value]) => key.endsWith(suffix) && /BLOB/i.test(key) && validate(String(value)));
  return found ? found[1] : undefined;
}

export function blobToken() {
  return blobEnv('READ_WRITE_TOKEN', (v) => v.startsWith('vercel_blob_rw_'));
}

export const blobStoreId = () => blobEnv('STORE_ID');
export const blobWebhookKey = () => blobEnv('WEBHOOK_PUBLIC_KEY');

// Options d'authentification à passer aux appels serveur du SDK.
export function blobAuth(request) {
  const token = blobToken();
  if (token) return { token };
  const storeId = blobStoreId();
  const oidcToken = request?.headers.get('x-vercel-oidc-token') || process.env.VERCEL_OIDC_TOKEN || undefined;
  return storeId ? { storeId, ...(oidcToken ? { oidcToken } : {}) } : {};
}

// Store privé : les fichiers ne sont lisibles qu'avec un lien signé.
// Un jeton de lecture sert pour tous les fichiers ; il est gardé en mémoire 6 h (validité 12 h).
let readToken = null;
async function getReadToken(request) {
  if (readToken && readToken.validUntil - Date.now() > 6 * 3600 * 1000) return readToken;
  readToken = await issueSignedToken({
    ...blobAuth(request), pathname: '*', operations: ['get'], validUntil: Date.now() + 12 * 3600 * 1000,
  });
  return readToken;
}

export async function playableUrl(url, request) {
  try {
    if (!url || !new URL(url).hostname.includes('.private.')) return url;
    const pathname = decodeURIComponent(new URL(url).pathname.slice(1));
    const { presignedUrl } = await presignUrl(await getReadToken(request), { operation: 'get', pathname, access: 'private' });
    return presignedUrl;
  } catch (error) {
    console.error('Lien signé impossible', error);
    return url;
  }
}

// Chansons Suno : on accepte suno.com/song/<id>, suno.com/embed/<id> ou le lien court suno.com/s/<code>.
const SUNO_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export async function resolveSuno(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    return null;
  }
  if (!/(^|\.)suno\.(com|ai)$/i.test(url.hostname)) return null;
  const direct = url.pathname.match(SUNO_ID);
  if (direct) return direct[0].toLowerCase();
  if (/^\/s\/[\w-]+$/.test(url.pathname)) {
    // Lien court : Suno redirige vers /song/<id>
    const res = await fetch(`https://suno.com${url.pathname}`, { redirect: 'manual' }).catch(() => null);
    const location = res?.headers.get('location') || '';
    const found = location.match(SUNO_ID);
    return found ? found[0].toLowerCase() : null;
  }
  return null;
}

// Titre et pochette publics d'une chanson Suno (lus dans sa page d'intégration).
export async function sunoInfo(id) {
  const res = await fetch(`https://suno.com/embed/${id}`).catch(() => null);
  if (!res?.ok) return null;
  const page = await res.text();
  const meta = (name) => page.match(new RegExp(`property="og:${name}"[^>]*content="([^"]*)"`))?.[1];
  const decode = (text) => text?.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return { id, title: decode(meta('title')) || '', image: meta('image') || null };
}

export function isOurBlob(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.endsWith('.blob.vercel-storage.com');
  } catch {
    return false;
  }
}
