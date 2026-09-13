import test from 'node:test';
import assert from 'node:assert/strict';
import {VERBS,conjugate,chooseVerbs,findTarget,placement,randomFleet,fire,joinMatch} from './engine.js';
test('present tense forms preserve accents and ñ',()=>{
  assert.deepEqual(Array.from({length:6},(_,i)=>conjugate('hablar',i)),['hablo','hablas','habla','hablamos','habláis','hablan']);
  assert.equal(conjugate('comer',4),'coméis');assert.equal(conjugate('vivir',4),'vivís');
  assert.equal(conjugate('enseñar',0),'enseño');
  assert.equal(findTarget(['enseñar'],' ENSEÑO '),0);
  assert.equal(findTarget(['enseñar'],'enseno'),-1);assert.equal(findTarget(['hablar'],'hablais'),-1);
});
test('random games use six unique source verbs with balanced endings and unique targets',()=>{
  for(let n=0;n<100;n++){
    const verbs=chooseVerbs();assert.equal(new Set(verbs).size,6);assert.ok(verbs.every(v=>VERBS.includes(v)));
    for(const type of ['ar','er','ir'])assert.equal(verbs.filter(v=>v.endsWith(type)).length,2);
    const forms=verbs.flatMap(v=>Array.from({length:6},(_,i)=>conjugate(v,i)));assert.equal(new Set(forms).size,36);
  }
});
test('fleet placement rejects overlap and wrapping; shuffled fleets are valid',()=>{
  assert.equal(placement([],5,2,false),null);assert.equal(placement([6],0,2,true),null);assert.equal(placement([],30,2,true),null);
  for(let n=0;n<200;n++){const ships=randomFleet();assert.deepEqual(ships.map(s=>s.length),[3,2,2,1]);assert.equal(new Set(ships.flat()).size,8);assert.ok(ships.flat().every(i=>i>=0&&i<36));}
});
const game=()=>({phase:'battle',turn:'a',verbs:['hablar','comer','vivir','leer','usar','abrir'],players:{a:{ships:[[30,31,32],[18,19],[24,25],[35]]},b:{ships:[[0,1,2],[6,7],[12,13],[18]]}}});
test('joining survives an empty transaction cache and adds player two on retry',()=>{
  const captain={name:'Second captain',ready:false};
  assert.equal(joinMatch(null,'b',captain),null);
  const room={phase:'setup',host:'a',players:{a:{name:'First captain',ready:false}}};
  const joined=joinMatch(room,'b',captain);
  assert.deepEqual(Object.keys(joined.players),['a','b']);
  assert.deepEqual(joined.players.b,captain);
  assert.equal(joined.host,'a');
  assert.equal(room.players.b,undefined);
});
test('concurrent joins cannot add a third player or overwrite an existing player',()=>{
  const room={phase:'setup',host:'a',players:{a:{name:'Host',ready:false}}};
  const joined=joinMatch(room,'b',{name:'Guest',ready:false});
  assert.equal(joinMatch(joined,'c',{name:'Third',ready:false}),undefined);
  assert.deepEqual(joinMatch(joined,'b',{name:'Replacement',ready:false}),joined);
});
test('joining never creates a missing room or joins a battle already in progress',()=>{
  assert.equal(joinMatch(null,'b',{name:'Guest',ready:false}),null);
  assert.equal(joinMatch(game(),'c',{name:'Late guest',ready:false}),undefined);
});
test('invalid, out-of-turn, and duplicate shots do not advance the game',()=>{
  const match=game();assert.equal(fire(match,'a','wrong'),undefined);assert.equal(fire(match,'b','hablo'),undefined);
  const next=fire(match,'a','hablo');assert.equal(next.players.a.shots[0],'hit');assert.equal(next.turn,'b');assert.equal(match.players.a.shots,undefined);
  next.turn='a';assert.equal(fire(next,'a','hablo'),undefined);
});
test('misses pass the turn; ships sink and final hits end the game',()=>{
  const miss=fire(game(),'a','hablamos');assert.equal(miss.last.result,'miss');assert.equal(miss.turn,'b');
  let match=game();match.players.a.shots={0:'hit',1:'hit'};match=fire(match,'a','habla');assert.equal(match.last.result,'sunk');
  match.turn='a';match.players.a.shots={0:'hit',1:'hit',2:'hit',6:'hit',7:'hit',12:'hit',13:'hit'};
  match=fire(match,'a','leo');assert.equal(match.phase,'finished');assert.equal(match.winner,'a');assert.equal(fire(match,'a','lees'),undefined);
});
