import { PixelSim, RED, BLUE } from './sim.js';

const el=id=>document.getElementById(id);
let gameCode="", studentRef=null, studentTeam="";
let questions=[], unseen=[], current=null;
let placingCity=false; // challenge reward
let sim; // student’s local sim (same engine)
let catchingUp=true;

function init(){
  const canvas = el('studentCanvas');
  sim = new PixelSim(canvas, { mapSrc:'./grass_map.png', citySrc:'./city.png' });

  // Student layout: map fills; questions at bottom
  canvas.addEventListener('wheel', e=>sim.handleWheel(e), {passive:false});
  let dragging=false, moved=false, start={x:0,y:0}, viewStart={x:0,y:0};
  canvas.addEventListener('mousedown', e=>{
    dragging=true; moved=false; start={x:e.clientX,y:e.clientY}; viewStart={x:sim.offsetX,y:sim.offsetY};
  });
  window.addEventListener('mousemove', e=>{
    if(!dragging) return;
    const dx=e.clientX-start.x, dy=e.clientY-start.y;
    if(Math.abs(dx)>2||Math.abs(dy)>2) moved=true;
    sim.offsetX=viewStart.x+dx; sim.offsetY=viewStart.y+dy;
  });
  window.addEventListener('mouseup', ()=> dragging=false);

  // Mini “choose coord” behavior: click on map to pick target
  canvas.addEventListener('click', e=>{
    if(!placingCity && el('questionSection').style.display!=='none') return; // Only allow picking after correct answer
  });

  el('joinGameBtn').addEventListener('click', join);
  loop();
}

function loop(){
  // Fast-forward if catching up (increase speed temporarily)
  const original = sim.SPEED_FACTOR;
  if(catchingUp) sim.SPEED_FACTOR = 6.0;
  sim.stepOnce();
  sim.render();
  if(catchingUp) sim.SPEED_FACTOR = original;
  requestAnimationFrame(loop);
}

/* Firebase join */
function join(){
  gameCode = el('gameCodeInput').value.trim();
  if(!gameCode){ el('errorMsg').textContent="Enter a game code."; return; }

  db.ref(`games/${gameCode}`).once('value').then(snap=>{
    if(!snap.exists()){ el('errorMsg').textContent="Game not found."; return; }

    // pick team (balance)
    const playersRef=db.ref(`games/${gameCode}/players`);
    playersRef.once('value').then(ps=>{
      const p=ps.val()||{}; let r=0,b=0; Object.values(p).forEach(v=>{ if(v.team==='red') r++; else if(v.team==='blue') b++; });
      studentTeam = (r<b)?'red' : (b<r)?'blue' : (Math.random()<.5?'red':'blue');
      studentRef = playersRef.push();
      studentRef.set({ team:studentTeam, joinedAt: firebase.database.ServerValue.TIMESTAMP });
      studentRef.onDisconnect().remove();

      // UI
      el('joinSection').style.display='none';
      el('topLeftTeam').style.display='block';
      el('topRightCode').style.display='block';
      el('topLeftTeam').textContent="Team: "+studentTeam.toUpperCase();
      el('topLeftTeam').style.color = (studentTeam==='red')?'#ff6b6b':'#4dabf7';
      el('topRightCode').textContent="Code: "+gameCode;

      listenState();
      // **Key**: load FULL action history then live tail
      subscribeActionsWithCatchup();
    });
  });
}

function listenState(){
  db.ref(`games/${gameCode}/state`).on('value', s=>{
    const st=s.val();
    if(st==='started'){
      // load questions and show first
      db.ref(`games/${gameCode}/questions`).once('value').then(qs=>{
        questions = qs.val()||[];
        if(!Array.isArray(questions)) questions = Object.values(questions);
        unseen = questions.map((_,i)=>i);
        showNextQuestion();
      });
    } else if (st==='over'){
      el('questionSection').style.display='none';
      alert('Game over');
    }
  });
}

/* Action log → deterministic reconstruction */
function subscribeActionsWithCatchup(){
  const attackRef = db.ref(`games/${gameCode}/actions/attack`);
  const cityRef   = db.ref(`games/${gameCode}/actions/city`);

  // 1) Download existing history once
  Promise.all([attackRef.once('value'), cityRef.once('value')]).then(([aSnap,cSnap])=>{
    const attacks=aSnap.val()||{}; const cities=cSnap.val()||{};
    // order by Firebase push key (already chronological)
    Object.keys(attacks).sort().forEach(k=>{
      const a=attacks[k]; sim.startAttack(a.team==='red'?RED:BLUE, a.x|0, a.y|0);
    });
    Object.keys(cities).sort().forEach(k=>{
      const c=cities[k]; sim.addCity(c.x|0, c.y|0);
    });
    // fast-forward will happen naturally via loop() with boosted SPEED_FACTOR until live tail begins
    setTimeout(()=>{ catchingUp=false; }, 400); // short boost window; engine keeps up thereafter

    // 2) Tail new actions live
    attackRef.on('child_added', snap=>{
      const a=snap.val(); sim.startAttack(a.team==='red'?RED:BLUE, a.x|0, a.y|0);
    });
    cityRef.on('child_added', snap=>{
      const c=snap.val(); sim.addCity(c.x|0, c.y|0);
    });
  });
}

