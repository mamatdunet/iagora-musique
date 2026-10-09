import tags from './tags-suno.txt?raw';

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
