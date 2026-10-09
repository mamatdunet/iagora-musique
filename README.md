# Tube de l'automne 🍁

Landing page de l'atelier IAgora « Tube de l'automne » : créer une chanson avec Suno, en niveaux de difficulté croissants, puis la déposer dans le **Top 50** (`/top50`) où tout le monde peut l'écouter et voter.

- `index.html` : les niveaux (1 · Clé en main, 2 · Parolier IA avec bouton de copie du guide des méta-tags Suno `src/tags-suno.txt`, 3 · Sur mesure) + étapes pochette (Midjourney) et clip à paroles.
- `top50.html` : dépôt par glisser-déposer d'une chanson (audio ou vidéo) + pochette, podium du top 3, classement et vote. L'ancienne adresse `/scene` redirige ici.
- `api/` : fonctions Vercel (dépôt via Vercel Blob, données et votes dans Upstash Redis).

## Déploiement sur Vercel

1. Importer le dépôt dans Vercel (preset **Vite**, rien à changer).
2. Onglet **Storage** du projet :
   - créer un store **Blob** → ajoute `BLOB_READ_WRITE_TOKEN` ;
   - ajouter **Upstash for Redis** (Marketplace) → ajoute `KV_REST_API_URL` / `KV_REST_API_TOKEN`.
3. Variables d'environnement facultatives (voir `.env.example`) :
   - `ADMIN_PASSWORD` : permet de supprimer une création depuis `/top50?admin` ;
   - `VOTE_COOLDOWN_SECONDS` (30 par défaut), `VOTES_PER_IP_PER_MINUTE` (20 par défaut) ;
   - `VOTE_SECRET` : clé de signature des identifiants de poste.
4. Redéployer.

En local : `npm install` puis `vercel dev` (les variables se récupèrent avec `vercel env pull`).

## Anti-triche des votes

Pensé pour un ordinateur partagé où les gens votent à tour de rôle :

- **Un vote par poste toutes les 30 s.** Chaque navigateur reçoit un identifiant signé (cookie `HttpOnly`). Après un vote, le serveur refuse tout autre vote de ce poste pendant la pause, et la page grise les boutons avec un compte à rebours « Passe la main 👋 ».
- **Plafond par réseau** : au-delà de 20 votes par minute depuis la même adresse IP, les votes sont refusés pendant une minute (bloque les scripts qui effacent leurs cookies).
- Les boutons sont verrouillés dès le clic, donc marteler le bouton ne compte qu'un vote.

## Dépôts

Les fichiers partent directement du navigateur vers Vercel Blob (jusqu'à 200 Mo pour la chanson, 10 Mo pour la pochette), sans passer par la limite de 4,5 Mo des fonctions. Au plus 20 dépôts par heure et par adresse IP.
