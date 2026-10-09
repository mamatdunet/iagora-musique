import { del } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import {
  redis, KEYS, json, blobAuth, playableUrl, clientIp, readVoter, newVoter, underLimit, isOurBlob,
  VOTE_COOLDOWN, UPLOADS_PER_IP_PER_HOUR,
} from './_lib/store.js';

const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// Liste des tubes, classés par votes. Donne aussi un identifiant de votant au poste.
export async function GET(request) {
  const [entries, scores] = await Promise.all([
    redis.hgetall(KEYS.entries),
    redis.zrange(KEYS.votes, 0, -1, { withScores: true }),
  ]);
  const votes = {};
  for (let i = 0; i < scores.length; i += 2) votes[scores[i]] = Number(scores[i + 1]);

  const list = await Promise.all(Object.values(entries || {})
    .map((e) => (typeof e === 'string' ? JSON.parse(e) : e))
    .map(async (e) => ({
      ...e,
      mediaUrl: await playableUrl(e.mediaUrl, request),
      coverUrl: await playableUrl(e.coverUrl, request),
      votes: votes[e.id] || 0,
    })));
  list.sort((a, b) => b.votes - a.votes || a.createdAt - b.createdAt);

  const voter = readVoter(request);
  let cooldown = 0;
  const headers = {};
  if (!voter) {
    headers['set-cookie'] = newVoter().cookie;
  } else {
    cooldown = Math.max(0, await redis.ttl(KEYS.cooldown(voter)));
  }
  return json({ entries: list, cooldown, cooldownSeconds: VOTE_COOLDOWN }, 200, headers);
}

// Ajout d'un tube (les fichiers sont déjà sur Vercel Blob).
export async function POST(request) {
  if (!(await underLimit(KEYS.ipUploads(clientIp(request)), UPLOADS_PER_IP_PER_HOUR, 3600))) {
    return json({ error: 'Trop de dépôts depuis ce réseau, réessaie plus tard.' }, 429);
  }
  const body = await request.json().catch(() => ({}));
  const entry = {
    id: randomUUID().slice(0, 8),
    title: clean(body.title, 80),
    artist: clean(body.artist, 80),
    mediaUrl: String(body.mediaUrl || ''),
    mediaType: String(body.mediaType || '').startsWith('video/') ? 'video' : 'audio',
    coverUrl: body.coverUrl ? String(body.coverUrl) : null,
    lyrics: String(body.lyrics ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 6000),
    createdAt: Date.now(),
  };
  if (!entry.title || !entry.artist) return json({ error: 'Titre et nom d’artiste obligatoires.' }, 400);
  if (!isOurBlob(entry.mediaUrl) || (entry.coverUrl && !isOurBlob(entry.coverUrl))) {
    return json({ error: 'Fichier invalide.' }, 400);
  }
  await redis.hset(KEYS.entries, { [entry.id]: JSON.stringify(entry) });
  return json({ entry: { ...entry, votes: 0 } }, 201);
}

// Suppression (modération) : en-tête x-admin-password requis.
export async function DELETE(request) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || request.headers.get('x-admin-password') !== password) {
    return json({ error: 'Mot de passe incorrect.' }, 401);
  }
  const id = new URL(request.url).searchParams.get('id');
  const raw = id && (await redis.hget(KEYS.entries, id));
  if (!raw) return json({ error: 'Introuvable.' }, 404);
  const entry = typeof raw === 'string' ? JSON.parse(raw) : raw;
  await Promise.all([
    redis.hdel(KEYS.entries, id),
    redis.zrem(KEYS.votes, id),
    del([entry.mediaUrl, entry.coverUrl].filter(Boolean), blobAuth(request)).catch(() => {}),
  ]);
  return json({ ok: true });
}
