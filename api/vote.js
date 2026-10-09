import {
  redis, KEYS, json, clientIp, readVoter, underLimit,
  VOTE_COOLDOWN, VOTES_PER_IP_PER_MINUTE,
} from './_lib/store.js';

// Un vote par poste toutes les VOTE_COOLDOWN secondes,
// et un plafond par adresse IP pour bloquer les scripts qui jettent leurs cookies.
export async function POST(request) {
  const voter = readVoter(request);
  if (!voter) return json({ error: 'Recharge la page avant de voter.' }, 403);

  const { id } = await request.json().catch(() => ({}));
  if (!id || !(await redis.hexists(KEYS.entries, id))) return json({ error: 'Tube introuvable.' }, 404);

  const fresh = await redis.set(KEYS.cooldown(voter), 1, { nx: true, ex: VOTE_COOLDOWN });
  if (!fresh) {
    const wait = Math.max(1, await redis.ttl(KEYS.cooldown(voter)));
    return json({ error: 'Doucement ! Attends un peu avant de revoter.', cooldown: wait }, 429);
  }
  if (!(await underLimit(KEYS.ipVotes(clientIp(request)), VOTES_PER_IP_PER_MINUTE, 60))) {
    return json({ error: 'Trop de votes depuis ce réseau, patiente une minute.', cooldown: 60 }, 429);
  }

  const votes = await redis.zincrby(KEYS.votes, 1, id);
  return json({ id, votes: Number(votes), cooldown: VOTE_COOLDOWN });
}
