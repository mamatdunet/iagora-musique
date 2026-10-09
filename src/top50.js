import { upload, uploadPresigned } from '@vercel/blob/client';

const $ = (sel) => document.querySelector(sel);
const list = $('#entries');
const podium = $('#podium');
const empty = $('#empty');
const voteStatus = $('#vote-status');
const cooldownBox = $('#cooldown');
const cooldownLeft = $('#cooldown-left');

const MEDALS = ['🥇', '🥈', '🥉'];
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
  const rest = Math.max(left, 0);
  cooldownLeft.textContent = `${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, '0')}`;
  for (const btn of document.querySelectorAll('.entry .vote .cta')) btn.disabled = active;
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
  const medal = document.createElement('div');
  medal.className = 'medal';
  medal.setAttribute('aria-hidden', 'true');

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
  let media;
  if (entry.mediaType === 'video') {
    media = document.createElement('video');
    media.src = entry.mediaUrl;
    media.controls = true;
    media.preload = 'metadata';
    if (entry.coverUrl) media.poster = entry.coverUrl;
  } else {
    media = buildPlayer(entry.mediaUrl, entry.id, entry.title);
  }
  info.append(h3, by, media);
  if (entry.lyrics) info.append(buildLyrics(entry.lyrics));

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

  // .body forme la carte sur le podium ; dans la liste, elle s'efface (display: contents).
  const body = document.createElement('div');
  body.className = 'body';
  body.append(cover, info, vote);
  li.append(medal, body, rank);
  return li;
}

/* ---------- Lecteur audio façon SoundCloud : grosse barre facile à parcourir ---------- */

const BARS = 64;
const fmt = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');

// Forme d'onde décorative, toujours la même pour une chanson donnée.
function waveHeights(seed) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return Array.from({ length: BARS }, (_, i) => {
    h = (h * 1103515245 + 12345) >>> 0;
    const envelope = 0.55 + 0.45 * Math.sin((i / BARS) * Math.PI);
    return Math.round((25 + (h % 75)) * envelope);
  });
}

function buildPlayer(src, seed, title) {
  const player = document.createElement('div');
  player.className = 'player';
  const audio = document.createElement('audio');
  audio.src = src;
  audio.preload = 'metadata';

  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'play';
  play.setAttribute('aria-label', `Écouter ${title}`);
  play.textContent = '▶';

  const track = document.createElement('div');
  track.className = 'track';
  const wave = document.createElement('div');
  wave.className = 'wave';
  const bars = waveHeights(seed).map((height) => {
    const bar = document.createElement('span');
    bar.style.height = `${height}%`;
    wave.append(bar);
    return bar;
  });
  const seek = document.createElement('input');
  seek.type = 'range';
  seek.className = 'seek';
  seek.min = 0;
  seek.max = 1000;
  seek.value = 0;
  seek.setAttribute('aria-label', `Position dans ${title}`);
  const times = document.createElement('div');
  times.className = 'times';
  times.innerHTML = '<span>0:00</span><span>0:00</span>';
  track.append(wave, seek, times);
  player.append(play, track, audio);

  let dragging = false;
  const duration = () => (Number.isFinite(audio.duration) ? audio.duration : 0);
  const paint = (ratio) => {
    const done = Math.round(ratio * BARS);
    bars.forEach((bar, i) => bar.classList.toggle('done', i < done));
  };
  const update = () => {
    const ratio = duration() ? audio.currentTime / duration() : 0;
    if (!dragging) seek.value = Math.round(ratio * 1000);
    paint(dragging ? seek.value / 1000 : ratio);
    times.children[0].textContent = fmt(audio.currentTime);
    times.children[1].textContent = fmt(duration());
  };

  play.addEventListener('click', () => (audio.paused ? audio.play() : audio.pause()));
  audio.addEventListener('play', () => { play.textContent = '❚❚'; player.classList.add('playing'); });
  audio.addEventListener('pause', () => { play.textContent = '▶'; player.classList.remove('playing'); });
  audio.addEventListener('timeupdate', update);
  audio.addEventListener('loadedmetadata', update);
  audio.addEventListener('durationchange', update);
  seek.addEventListener('input', () => {
    dragging = true;
    paint(seek.value / 1000);
    if (duration()) times.children[0].textContent = fmt((seek.value / 1000) * duration());
  });
  seek.addEventListener('change', () => {
    dragging = false;
    if (duration()) audio.currentTime = (seek.value / 1000) * duration();
    update();
  });
  return player;
}

/* ---------- Paroles, avec tags affichables ou masqués ---------- */

