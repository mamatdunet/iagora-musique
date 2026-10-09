import tags from './tags-suno.md?raw';

// Copie le guide des méta-tags Suno, à coller à la fin du prompt dans l'IA.
const button = document.querySelector('#copy-tags');
const label = button.textContent;

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

button.addEventListener('click', async () => {
  await copy(tags);
  button.textContent = '✔ Copié ! Colle-le dans ton IA';
  button.classList.add('copied');
  setTimeout(() => {
    button.textContent = label;
    button.classList.remove('copied');
  }, 3000);
});

// Boîte à inspi : idées de chansons, avec un tirage au sort sujet + style.
const dialog = document.querySelector('#inspi');
const ideas = [...dialog.querySelectorAll('.inspi-list li')];
const result = document.querySelector('#inspi-result');
const STYLES = [
  'en disco', 'en rap old school', 'en heavy metal', 'en bossa nova', 'façon comédie musicale', 'en reggae',
  'en chanson française à texte', 'en country', 'en électro', 'en rock des années 60', 'en fanfare', 'en opéra',
];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

document.querySelector('#open-inspi').addEventListener('click', () => dialog.showModal());
dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
// Un clic en dehors de la fenêtre la ferme.
dialog.addEventListener('click', (event) => {
  if (event.target !== dialog) return;
  const r = dialog.getBoundingClientRect();
  const inside = event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
  if (!inside) dialog.close();
});
document.querySelector('#inspi-roll').addEventListener('click', () => {
  const idea = pick(ideas);
  for (const li of ideas) li.classList.toggle('picked', li === idea);
  result.textContent = `${idea.querySelector('b').textContent} ${idea.querySelector('strong').textContent}… ${pick(STYLES)} !`;
  idea.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});
