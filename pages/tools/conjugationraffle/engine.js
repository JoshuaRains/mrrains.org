// Vocabulary transcribed exclusively from the two Regular Verbs handouts.
const notes = [
  ['hablar','speak'],['caminar','walk'],['trabajar','work'],['estudiar','study'],
  ['mirar','watch'],['usar','use'],['escuchar','listen','listen to'],['enseñar','teach'],
  ['sacar','take out'],['tocar','touch'],['comer','eat'],['beber','drink'],
  ['leer','read'],['aprender','learn'],['vender','sell'],['correr','run'],
  ['responder','respond'],['comprender','understand'],['prometer','promise'],['deber','owe'],
  ['vivir','live'],['escribir','write'],['abrir','open'],['recibir','receive'],
  ['compartir','share'],['decidir','decide'],['asistir','attend'],['sufrir','suffer'],['permitir','allow']
];
const practice = [
  ['ayudar','help'],['bailar','dance'],['buscar','look for'],['comprar','buy'],
  ['cocinar','cook'],['contestar','answer'],['dibujar','draw'],['entrar','enter'],
  ['esperar','wait'],['llamar','call'],['llevar','carry'],['necesitar','need'],
  ['preparar','prepare'],['preguntar','ask'],['terminar','finish'],['visitar','visit'],
  ['viajar','travel'],['cantar','sing'],['limpiar','clean'],['nadar','swim'],
  ['creer','believe'],['romper','break'],['describir','describe'],['discutir','discuss'],['subir','go up']
];
export const VERBS = [...notes.map(([es,en])=>({es,en,source:'notes'})), ...practice.map(([es,en])=>({es,en,source:'practice'}))];
export const SUBJECTS = [
  {en:'I',es:'yo',column:0}, {en:'You',hint:'one person · informal',es:'tú',column:1},
  {en:'He',es:'él',column:2}, {en:'She',es:'ella',column:2},
  {en:'You',hint:'one person · formal',es:'usted',column:2},
  {en:'We',es:'nosotros / nosotras',column:3},
  {en:'You all',hint:'Spain · informal',es:'vosotros / vosotras',column:4},
  {en:'They',es:'ellos / ellas',column:5},
  {en:'You all',hint:'ustedes',es:'ustedes',column:5}
];
export function conjugate(verb,column) {
  const endings={ar:['o','as','a','amos','áis','an'],er:['o','es','e','emos','éis','en'],ir:['o','es','e','imos','ís','en']};
  return verb.slice(0,-2)+endings[verb.slice(-2)][column];
}
export function english(verb,subject) {
  let word=verb.en;
  if(subject.en==='He'||subject.en==='She') {
    const [first,...rest]=word.split(' ');
    const third=/[^aeiou]y$/.test(first)?first.slice(0,-1)+'ies':/(s|sh|ch|x|z|o)$/.test(first)?first+'es':first+'s';
    word=[third,...rest].join(' ');
  }
  return subject.en+' '+word;
}
export function makeDeck(source='all',ending='all',vosotros=false) {
  const cards=VERBS.filter(v=>(source==='all'||v.source===source)&&(ending==='all'||v.es.endsWith(ending)))
    .flatMap(verb=>SUBJECTS.filter(s=>vosotros||s.column!==4).map(subject=>({verb,subject})));
  for(let i=cards.length-1;i>0;i--) {const j=Math.floor(Math.random()*(i+1)); [cards[i],cards[j]]=[cards[j],cards[i]];}
  return cards;
}
