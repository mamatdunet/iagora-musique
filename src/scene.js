import { upload } from '@vercel/blob/client';

const $ = (sel) => document.querySelector(sel);
const list = $('#entries');
const empty = $('#empty');
const voteStatus = $('#vote-status');
const cooldownBox = $('#cooldown');
const cooldownLeft = $('#cooldown-left');

const LEVELS = { 1: 'Niveau 1', 2: 'Niveau 2', 3: 'Niveau 3', studio: 'Studio' };
const isAdmin = new URLSearchParams(location.search).has('admin');

let cooldownUntil = 0;
let tick = null;

function setStatus(el, message, kind = '') {
  el.textContent = message;
  el.className = `status ${kind}`;
}

/* ---------- Pause entre deux votes ---------- */

function startCooldown(seconds) {
  if (!seconds) return;
  cooldownUntil = Math.max(cooldownUntil, Date.now() + seconds * 1000);
  clearInterval(tick);
  updateCooldown();
  tick = setInterval(updateCooldown, 250);
}

function updateCooldown() {
  const left = Math.ceil((cooldownUntil - Date.now()) / 1000);
  const active = left > 0;
  cooldownBox.hidden = !active;
  cooldownLeft.textContent = String(Math.max(left, 0));
  for (const btn of list.querySelectorAll('.vote .cta')) btn.disabled = active;
  if (!active) {
    clearInterval(tick);
    setStatus(voteStatus, '');
  }
}

/* ---------- Classement ---------- */

const nodes = new Map();

function buildEntry(entry) {
  const li = document.createElement('li');
  li.className = 'entry';
  li.dataset.id = entry.id;

  const rank = document.createElement('div');
  rank.className = 'rank';

  let cover;
  if (entry.coverUrl) {
    cover = document.createElement('img');
    cover.src = entry.coverUrl;
    cover.alt = `Pochette de ${entry.title}`;
    cover.loading = 'lazy';
  } else {
    cover = document.createElement('div');
    cover.textContent = '🍁';
    cover.setAttribute('aria-hidden', 'true');
  }
  cover.className = 'cover';

  const info = document.createElement('div');
  info.className = 'info';
  const h3 = document.createElement('h3');
  h3.textContent = entry.title;
  const by = document.createElement('p');
  by.className = 'by';
  by.textContent = entry.artist;
  if (LEVELS[entry.level]) {
    const lvl = document.createElement('span');
    lvl.textContent = LEVELS[entry.level];
    by.append(lvl);
  }
  const media = document.createElement(entry.mediaType === 'video' ? 'video' : 'audio');
  media.src = entry.mediaUrl;
  media.controls = true;
  media.preload = 'metadata';
  if (entry.mediaType === 'video' && entry.coverUrl) media.poster = entry.coverUrl;
  info.append(h3, by, media);

  const vote = document.createElement('div');
  vote.className = 'vote';
  const count = document.createElement('div');
  count.className = 'count';
  const btn = document.createElement('button');
  btn.className = 'cta';
  btn.type = 'button';
  btn.textContent = '🍁 Je vote';
  btn.addEventListener('click', () => castVote(entry.id));
  vote.append(count, btn);

  if (isAdmin) {
    const del = document.createElement('button');
    del.className = 'admin-del';
    del.type = 'button';
    del.textContent = 'Supprimer';
    del.addEventListener('click', () => removeEntry(entry));
    vote.append(del);
  }

  li.append(rank, cover, info, vote);
  return li;
}

function render(entries) {
  const seen = new Set();
  entries.forEach((entry, i) => {
    let li = nodes.get(entry.id);
    if (!li) {
      li = buildEntry(entry);
      nodes.set(entry.id, li);
    }
    seen.add(entry.id);
    li.querySelector('.rank').textContent = String(i + 1);
    li.querySelector('.count').innerHTML = `${entry.votes}<small>vote${entry.votes > 1 ? 's' : ''}</small>`;
    li.classList.toggle('top', i === 0 && entry.votes > 0);
    // Ne déplace le nœud que si nécessaire, pour ne pas couper une écoute en cours.
    if (list.children[i] !== li) list.insertBefore(li, list.children[i] || null);
  });
  for (const [id, li] of nodes) {
    if (!seen.has(id)) {
      li.remove();
      nodes.delete(id);
    }
  }
  empty.hidden = entries.length > 0;
  updateCooldown();
}

