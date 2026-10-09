import { json, resolveSuno, sunoInfo } from './_lib/store.js';

// Vérifie un lien Suno collé dans le formulaire : identifiant, titre et pochette.
export async function GET(request) {
  const url = new URL(request.url).searchParams.get('url') || '';
  const id = await resolveSuno(url);
  if (!id) return json({ error: 'Ce lien ne ressemble pas à un lien de chanson Suno.' }, 400);
  const info = await sunoInfo(id);
  if (!info) return json({ error: 'Chanson introuvable : vérifie qu’elle est bien publique sur Suno.' }, 404);
  return json(info);
}
