export const PRONOUNS = ['yo', 'tú', 'él / ella / usted', 'nosotros/as', 'vosotros/as', 'ellos / ellas / ustedes'];
export const VERBS = ['hablar','caminar','trabajar','estudiar','mirar','usar','escuchar','enseñar','sacar','tocar','comer','beber','leer','aprender','vender','correr','responder','comprender','prometer','deber','vivir','escribir','abrir','recibir','compartir','decidir','asistir','sufrir','permitir'];
export const SHIPS = [3, 2, 2, 1];
export const normalize = value => value.normalize('NFC').trim().toLocaleLowerCase('es');
export function conjugate(verb, column) {
  const endings = {ar:['o','as','a','amos','áis','an'],er:['o','es','e','emos','éis','en'],ir:['o','es','e','imos','ís','en']};
  return verb.slice(0,-2) + endings[verb.slice(-2)][column];
}
export function shuffled(values) {
  const result = [...values];
  for(let i=result.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [result[i],result[j]]=[result[j],result[i]]; }
  return result;
}
export function chooseVerbs() {
  return shuffled(['ar','er','ir'].flatMap(type => shuffled(VERBS.filter(v=>v.endsWith(type))).slice(0,2)));
}
export function findTarget(verbs, answer) {
  for(let r=0;r<verbs.length;r++) for(let c=0;c<6;c++) if(conjugate(verbs[r],c)===normalize(answer)) return r*6+c;
  return -1;
}
export function placement(fleet, start, length, vertical) {
  const cells=Array.from({length},(_,i)=>start+i*(vertical?6:1));
  return cells.every(cell=>cell<36 && cell>=0 && (vertical || Math.floor(cell/6)===Math.floor(start/6)) && !fleet.includes(cell)) ? cells : null;
}
export function randomFleet() {
  for(let attempt=0;attempt<100;attempt++) {
    const ships=[]; let occupied=[];
    for(const length of SHIPS) {
      const options=shuffled(Array.from({length:72},(_,i)=>i));
      const cells=options.map(i=>placement(occupied,i%36,length,i>=36)).find(Boolean);
      if(!cells) break;
      ships.push(cells); occupied=occupied.concat(cells);
    }
    if(ships.length===SHIPS.length) return ships;
  }
  throw new Error('Unable to place fleet. Try again.');
}
export function joinMatch(match, player, captain) {
  // Returning null lets Firebase compare with the server and retry with current
  // data. Returning undefined here would abort before contacting the server.
  if(match === null) return null;
  if(match.players?.[player]) return match;
  if(match.phase !== 'setup' || Object.keys(match.players || {}).length !== 1) return;
  const next = structuredClone(match);
  next.players[player] = captain;
  return next;
}
export function fire(match, player, answer) {
  if(!match || match.phase!=='battle' || match.turn!==player) return;
  const target=findTarget(match.verbs,answer);
  if(target<0 || match.players[player].shots?.[target]) return;
  const enemy=Object.keys(match.players).find(id=>id!==player);
  if(!enemy) return;
  const next=structuredClone(match), me=next.players[player], opponent=next.players[enemy];
  me.shots ||= {};
  const ship=opponent.ships.find(s=>s.includes(target));
  me.shots[target]=ship?'hit':'miss';
  const sunk=ship && ship.every(cell=>me.shots[cell]==='hit');
  next.last={player,target,answer:normalize(answer),result:sunk?'sunk':ship?'hit':'miss'};
  if(opponent.ships.flat().every(cell=>me.shots[cell]==='hit')) { next.phase='finished'; next.winner=player; }
  else next.turn=enemy;
  return next;
}