/* Questions (bottom bar UI) */
function showNextQuestion(){
  const section = el('questionSection');
  section.style.display='flex';
  const qEl=el('questionText'), opts=el('optionsContainer');
  if(!questions.length){ qEl.textContent="Waiting for questions…"; opts.innerHTML=""; return; }
  if(!unseen.length) unseen = questions.map((_,i)=>i);
  const qi = unseen.splice((Math.random()*unseen.length)|0,1)[0];
  const q = questions[qi]; current=q;

  // 10% challenge → place city
  const challenge = Math.random() < 0.10;
  placingCity = challenge;

  qEl.textContent = q.question + (challenge?" (challenge)":"");
  opts.innerHTML='';
  if(challenge){
    const input=document.createElement('input'); input.placeholder="Type your answer"; opts.appendChild(input);
    input.addEventListener('input', ()=>{
      if(input.value.trim().toLowerCase()===q.answer.trim().toLowerCase()){
        input.style.background='#51cf66';
        setTimeout(()=>{ recordPerf(q.question,true); section.style.display='none'; openPicker(true); }, 400);
      }else input.style.background='';
    });
    const skipBtn=document.createElement('button'); skipBtn.textContent='Skip Challenge';
    skipBtn.onclick=()=> renderMultipleChoice(q);
    opts.appendChild(skipBtn);
  }else{
    renderMultipleChoice(q);
  }
}
function renderMultipleChoice(q){
  const opts=el('optionsContainer'); opts.innerHTML='';
  const shuffled=[...q.options]; for(let i=shuffled.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]]; }
  shuffled.forEach(o=>{
    const b=document.createElement('button'); b.textContent=o;
    b.onclick=e=>{
      const ok=(o.trim().toLowerCase()===q.answer.trim().toLowerCase());
      if(ok){ recordPerf(q.question,true); el('questionSection').style.display='none'; openPicker(false); }
      else{
        e.target.style.background='#ff6b6b';
        [...opts.querySelectorAll('button')].forEach(bb=>{
          if(bb.textContent.trim().toLowerCase()===q.answer.trim().toLowerCase()) bb.style.background='#51cf66';
          bb.disabled=true;
        });
        recordPerf(q.question,false);
        setTimeout(showNextQuestion, 1200);
      }
    };
    opts.appendChild(b);
  });
}
function recordPerf(question,ok){
  const key=question.replace(/[.#$\[\]]/g,'_');
  db.ref(`games/${gameCode}/questionPerformance/${key}`).transaction(cur=>{
    if(cur===null) return {correctCount: ok?1:0, totalCount:1};
    return {correctCount: cur.correctCount+(ok?1:0), totalCount: cur.totalCount+1};
  });
}

/* Picking attack/city by clicking the live map */
function openPicker(isCity){
  placingCity = !!isCity;
  const hint = el('hintText') || document.createElement('div');
  hint.id='hintText'; hint.className='hint';
  hint.textContent = isCity ? 'Click the map to place a City.' : 'Click the map to launch a push.';
  const bar = el('questionSection'); bar.style.display='none'; // keep bottom hidden while waiting for click

  const handler = (e)=>{
    const r=sim.canvas.getBoundingClientRect();
    const {x,y}=sim.screenToImage(e.clientX-r.left, e.clientY-r.top);
    if(x<0||y<0||x>=sim.W||y>=sim.H) return;
    if(isCity){
      db.ref(`games/${gameCode}/actions/city`).push({x,y, ts: firebase.database.ServerValue.TIMESTAMP});
    }else{
      db.ref(`games/${gameCode}/actions/attack`).push({team:studentTeam, x,y, ts: firebase.database.ServerValue.TIMESTAMP});
    }
    window.removeEventListener('click', handler, true);
    setTimeout(showNextQuestion, 200);
  };
  window.addEventListener('click', handler, true);
}

window.addEventListener('beforeunload', ()=>{ if(studentRef) studentRef.remove(); });
window.addEventListener('resize', ()=> sim && sim.render());

init();
