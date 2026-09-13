import {makeDeck,english,conjugate} from './engine.js';
const $=id=>document.getElementById(id);
let deck=[],state='idle',current=null,lastKey='';
function refill(){
  deck=makeDeck($('source').value,$('ending').value,$('vosotros').checked);
  // Avoid a repeated phrase at the boundary between shuffled decks.
  const next=deck.at(-1);
  if(deck.length>1 && next.verb.es+next.subject.es===lastKey) [deck[0],deck[deck.length-1]]=[deck[deck.length-1],deck[0]];
}
function advance(){
  if(state==='question'){
    const {verb,subject}=current,form=conjugate(verb.es,subject.column);
    $('answer').textContent=subject.es.split(' / ').map(s=>`${s} ${form}`).join(' / ');
    $('answer').hidden=false;$('answer').setAttribute('aria-hidden','false');
    state='answer';$('advance').textContent='Next phrase';$('hint').textContent='Space or click: next phrase';return;
  }
  if(!deck.length)refill();
  current=deck.pop();lastKey=current.verb.es+current.subject.es;
  $('answer').hidden=true;$('answer').setAttribute('aria-hidden','true');$('answer').textContent='—';
  $('prompt').textContent=english(current.verb,current.subject);$('context').textContent=current.subject.hint||'';
  state='question';$('advance').textContent='Reveal answer';$('hint').textContent='Space or click: reveal answer';
}
for(const id of ['source','ending','vosotros'])$(id).addEventListener('change',()=>{lastKey='';refill();state='idle';advance();});
window.addEventListener('keydown',event=>{
  if(event.code!=='Space'||event.repeat||event.ctrlKey||event.altKey||event.metaKey||event.target.closest('select,input,button'))return;
  event.preventDefault();advance();
});
window.addEventListener('click',event=>{if(!event.target.closest('.settings'))advance();});