const TAG = /\[[^\]\n]*\]/g;

function buildLyrics(text) {
  const box = document.createElement('details');
  box.className = 'lyrics hide-tags';
  const summary = document.createElement('summary');
  summary.textContent = '📝 Les paroles';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'tags-toggle';
  toggle.textContent = 'Afficher les tags [ ]';
  toggle.addEventListener('click', () => {
    const hidden = box.classList.toggle('hide-tags');
    toggle.textContent = hidden ? 'Afficher les tags [ ]' : 'Masquer les tags [ ]';
  });
  const body = document.createElement('div');
  body.className = 'lyrics-text';
  let seenText = false;
  for (const line of text.split('\n')) {
    const row = document.createElement('div');
    row.className = 'lyric-line';
    let last = 0;
    for (const match of line.matchAll(TAG)) {
      row.append(line.slice(last, match.index));
      const tag = document.createElement('span');
      tag.className = 'lyric-tag';
      tag.textContent = match[0];
      row.append(tag);
      last = match.index + match[0].length;
    }
    row.append(line.slice(last));
    // Ligne qui ne contient que des tags : elle disparaît quand les tags sont masqués.
    const hasText = Boolean(line.replace(TAG, '').trim());
    if (!hasText) row.classList.add(line.trim() ? 'tag-only' : 'blank');
    // Lignes vides du début (avant les premières paroles) : masquées avec les tags.
    if (!hasText && !seenText) row.classList.add('lead');
    seenText ||= hasText;
    body.append(row);
  }
  box.append(summary, toggle, body);
  return box;
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
    li.querySelector('.medal').textContent = MEDALS[i] || '';
    li.querySelector('.count').innerHTML = `${entry.votes}<small>vote${entry.votes > 1 ? 's' : ''}</small>`;
    if (i < 3) li.dataset.place = String(i + 1);
    else delete li.dataset.place;
    // Ne déplace le nœud que si nécessaire, pour ne pas couper une écoute en cours.
    const parent = i < 3 ? podium : list;
    const index = i < 3 ? i : i - 3;
    if (parent.children[index] !== li) parent.insertBefore(li, parent.children[index] || null);
  });
  for (const [id, li] of nodes) {
    if (!seen.has(id)) {
      li.remove();
      nodes.delete(id);
    }
  }
  podium.dataset.count = String(Math.min(entries.length, 3));
  empty.hidden = entries.length > 0;
  list.hidden = entries.length === 0;
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
  for (const m of document.querySelectorAll('.entry audio, .entry video')) if (m !== event.target) m.pause();
}, true);

/* ---------- Dépôt ---------- */

const form = $('#upload-form');
const progress = $('#upload-progress');
const uploadStatus = $('#upload-status');

const mediaInput = form.elements.media;
const coverInput = form.elements.cover;
const mediaZone = $('#media-zone');
const coverZone = $('#cover-zone');
const mediaName = $('#media-name');
const coverPreview = $('#cover-preview');

