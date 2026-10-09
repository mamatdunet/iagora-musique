import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Redis } from '@upstash/redis';

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

export const VOTE_COOLDOWN = Number(process.env.VOTE_COOLDOWN_SECONDS) || 30;
export const VOTES_PER_IP_PER_MINUTE = Number(process.env.VOTES_PER_IP_PER_MINUTE) || 20;
export const UPLOADS_PER_IP_PER_HOUR = 20;

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

// Jeton Vercel Blob : la variable standard, ou celle créée avec un préfixe
// quand le store est connecté au projet sous un autre nom.
export function blobToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  const found = Object.entries(process.env).find(
    ([key, value]) => key.endsWith('READ_WRITE_TOKEN') && String(value).startsWith('vercel_blob_rw_'),
  );
  return found ? found[1] : undefined;
}

export function isOurBlob(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.endsWith('.public.blob.vercel-storage.com');
  } catch {
    return false;
  }
}
