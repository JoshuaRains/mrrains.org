import { PixelSim, RED, BLUE } from './sim.js';

const el = id => document.getElementById(id);
let gameCode="", gameState="idle";
let sim, dragging=false, moved=false, startPos={x:0,y:0}, viewStart={x:0,y:0};

function init(){
  const canvas = el('view');
  sim = new PixelSim(canvas, { mapSrc:'./grass_map.png', citySrc:'./city.png' });

  // pan/zoom (no duplication: backbuffer takes care of it)
  canvas.addEventListener('mousedown',e=>{
    dragging=true; moved=false; startPos={x:e.clientX,y:e.clientY}; viewStart={x:sim.offsetX,y:sim.offsetY};
  });
  window.addEventListener('mousemove',e=>{
    if(!dragging) return;
    const dx=e.clientX-startPos.x, dy=e.clientY-startPos.y;
    if(Math.abs(dx)>2||Math.abs(dy)>2) moved=true;
    sim.offsetX=viewStart.x+dx; sim.offsetY=viewStart.y+dy;
  });
  window.addEventListener('mouseup',e=>{
    if(!dragging) return; dragging=false;
    if(!moved && gameState==='started'){
      const r=canvas.getBoundingClientRect();
      const {x,y} = sim.screenToImage(e.clientX-r.left, e.clientY-r.top);
      if(x>=0&&y>=0&&x<sim.W&&y<sim.H){
        // manual test push (teacher local)
        sim.startAttack(sim.activeTeam, x,y);
        // also write to DB so students see it too
        db.ref(`games/${gameCode}/actions/attack`).push({
          team: sim.activeTeam===RED?'red':'blue', x,y, ts: firebase.database.ServerValue.TIMESTAMP
        });
      }
    }
  });
  canvas.addEventListener('wheel', e=>sim.handleWheel(e), {passive:false});
  document.addEventListener('keydown',e=>{
    if(e.code==='Space') sim.activeTeam = (sim.activeTeam===RED)?BLUE:RED;
  });

  // teacher buttons
  el('createGameBtn').addEventListener('click', createGame);
  el('startGameBtn').addEventListener('click', startGame);
  el('endGameBtn').addEventListener('click', endGame);
  el('resetMapBtn').addEventListener('click', ()=>{
    sim = new PixelSim(canvas,{mapSrc:'./grass_map.png',citySrc:'./city.png'});
  });
  el('fourthModeToggle').addEventListener('change', e=>{
    if(!gameCode) return;
    db.ref(`games/${gameCode}/uiFourthPeriodMode`).set(!!e.target.checked);
  });

  listenLoop();
}

function listenLoop(){
  function tick(){
    if(gameState==='started') sim.stepOnce();
    sim.render();
    // HUD
    el('activeTeamTxt').textContent = (sim.activeTeam===RED?'Red':'Blue');
    el('defR').textContent = sim.DEFENSE[RED];
    el('defB').textContent = sim.DEFENSE[BLUE];
    el('redCities').textContent = sim.teamCitiesHeld(RED);
    el('blueCities').textContent = sim.teamCitiesHeld(BLUE);
    el('redAtk').textContent = sim.teamAttack(RED);
    el('blueAtk').textContent = sim.teamAttack(BLUE);
    el('speedX').textContent = sim.SPEED_FACTOR.toFixed(2);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* Firebase game plumbing */
function genCode(n=6){ const s="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"; let r=""; for(let i=0;i<n;i++) r+=s[(Math.random()*s.length)|0]; return r; }

function createGame(){
  gameCode = genCode();
  db.ref(`games/${gameCode}`).set({
    state:'waiting', players:{}, questions:{}, uiFourthPeriodMode:false, actions:{}
  }).then(()=>{
    gameState='waiting';
    el('stateTxt').textContent=gameState;
    el('gameCodeTxt').textContent=gameCode;
    el('topLeftCode').textContent="Code: "+gameCode; el('topLeftCode').style.display='block';
    listenPlayers(); listenUIMode(); listenActions(); // teacher also consumes (keeps parity)
  });
}

function listenPlayers(){
  db.ref(`games/${gameCode}/players`).on('value', snap=>{
    const p=snap.val()||{}, keys=Object.keys(p);
    const red = keys.filter(k=>p[k]?.team==='red').length;
    const blue= keys.filter(k=>p[k]?.team==='blue').length;
    el('studentCount').textContent = keys.length;
    el('redCount').textContent = red; el('blueCount').textContent = blue;
  });
}
function listenUIMode(){
  db.ref(`games/${gameCode}/uiFourthPeriodMode`).on('value', snap=>{
    document.body.classList.toggle('green-mode', !!snap.val());
  });
}
function listenActions(){
  // teacher ALSO applies actions to its sim (source of truth = action log)
  db.ref(`games/${gameCode}/actions/attack`).on('child_added', snap=>{
    const a=snap.val();
    const t = (a.team==='red')?RED:BLUE;
    if(Number.isInteger(a.x)&&Number.isInteger(a.y)) sim.startAttack(t,a.x,a.y);
  });
  db.ref(`games/${gameCode}/actions/city`).on('child_added', snap=>{
    const a=snap.val();
    if(Number.isInteger(a.x)&&Number.isInteger(a.y)) sim.addCity(a.x,a.y);
  });
}

function startGame(){
  if(!gameCode) return;
  // push questions
  const raw = el('questionBox').value.trim();
  const arr=[];
  if(raw){
    raw.split('\n').forEach(line=>{
      const p=line.split('|').map(s=>s.trim());
      if(p.length>=6) arr.push({type:'multiple', question:p[0], options:p.slice(1,5), answer:p[5]});
    });
  }
  const size=parseInt(el('gridSizeInput').value)||15; // kept for parity display
  db.ref(`games/${gameCode}`).update({ state:'started', questions:arr, gridSize:size });
  gameState='started'; el('stateTxt').textContent=gameState;
}
function endGame(){
  if(!gameCode) return;
  db.ref(`games/${gameCode}`).update({ state:'over' });
  gameState='over'; el('stateTxt').textContent=gameState;
}

window.addEventListener('beforeunload', ()=>{ if(gameCode) db.ref(`games/${gameCode}`).remove(); });
window.addEventListener('resize', ()=> sim && sim.render());

init();
