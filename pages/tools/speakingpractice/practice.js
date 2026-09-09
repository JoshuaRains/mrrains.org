const small = ['','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez','once','doce','trece','catorce','quince','dieciséis','diecisiete','dieciocho','diecinueve','veinte','veintiuno','veintidós','veintitrés','veinticuatro','veinticinco','veintiséis','veintisiete','veintiocho','veintinueve'];
function numberName(n) {
  if (n < 30) return small[n];
  if (n === 100) return 'cien';
  return ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'][Math.floor(n / 10)] + (n % 10 ? ' y ' + small[n % 10] : '');
}
const sets = {
  numbers: Array.from({length: 100}, (_, i) => [String(i + 1), numberName(i + 1), String(i + 1)]),
  pronouns: [['I','yo'],['you (informal)','tú'],['you (formal)','usted'],['he','él'],['she','ella'],['we (masculine or mixed group)','nosotros'],['we (feminine)','nosotras'],["y’all (informal, Spain)",'vosotros'],["y’all (formal in Spain; any group in Latin America)",'ustedes'],['they (masculine or mixed group)','ellos'],['they (feminine)','ellas']],
  verbs: [['to speak','hablar'],['to walk','caminar'],['to work','trabajar'],['to study','estudiar'],['to look at / to watch','mirar'],['to use','usar'],['to listen','escuchar'],['to teach','enseñar'],['to take out / to take (a photo)','sacar'],['to touch / to play (an instrument)','tocar'],['to eat','comer'],['to drink','beber'],['to read','leer'],['to learn','aprender'],['to sell','vender'],['to run','correr'],['to respond','responder'],['to understand','comprender'],['to promise','prometer'],['should / ought to','deber'],['to live','vivir'],['to write','escribir'],['to open','abrir'],['to receive','recibir'],['to share','compartir'],['to decide','decidir'],['to attend','asistir'],['to suffer','sufrir'],['to allow','permitir']]
};
const kind = document.body.dataset.practice;
const items = sets[kind];
const prompt = document.getElementById('prompt');
const answer = document.getElementById('answer');
const reveal = document.getElementById('reveal');
const audio = document.getElementById('audio');
const status = document.getElementById('audio-status');
const button = document.getElementById('next');
let current = -1;
let revealed = true;
audio.addEventListener('error', () => { status.hidden = false; });
audio.addEventListener('canplay', () => { status.hidden = true; });
button.addEventListener('click', () => {
  if (!revealed) {
    answer.textContent = items[current][1];
    reveal.hidden = false;
    const slug = items[current][2] || items[current][1].normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    audio.src = `audio/${kind}/${slug}.mp3`;
    audio.load();
    button.textContent = kind === 'numbers' ? 'Next Number' : 'Next';
    revealed = true;
    return;
  }
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  reveal.hidden = true;
  status.hidden = true;
  let next = Math.floor(Math.random() * (items.length - (current < 0 ? 0 : 1)));
  if (current >= 0 && next >= current) next++;
  current = next;
  prompt.textContent = items[current][0];
  answer.textContent = '';
  button.textContent = 'Reveal Answer';
  revealed = false;
});