const formatSize = (bytes) => `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;

function showFiles() {
  const media = mediaInput.files[0];
  mediaZone.classList.toggle('has-file', Boolean(media));
  mediaName.hidden = !media;
  if (media) {
    mediaName.textContent = `✔ ${media.name} · ${formatSize(media.size)}`;
    // Propose le nom du fichier comme titre si rien n'est saisi.
    if (!form.elements.title.value) form.elements.title.value = media.name.replace(/\.[^.]*$/, '').slice(0, 80);
  }
  const cover = coverInput.files[0];
  coverZone.classList.toggle('has-file', Boolean(cover));
  coverPreview.hidden = !cover;
  if (coverPreview.src) URL.revokeObjectURL(coverPreview.src);
  coverPreview.src = cover ? URL.createObjectURL(cover) : '';
}

const isImage = (file) => file.type.startsWith('image/');
const isMedia = (file) => /^(audio|video)\//.test(file.type);

// Refuse les fichiers du mauvais type (seules les images vont dans la pochette).
function accepts(input, file) {
  const ok = input === coverInput ? isImage(file) : isMedia(file);
  if (!ok) {
    setStatus(uploadStatus, input === coverInput
      ? `« ${file.name} » n’est pas une image : la pochette doit être un fichier JPG, PNG, WebP ou GIF.`
      : `« ${file.name} » n’est pas un fichier audio ou vidéo.`, 'error');
  }
  return ok;
}

function putFile(input, file) {
  if (!accepts(input, file)) return;
  setStatus(uploadStatus, '');
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  showFiles();
}

// Glisser-déposer : sur une zone, ou n'importe où dans la page
// (une image va dans la pochette, un son ou une vidéo dans la chanson).
for (const [zone, input] of [[mediaZone, mediaInput], [coverZone, coverInput]]) {
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove('over');
    const file = e.dataTransfer.files[0];
    if (file) putFile(input, file);
  });
}
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  for (const file of e.dataTransfer.files) {
    if (isImage(file)) putFile(coverInput, file);
    else if (isMedia(file)) putFile(mediaInput, file);
    else accepts(mediaInput, file);
  }
  $('#deposer').scrollIntoView({ behavior: 'smooth' });
});
for (const input of [mediaInput, coverInput]) {
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (file && !accepts(input, file)) input.value = '';
    else setStatus(uploadStatus, '');
    showFiles();
  });
}

// Aperçu des paroles sans les tags, pour vérifier ce que verront les autres.
const lyricsInput = form.elements.lyrics;
const lyricsPreview = $('#lyrics-preview');
$('#lyrics-toggle').addEventListener('click', (event) => {
  const show = lyricsPreview.hidden;
  lyricsPreview.hidden = !show;
  lyricsInput.hidden = show;
  event.currentTarget.textContent = show ? 'Revenir au texte complet' : 'Aperçu sans les tags';
  if (show) {
    lyricsPreview.textContent = lyricsInput.value
      .split('\n')
      .filter((line) => !line.trim() || line.replace(TAG, '').trim())
      .map((line) => line.replace(TAG, '').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() || 'Rien à afficher pour l’instant.';
  }
});

// Envoi direct vers Vercel Blob, selon le mode configuré côté serveur.
let uploadMode;
async function sendFile(folder, file, onProgress) {
  uploadMode ??= await fetch('/api/upload').then((r) => r.json()).then((d) => d.mode).catch(() => null);
  if (!uploadMode) throw new Error('le stockage des fichiers (Vercel Blob) n’est pas encore branché au site. Préviens l’équipe d’animation.');
  const suffix = Math.random().toString(36).slice(2, 10);
  const options = { access: 'public', handleUploadUrl: '/api/upload', onUploadProgress: onProgress };
  if (uploadMode === 'presigned') {
    return uploadPresigned(`${folder}/${suffix}-${safeName(file)}`, file, options);
  }
  return upload(`${folder}/${safeName(file)}`, file, { ...options, multipart: file.size > 20 * 1024 * 1024 });
}

function safeName(file) {
  const ext = (file.name.match(/\.[a-z0-9]{1,5}$/i) || [''])[0].toLowerCase();
  const base = file.name.replace(/\.[^.]*$/, '').normalize('NFD').replace(/[^\w-]+/g, '-').slice(0, 40) || 'fichier';
  return base + ext;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  const data = new FormData(form);
  const media = data.get('media');
  const cover = data.get('cover');
  if (!media || !media.size) {
    setStatus(uploadStatus, 'Ajoute d’abord ta chanson dans la grande zone 🎵', 'error');
    mediaZone.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (!data.get('title').trim() || !data.get('artist').trim()) {
    setStatus(uploadStatus, 'Indique le titre et le nom de l’artiste.', 'error');
    return;
  }

  button.disabled = true;
  progress.hidden = false;
  progress.value = 0;
  try {
    setStatus(uploadStatus, 'Envoi de la chanson…');
    const mediaBlob = await sendFile('tubes', media, ({ percentage }) => { progress.value = percentage; });

    let coverUrl = null;
    if (cover && cover.size) {
      setStatus(uploadStatus, 'Envoi de la pochette…');
      const coverBlob = await sendFile('pochettes', cover);
      coverUrl = coverBlob.url;
    }

    const res = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: data.get('title'),
        artist: data.get('artist'),
        mediaUrl: mediaBlob.url,
        mediaType: media.type,
        coverUrl,
        lyrics: data.get('lyrics'),
      }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);

    form.reset();
    lyricsInput.hidden = false;
    lyricsPreview.hidden = true;
    $('#lyrics-toggle').textContent = 'Aperçu sans les tags';
    showFiles();
    setStatus(uploadStatus, 'Ta chanson est dans le Top 50 ! 🎉 Maintenant, vote pour ta préférée.', 'ok');
    await refresh();
    nodes.get(result.entry.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    const message = error.message || 'envoi impossible';
    setStatus(uploadStatus, `Oups : ${message}`, 'error');
  } finally {
    button.disabled = false;
    progress.hidden = true;
  }
});

refresh();
setInterval(refresh, 15000);
