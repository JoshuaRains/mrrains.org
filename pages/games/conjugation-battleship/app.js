import {PRONOUNS,SHIPS,chooseVerbs,findTarget,placement,randomFleet,fire,joinMatch} from './engine.js';

const $=id=>document.getElementById(id);
let api,auth,db,connected=false,room=null,match=null,unsubscribe,unpresence,player= sessionStorage.getItem('conjugationCaptain'),ships=[],vertical=false,busy=false,selected=-1,presence={};
if(!player){player=crypto.randomUUID();sessionStorage.setItem('conjugationCaptain',player);}
const show=id=>['login','lobby','game'].forEach(key=>$(key).hidden=key!==id);
const errorText=error=>{
  const code=String(error?.code||'');
  if(/invalid-credential|wrong-password|user-not-found|invalid-login/.test(code)) return 'That password did not work. Please try again.';
  if(/too-many-requests/.test(code)) return 'Too many login attempts. Please wait a moment and try again.';
  if(/network/.test(code)) return 'Unable to connect. Check your internet connection and try again.';
  if(/permission|PERMISSION/.test(code)) return 'Database access was denied. Your teacher needs to check the Firebase rules.';
  return error?.message || 'Something went wrong. Please try again.';
};
const path=code=>api.ref(db,`conjugationBattleship/rooms/${code}`);
const bootstrap=(async()=>{
  const [app,authAPI,database]=await Promise.all([
    import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js')
  ]);
  api={...authAPI,...database};
  const instance=app.initializeApp({apiKey:'AIzaSyBgjSlN-UH8W2auosC-tmMn5qGSM-26K2Y',authDomain:'battleship-2b754.firebaseapp.com',databaseURL:'https://battleship-2b754-default-rtdb.firebaseio.com',projectId:'battleship-2b754',storageBucket:'battleship-2b754.firebasestorage.app',messagingSenderId:'423778129035',appId:'1:423778129035:web:2db9ae016848eb1de7308e'});
  auth=api.getAuth(instance); db=api.getDatabase(instance);
  await api.setPersistence(auth,api.inMemoryPersistence);
  api.onValue(api.ref(db,'.info/connected'),snap=>{
    connected=snap.val()===true;
    $('connection').textContent=connected?'CONNECTED':'OFFLINE · Reconnecting';
    if(connected && room) publishPresence();
    if(match) render();
  });
})().catch(error=>{$('loginError').textContent='Could not load the game connection. Check your internet connection and reload this page.';throw error;});
// Keep a failed startup visible without an unhandled promise rejection.
bootstrap.catch(()=>{});
// A cached page keeps its JavaScript state, but its WebSocket may be closed.
window.addEventListener('pagehide',()=>{
  if(!db)return;
  api.goOffline(db);
  connected=false;
  $('connection').textContent='OFFLINE · Reconnecting';
  if(match)render();
});
window.addEventListener('pageshow',event=>{
  if(event.persisted && db)api.goOnline(db);
});
$('loginForm').addEventListener('submit',async event=>{
  event.preventDefault(); $('loginButton').disabled=true; $('loginError').textContent='Connecting…';
  try{
    await bootstrap; await api.signInWithEmailAndPassword(auth,'test@gmail.com',$('password').value);
    $('password').value=''; $('loginError').textContent='';show('lobby');
    const saved=sessionStorage.getItem('conjugationRoom');
    if(saved){ const snapshot=await api.get(path(saved));if(snapshot.val()?.players?.[player]) enterRoom(saved);else sessionStorage.removeItem('conjugationRoom'); }
  }catch(error){$('loginError').textContent=errorText(error);if(auth?.currentUser)$('lobbyError').textContent=errorText(error);}
  finally{$('loginButton').disabled=false;}
});
function captain(){const name=$('name').value.trim();if(!name)throw new Error('Enter your display name first.');return {name,ready:false};}
async function lobbyAction(work){if(busy)return;busy=true;$('create').disabled=$('join').disabled=true;$('lobbyError').textContent='';try{if(!connected)throw new Error('Waiting for a database connection. Try again in a moment.');await work();}catch(error){$('lobbyError').textContent=errorText(error);}finally{busy=false;$('create').disabled=$('join').disabled=false;if(match)render();}}
$('create').onclick=()=>lobbyAction(async()=>{
  const me=captain();
  for(let attempt=0;attempt<5;attempt++){
    const letters='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code=Array.from(crypto.getRandomValues(new Uint8Array(6)),n=>letters[n%letters.length]).join('');
    const initial={createdAt:Date.now(),host:player,phase:'setup',verbs:chooseVerbs(),players:{[player]:me}};
    const result=await api.runTransaction(path(code),value=>value===null?initial:undefined,{applyLocally:false});
    if(result.committed){enterRoom(code);return;}
  }
  throw new Error('Could not reserve a room code. Please try again.');
});
$('joinForm').onsubmit=event=>{event.preventDefault();lobbyAction(async()=>{
  const me=captain(),code=$('code').value.trim().toUpperCase();
  if(!/^[A-Z2-9]{6}$/.test(code))throw new Error('Enter a six-character room code.');
  const snapshot=await api.get(path(code));
  if(!snapshot.exists())throw new Error('Room not found. Check the code with your partner.');
  const result=await api.runTransaction(path(code),value=>joinMatch(value,player,me),{applyLocally:false});
  const joined=result.snapshot.val();
  if(!result.committed || !joined?.players?.[player]){
    if(!joined)throw new Error('This room is no longer available. Ask your partner to create a new room.');
    if(joined.phase!=='setup')throw new Error('This battle has already started. Ask your partner for a new room code.');
    throw new Error('This room already has two players. Ask your partner for a new room code.');
  }
  enterRoom(code);
});};
async function publishPresence(){
  const current=room;if(!current)return;
  const presenceRef=api.ref(db,`conjugationBattleship/presence/${current}/${player}`);
  try{await api.onDisconnect(presenceRef).set(false);if(room===current)await api.set(presenceRef,true);}catch(error){$('answerFeedback').textContent=errorText(error);}
}
function enterRoom(code){
  unsubscribe?.();unpresence?.();room=code;match=null;ships=[];selected=-1;presence={};
  sessionStorage.setItem('conjugationRoom',code);$('roomCode').textContent=code;show('game');publishPresence();
  unpresence=api.onValue(api.ref(db,`conjugationBattleship/presence/${code}`),snapshot=>{presence=snapshot.val()||{};if(match)render();});
  unsubscribe=api.onValue(path(code),snapshot=>{
    match=snapshot.val();
    if(!match?.players?.[player]){exitRoom();$('lobbyError').textContent='This room is no longer available. Create a new room.';return;}
    if(match.players[player].ready)ships=match.players[player].ships;
    render();
  },error=>{$('status').textContent='Room connection failed.';$('answerFeedback').textContent=errorText(error);$('answer').disabled=true;});
}
async function exitRoom(){
  const oldRoom=room;unsubscribe?.();unpresence?.();room=null;match=null;sessionStorage.removeItem('conjugationRoom');show('lobby');
  $('answer').value='';$('answerFeedback').textContent='';$('answer').classList.remove('wrong');
  if(oldRoom)try{await api.set(api.ref(db,`conjugationBattleship/presence/${oldRoom}/${player}`),false);}catch{}
}
$('leave').onclick=async()=>{
  if(busy)return;
  if(match?.phase==='battle'){
    if(!confirm('Leave this battle? Your opponent will win by forfeit.'))return;
    try{await transact(value=>{if(value?.phase!=='battle')return;value.phase='finished';value.winner=Object.keys(value.players).find(id=>id!==player);value.forfeit=true;return value;});}catch(error){$('answerFeedback').textContent=errorText(error);return;}
  }else if(match?.phase==='setup'){
    try{await transact(value=>{if(value?.phase!=='setup')return;delete value.players[player];if(!Object.keys(value.players).length)return null;if(value.host===player)value.host=Object.keys(value.players)[0];return value;});}catch(error){$('answerFeedback').textContent=errorText(error);return;}
  }
  exitRoom();
};
$('again').onclick=exitRoom;
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(room);$('copy').textContent='Copied';setTimeout(()=>$('copy').textContent='Copy code',1800);}catch{$('answerFeedback').textContent=`Share this room code: ${room}`;}};
async function transact(fn){if(!connected)throw new Error('You are offline. Reconnect before making your move.');return api.runTransaction(path(room),fn,{applyLocally:false});}
function render(){
  if(!match)return;
  const me=match.players[player],enemyID=Object.keys(match.players).find(id=>id!==player),enemy=match.players[enemyID],setup=match.phase==='setup',finished=match.phase==='finished';
  $('opponent').textContent=enemy?`${enemy.name}${presence[enemyID]?' · online':' · disconnected'}`:'Waiting for opponent';
  $('phaseTitle').textContent=finished?(match.winner===player?'Victory is yours.':'A battle well fought.'):setup?'Deploy your fleet.':'Make your next move.';
  $('status').textContent=finished?(match.forfeit?'Battle ended by forfeit.':`${match.players[match.winner].name} sank the entire fleet.`):setup?(me.ready?(enemy?'Fleet locked. Waiting for your opponent.':'Fleet locked. Share your room code.'):'Place your ships, then lock in your fleet.'):match.turn===player?'Your turn. Type a conjugation and press Enter.':`${enemy?.name || 'Opponent'} is choosing a target.`;
  $('setupControls').hidden=!setup;
  $('boardTitle').textContent=setup?'Fleet placement':'Opponent’s waters';$('boardEyebrow').textContent=setup?'YOUR WATERS':'ATTACK GRID';
  $('boardFoot').textContent=setup?'Click a cell to place your next ship. Ships cannot overlap.':'Verb rows × subject columns. A correct conjugation selects the intersection.';
  $('placementHint').textContent=me.ready?'Your fleet is locked in.':ships.length===4?'All four ships placed. Lock in when ready.':`Place ship ${ships.length+1} of 4 · ${SHIPS[ships.length]} ${SHIPS[ships.length]===1?'cell':'cells'}`;
  ['rotate','random','clear'].forEach(id=>$(id).disabled=me.ready||busy||!connected);
  $('ready').disabled=me.ready||ships.length!==4||busy||!connected;
  $('ready').textContent=me.ready?'Fleet locked':'Lock in fleet';
  $('answer').disabled=setup||finished||match.turn!==player||busy||!connected;
  document.querySelectorAll('.accent-row button').forEach(button=>button.disabled=$('answer').disabled);
  $('again').hidden=!finished;$('fleetPanel').hidden=setup;
  const board=$('board');board.replaceChildren();
  const head=document.createElement('thead'),row=document.createElement('tr');
  ['VERB / SUBJECT',...PRONOUNS].forEach(text=>{const th=document.createElement('th');th.textContent=text;th.scope='col';row.append(th);});head.append(row);board.append(head);
  const body=document.createElement('tbody');
  match.verbs.forEach((verb,r)=>{
    const tr=document.createElement('tr'),th=document.createElement('th');th.textContent=verb;th.scope='row';tr.append(th);
    PRONOUNS.forEach((pronoun,c)=>{
      const index=r*6+c,td=document.createElement('td'),button=document.createElement('button'),shot=me.shots?.[index];
      button.className='cell';button.type='button';button.setAttribute('aria-label',`${verb}, ${pronoun}${shot?', '+shot:''}`);
      if(setup && ships.flat().includes(index)){button.classList.add('ship');button.textContent=String(ships.findIndex(s=>s.includes(index))+1);}
      if(!setup && shot){button.classList.add(shot);button.textContent=shot==='hit'?'×':'·';}
      if(!setup && selected===index)button.classList.add('target');
      button.disabled=setup?(me.ready||busy||!connected||ships.length===4):!!shot||finished||match.turn!==player||!connected||busy;
      button.onclick=()=>{
        if(setup){const cells=placement(ships.flat(),index,SHIPS[ships.length],vertical);if(cells){ships.push(cells);$('answerFeedback').textContent='';render();}else $('answerFeedback').textContent='That ship does not fit. Choose a free stretch of water.';}
        else{selected=selected===index?-1:index;$('targetHint').textContent=selected<0?'Choose a verb row and a subject column. Type the conjugation below.':`Target: ${verb} + ${pronoun}. Type its conjugation, then press Enter. Click this cell again to clear the target.`;render();$('answer').focus();}
      };td.append(button);tr.append(td);
    });body.append(tr);
  });board.append(body);
  if(!setup){
    const incoming=enemy?.shots||{},mini=$('miniBoard');mini.replaceChildren();
    for(let i=0;i<36;i++){const cell=document.createElement('span');cell.className='mini-cell'+(ships.flat().includes(i)?' ship':'')+(incoming[i]?' '+incoming[i]:'');cell.textContent=incoming[i]==='hit'?'×':incoming[i]==='miss'?'·':'';cell.title=`${match.verbs[Math.floor(i/6)]}, ${PRONOUNS[i%6]}: ${incoming[i]|| (ships.flat().includes(i)?'ship':'water')}`;mini.append(cell);}
    $('fleetCount').textContent=`${ships.filter(s=>!s.every(i=>incoming[i]==='hit')).length} / 4 afloat`;
  }
  if(match.last){const last=match.last;$('lastMove').textContent=`${match.players[last.player].name}: ${last.answer} — ${last.result==='sunk'?'ship sunk':last.result}.`;}
  else $('lastMove').textContent=setup?'Waiting for both captains to deploy.':'Both fleets deployed. The battle has begun.';
}
$('rotate').onclick=()=>{vertical=!vertical;$('rotate').textContent=`Direction: ${vertical?'vertical':'horizontal'}`;};
$('random').onclick=()=>{ships=randomFleet();render();};$('clear').onclick=()=>{ships=[];render();};
$('ready').onclick=async()=>{
  if(busy||ships.length!==4)return;busy=true;render();
  try{const fleet=structuredClone(ships);const result=await transact(value=>{
    if(value?.phase!=='setup'||!value.players[player]||value.players[player].ready)return;
    value.players[player].ships=fleet;value.players[player].ready=true;
    if(Object.keys(value.players).length===2 && Object.values(value.players).every(p=>p.ready)){value.phase='battle';value.turn=value.host;}
    return value;
  });if(!result.committed)throw new Error('The room changed. Please try again.');}
  catch(error){$('answerFeedback').textContent=errorText(error);}finally{busy=false;render();}
};
$('answer').addEventListener('keydown',async event=>{
  if(event.key!=='Enter'||event.isComposing||event.repeat)return;
  event.preventDefault();if(busy||$('answer').disabled)return;
  const answer=$('answer').value,target=findTarget(match.verbs,answer);
  if(target<0 || (selected>=0 && target!==selected)){
    $('answer').classList.add('wrong');$('answer').setAttribute('aria-invalid','true');
    $('answerFeedback').textContent=selected>=0?'That form does not match your target. Correct it and press Enter.':'That form does not match the grid. Check the stem, ending, and accents, then press Enter.';return;
  }
  if(match.players[player].shots?.[target]){$('answerFeedback').textContent='You already attacked that cell. Choose another conjugation.';return;}
  busy=true;render();
  try{
    const result=await transact(value=>fire(value,player,answer));
    if(!result.committed)throw new Error('This attack could not be accepted. Check whose turn it is.');
    $('answer').value='';$('answer').classList.remove('wrong');$('answer').removeAttribute('aria-invalid');$('answerFeedback').textContent='';selected=-1;$('targetHint').textContent='Choose a verb row and a subject column. Type the conjugation below.';
  }catch(error){$('answerFeedback').textContent=errorText(error);}finally{busy=false;render();}
});
$('answer').addEventListener('input',()=>{
  const target=match?findTarget(match.verbs,$('answer').value):-1;
  if(target>=0 && (selected<0||target===selected)){$('answer').classList.remove('wrong');$('answer').removeAttribute('aria-invalid');$('answerFeedback').textContent='Ready. Press Enter to attack.';}
});
document.querySelectorAll('.accent-row button').forEach(button=>button.onclick=()=>{const input=$('answer');if(input.disabled)return;const start=input.selectionStart,end=input.selectionEnd;input.setRangeText(button.textContent,start,end,'end');input.dispatchEvent(new Event('input'));input.focus();});