async function refresh() {
  try {
    const res = await fetch('/api/entries', { cache: 'no-store' });
    if (!res.ok) throw new Error();
    const data = await res.json();
    render(data.entries);
    startCooldown(data.cooldown);
  } catch {
    setStatus(voteStatus, 'Impossible de charger le classement. Nouvel essai dans quelques secondes…', 'error');
  }
}

async function castVote(id) {
  if (Date.now() < cooldownUntil) return;
  // Verrouille tout de suite les boutons pour éviter les doubles clics.
  startCooldown(2);
  try {
    const res = await fetch('/api/vote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (data.cooldown) startCooldown(data.cooldown);
    if (!res.ok) {
      setStatus(voteStatus, data.error || 'Vote refusé.', 'error');
      if (res.status === 403) refresh();
      return;
    }
    setStatus(voteStatus, '');
    refresh();
  } catch {
    setStatus(voteStatus, 'Le vote n’est pas passé, réessaie.', 'error');
  }
}

async function removeEntry(entry) {
  if (!confirm(`Supprimer « ${entry.title} » ?`)) return;
  let password = sessionStorage.getItem('tube-admin');
  if (!password) {
    password = prompt('Mot de passe admin');
    if (!password) return;
  }
  const res = await fetch(`/api/entries?id=${encodeURIComponent(entry.id)}`, {
    method: 'DELETE',
    headers: { 'x-admin-password': password },
  });
  if (res.ok) {
    sessionStorage.setItem('tube-admin', password);
    refresh();
  } else {
    sessionStorage.removeItem('tube-admin');
    alert((await res.json()).error || 'Suppression impossible.');
  }
}

// Une seule chanson à la fois.
document.addEventListener('play', (event) => {
  for (const m of list.querySelectorAll('audio, video')) if (m !== event.target) m.pause();
}, true);

/* ---------- Dépôt ---------- */

const form = $('#upload-form');
const progress = $('#upload-progress');
const uploadStatus = $('#upload-status');

function safeName(file) {
  const ext = (file.name.match(/\.[a-z0-9]{1,5}$/i) || [''])[0].toLowerCase();
  const base = file.name.replace(/\.[^.]*$/, '').normalize('NFD').replace(/[^\w-]+/g, '-').slice(0, 40) || 'fichier';
  return base + ext;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button');
  const data = new FormData(form);
  const media = data.get('media');
  const cover = data.get('cover');
  if (!media || !media.size) return;

  button.disabled = true;
  progress.hidden = false;
  progress.value = 0;
  try {
    setStatus(uploadStatus, 'Envoi de la chanson…');
    const mediaBlob = await upload(`tubes/${safeName(media)}`, media, {
      access: 'public',
      handleUploadUrl: '/api/upload',
      multipart: media.size > 20 * 1024 * 1024,
      onUploadProgress: ({ percentage }) => { progress.value = percentage; },
    });

    let coverUrl = null;
    if (cover && cover.size) {
      setStatus(uploadStatus, 'Envoi de la pochette…');
      const coverBlob = await upload(`pochettes/${safeName(cover)}`, cover, {
        access: 'public',
        handleUploadUrl: '/api/upload',
      });
      coverUrl = coverBlob.url;
    }

    const res = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: data.get('title'),
        artist: data.get('artist'),
        level: data.get('level'),
        mediaUrl: mediaBlob.url,
        mediaType: media.type,
        coverUrl,
      }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);

    form.reset();
    setStatus(uploadStatus, 'Ton tube est sur scène ! 🎉', 'ok');
    await refresh();
    nodes.get(result.entry.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    setStatus(uploadStatus, `Oups : ${error.message || 'envoi impossible'}`, 'error');
  } finally {
    button.disabled = false;
    progress.hidden = true;
  }
});

refresh();
setInterval(refresh, 15000);
