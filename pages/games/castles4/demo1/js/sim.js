// sim.js — deterministic pixel sim with backbuffered render & DPR-correct sizing
export const NONE=0, RED=1, BLUE=2;
export const OPP=t=>t===RED?BLUE:RED;

export const TERRAIN={GRASS:0,GRASS2:1,WATER:2,DESERT:3,MOUNTAIN:4,PEAK:5};
const GRASS1=[0x6a,0xbe,0x30], GRASS2=[0x66,0xc7,0x23], WATER=[0x63,0x9b,0xff],
      DESERT=[0xd9,0xa0,0x66], MTN=[0x84,0x7e,0x87], PEAK=[0xff,0xff,0xff];

const BASE_TIME ={[TERRAIN.GRASS]:1,[TERRAIN.GRASS2]:1,[TERRAIN.DESERT]:3,[TERRAIN.MOUNTAIN]:5,[TERRAIN.WATER]:Infinity,[TERRAIN.PEAK]:Infinity};
const BASE_COST ={[TERRAIN.GRASS]:1,[TERRAIN.GRASS2]:1,[TERRAIN.DESERT]:3,[TERRAIN.MOUNTAIN]:5,[TERRAIN.WATER]:Infinity,[TERRAIN.PEAK]:Infinity};
const isImpassable=t=>(t===TERRAIN.WATER||t===TERRAIN.PEAK);

const BASE_ATTACK=200, CITY_BONUS=100;
const SPEED_SCALE=0.30; // dialed back baseline

const idx=(x,y,W)=>x+y*W;
const inB=(x,y,W,H)=>x>=0&&y>=0&&x<W&&y<H;
const for4=(x,y,W,H,fn)=>{ if(x>0)fn(x-1,y); if(x<W-1)fn(x+1,y); if(y>0)fn(x,y-1); if(y<H-1)fn(x,y+1); };

class Heap{
  constructor(){this.a=[];}
  less(i,j){const A=this.a[i],B=this.a[j]; if(A.s!==B.s) return A.s<B.s; if(A.aid!==B.aid) return A.aid<B.aid; if(A.y!==B.y) return A.y<B.y; return A.x<B.x;}
  push(n){this.a.push(n); this.bub(this.a.length-1);}
  bub(i){const a=this.a; while(i>0){const p=(i-1)>>1; if(this.less(p,i))break; [a[p],a[i]]=[a[i],a[p]]; i=p;}}
  pop(){const a=this.a; if(!a.length) return null; const r=a[0],v=a.pop(); if(a.length){a[0]=v; this.snk(0);} return r;}
  snk(i){const a=this.a; for(;;){let l=i*2+1,r=i*2+2,s=i; if(l<a.length&&this.less(l,s))s=l; if(r<a.length&&this.less(r,s))s=r; if(s===i)break; [a[i],a[s]]=[a[s],a[i]]; i=s;}}
  get size(){return this.a.length;}
}

// Shared engine object
export class PixelSim{
  constructor(canvas, assets){
    this.canvas=canvas;
    this.ctx=canvas.getContext('2d',{willReadFrequently:true, alpha:false});
    this.ctx.imageSmoothingEnabled=false;

    this.assets = assets || {};
    this.mapImg = new Image(); this.cityImg = new Image();
    this.mapImg.src = this.assets.mapSrc || './grass_map.png';
    this.cityImg.src= this.assets.citySrc|| './city.png';
    this.cityReady=false;
    this.cityImg.onload=()=>{
      this.cityReady=true;
      this.cityW=this.cityImg.width; this.cityH=this.cityImg.height;
      this.cityRed = this.tintSprite(this.cityImg,'rgba(255,48,48,0.25)');
      this.cityBlue= this.tintSprite(this.cityImg,'rgba(48,144,255,0.25)');
    };

    // world (logical) buffers
    this.W=0; this.H=0;
    this.owner=null; this.terrain=null; this.seen=null;
    this.edgeSet={ [RED]:new Set(), [BLUE]:new Set() };
    this.cities = [];
    this.attacks=[]; this.nextAttackId=1;
    this.heap=new Heap();

    // camera/state
    this.dpr = Math.max(1,window.devicePixelRatio||1);
    this.scale=1; this.offsetX=0; this.offsetY=0; this.initializedView=false;
    this.activeTeam=RED;
    this.DEFENSE={[RED]:1,[BLUE]:1};
    this.SEED_BIAS=0.35; this.DIR_BONUS=0.25;
    this.SPEED_FACTOR=1.0;

    // backbuffer (prevents duplicate/tear while panning)
    this.worldCanvas=document.createElement('canvas');
    this.worldCtx=this.worldCanvas.getContext('2d',{willReadFrequently:true, alpha:false});
    this.worldCtx.imageSmoothingEnabled=false;

    // load map → init arrays
    this.mapImg.onload = ()=> this._initFromMap();

    // pan/zoom input (consumer wires them up; helpers here)
  }

  _initFromMap(){
    this.W=this.mapImg.naturalWidth||this.mapImg.width;
    this.H=this.mapImg.naturalHeight||this.mapImg.height;
    this.worldCanvas.width=this.W; this.worldCanvas.height=this.H;
    this.terrain = this._readTerrain(this.mapImg, this.W, this.H);
    this.owner = new Uint8Array(this.W*this.H);
    this.seen  = new Int32Array(this.W*this.H); for(let i=0;i<this.seen.length;i++) this.seen[i]=0;
    this._seedTeams(); this._recomputeEdges();
    this._fitToContainer();
  }

  _readTerrain(image,w,h){
    const c=document.createElement('canvas'); c.width=w; c.height=h;
    const x=c.getContext('2d',{willReadFrequently:true});
    x.imageSmoothingEnabled=false; x.drawImage(image,0,0,w,h);
    const d=x.getImageData(0,0,w,h).data;
    const t=new Uint8Array(w*h);
    for(let y=0;y<h;y++) for(let x0=0;x0<w;x0++){
      const p=(x0+y*w)*4, r=d[p],g=d[p+1],b=d[p+2];
      if(r===GRASS1[0]&&g===GRASS1[1]&&b===GRASS1[2]) t[idx(x0,y,w)]=TERRAIN.GRASS;
      else if(r===GRASS2[0]&&g===GRASS2[1]&&b===GRASS2[2]) t[idx(x0,y,w)]=TERRAIN.GRASS2;
      else if(r===WATER[0] &&g===WATER[1] &&b===WATER[2])  t[idx(x0,y,w)]=TERRAIN.WATER;
      else if(r===DESERT[0]&&g===DESERT[1]&&b===DESERT[2]) t[idx(x0,y,w)]=TERRAIN.DESERT;
      else if(r===MTN[0]   &&g===MTN[1]   &&b===MTN[2])    t[idx(x0,y,w)]=TERRAIN.MOUNTAIN;
      else if(r===PEAK[0]  &&g===PEAK[1]  &&b===PEAK[2])   t[idx(x0,y,w)]=TERRAIN.PEAK;
      else t[idx(x0,y,w)]=TERRAIN.GRASS;
    }
    return t;
  }

  _seedTeams(){
    this.owner.fill(0);
    for(let y=this.H-10;y<this.H;y++) for(let x=0;x<10;x++) this.owner[idx(x,y,this.W)]=RED;
    for(let y=0;y<10;y++) for(let x=this.W-10;x<this.W;x++) this.owner[idx(x,y,this.W)]=BLUE;
    this.heap.a.length=0; this.attacks.length=0; this.nextAttackId=1; this.cities=[];
  }

  _recomputeEdges(){
    this.edgeSet[RED].clear(); this.edgeSet[BLUE].clear();
    for(let y=0;y<this.H;y++) for(let x=0;x<this.W;x++){
      const t=this.owner[idx(x,y,this.W)]; if(!t) continue;
      let edge=false; for4(x,y,this.W,this.H,(nx,ny)=>{ if(this.owner[idx(nx,ny,this.W)]!==t) edge=true; });
      if(edge) this.edgeSet[t].add(idx(x,y,this.W));
    }
  }

  teamCitiesHeld(team){ let n=0; for(const c of this.cities){ if(this.owner[idx(c.x,c.y,this.W)]===team) n++; } return n; }
  teamAttack(team){ return BASE_ATTACK + CITY_BONUS*this.teamCitiesHeld(team); }

  neighborScore(curT, seedBias, ex,ey, nx,ny, cx,cy){
    const dx=cx-ex, dy=cy-ey, len=Math.hypot(dx,dy)||1, ux=dx/len, uy=dy/len;
    const wx=nx-ex, wy=ny-ey, along=(wx*ux+wy*uy), perp=Math.abs(wx*uy-wy*ux);
    const dir = 0.15*perp - this.DIR_BONUS*along;
    return curT + this.SEED_BIAS*seedBias + dir;
  }

  startAttack(team,cx,cy){
    if(this.owner[idx(cx,cy,this.W)]===team) return;
    const total = this.teamAttack(team)|0;
    const aid = this.nextAttackId++;
    this.attacks.push({id:aid, team, cx, cy, remaining:total, active:true});
    this.edgeSet[team].forEach(idc=>{
      const ex=idc%this.W, ey=(idc/this.W)|0;
      for4(ex,ey,this.W,this.H,(nx,ny)=>{
        const nid=idx(nx,ny,this.W); const terr=this.terrain[nid];
        if(isImpassable(terr)) return; if(this.seen[nid]===aid) return;
        const stepBase=(BASE_TIME[terr]||1) + ((this.owner[nid]===OPP(team))?(this.DEFENSE[OPP(team)]|0):0);
        const s=this.neighborScore(stepBase, Math.hypot(nx-cx,ny-cy), ex,ey, nx,ny, cx,cy);
        this.heap.push({s,aid,x:nx,y:ny,t:stepBase,team,cx,cy,ex,ey}); this.seen[nid]=aid;
      });
    });
  }
  addCity(x,y){ if(x>=0&&y>=0&&x<this.W&&y<this.H) this.cities.push({x,y}); }

  _expandFrom(node){
    const {aid,x,y,team,cx,cy}=node;
    for4(x,y,this.W,this.H,(nx,ny)=>{
      const nid=idx(nx,ny,this.W), terr=this.terrain[nid];
      if(isImpassable(terr)) return; if(this.seen[nid]===aid) return;
      const stepBase=node.t + (BASE_TIME[terr]||1) + ((this.owner[nid]===OPP(team))?(this.DEFENSE[OPP(team)]|0):0);
      const s=this.neighborScore(stepBase, Math.hypot(nx-cx,ny-cy), x,y, nx,ny, cx,cy);
      this.heap.push({s,aid,x:nx,y:ny,t:stepBase,team,cx,cy,ex:x,ey:y}); this.seen[nid]=aid;
    });
  }

  stepOnce(){
    if(this.heap.size===0) return false;
    const quota=new Map();
    for(const a of this.attacks){ if(a.active){ const q=Math.max(1,Math.floor(this.teamAttack(a.team)*this.SPEED_FACTOR*SPEED_SCALE)); quota.set(a.id,q); } }

    let progressed=false, popped=0;
    while(this.heap.size && popped<20000){
      const node=this.heap.pop(); popped++;
      const a=this.attacks.find(x=>x.id===node.aid&&x.active); if(!a) continue;
      let q=quota.get(a.id)||0; if(q<=0){ this.heap.push(node); continue; }

      const idc=idx(node.x,node.y,this.W);
      // must touch same-team
      let touches=false; for4(node.x,node.y,this.W,this.H,(nx,ny)=>{ if(this.owner[idx(nx,ny,this.W)]===a.team) touches=true; });
      if(!touches){ this._expandFrom(node); continue; }

      const terr=this.terrain[idc]; if(isImpassable(terr)){ this._expandFrom(node); continue; }
      const tileCost=(BASE_COST[terr]||1)+((this.owner[idc]===OPP(a.team))?(this.DEFENSE[OPP(a.team)]|0):0);
      if(a.remaining<tileCost){ a.active=false; continue; }

      // capture
      this.owner[idc]=a.team;
      a.remaining-=tileCost;
      q=Math.max(0,q-tileCost); quota.set(a.id,q);
      this._expandFrom(node);
      progressed=true;

      if(a.remaining<=0){ a.active=false; }
    }
    if(progressed) this._recomputeEdges();
    return progressed;
  }

  // Rendering using backbuffer to avoid pan/zoom duplication artifacts
  render(){
    // draw world to backbuffer at 1:1 logical pixels
    const wc=this.worldCanvas, wctx=this.worldCtx;
    wctx.setTransform(1,0,0,1,0,0);
    wctx.clearRect(0,0,wc.width,wc.height);
    wctx.drawImage(this.mapImg,0,0,this.W,this.H);

    // interiors
    wctx.fillStyle='rgba(255,48,48,0.28)'; this._drawInterior(wctx,RED);
    wctx.fillStyle='rgba(48,144,255,0.28)'; this._drawInterior(wctx,BLUE);
    // edges
    wctx.fillStyle='#ff3030'; this.edgeSet[RED].forEach(i=>{const x=i%this.W,y=(i/this.W)|0; wctx.fillRect(x,y,1,1);});
    wctx.fillStyle='#3090ff'; this.edgeSet[BLUE].forEach(i=>{const x=i%this.W,y=(i/this.W)|0; wctx.fillRect(x,y,1,1);});

    // cities
    if(this.cityReady){
      const ox=this.cityW>>1, oy=this.cityH>>1;
      for(const c of this.cities){
        const holder=this.owner[idx(c.x,c.y,this.W)];
        let spr=this.cityImg; if(holder===RED) spr=this.cityRed; else if(holder===BLUE) spr=this.cityBlue;
        wctx.drawImage(spr, c.x-ox, c.y-oy);
      }
    }

    // blit backbuffer to visible canvas with crisp DPR-correct transform
    const ctx=this.ctx, canvas=this.canvas;
    const dpr = Math.max(1,window.devicePixelRatio||1);
    const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    const wantW = Math.floor(cssW*dpr), wantH = Math.floor(cssH*dpr);
    if(canvas.width!==wantW || canvas.height!==wantH){ canvas.width=wantW; canvas.height=wantH; }
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    // compute/maintain fitted view box
    if(!this.initializedView){ this._fitToContainer(); }
    const tx=this.offsetX*dpr, ty=this.offsetY*dpr;
    ctx.setTransform(this.scale*dpr,0,0,this.scale*dpr,tx,ty);
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(wc, 0,0,this.W,this.H);
  }

  _drawInterior(wctx,team){
    for(let y=0;y<this.H;y++) for(let x=0;x<this.W;x++){
      const i=idx(x,y,this.W); if(this.owner[i]!==team) continue;
      let interior=true; for4(x,y,this.W,this.H,(nx,ny)=>{ if(this.owner[idx(nx,ny,this.W)]!==team) interior=false; });
      if(interior) wctx.fillRect(x,y,1,1);
    }
  }

  tintSprite(img,color){
    const c=document.createElement('canvas'); c.width=img.width; c.height=img.height;
    const t=c.getContext('2d',{willReadFrequently:true}); t.imageSmoothingEnabled=false;
    t.drawImage(img,0,0); t.globalCompositeOperation='source-atop';
    t.fillStyle=color; t.fillRect(0,0,c.width,c.height);
    t.globalCompositeOperation='source-over';
    return c;
  }

  _fitToContainer(){
    const cssW=this.canvas.clientWidth||this.canvas.parentElement.clientWidth||window.innerWidth-360;
    const cssH=this.canvas.clientHeight||this.canvas.parentElement.clientHeight||window.innerHeight-80;
    if(this.W&&this.H){
      this.scale=Math.min(cssW/this.W, cssH/this.H)*0.98;
      this.offsetX=(cssW - this.W*this.scale)*0.5;
      this.offsetY=(cssH - this.H*this.scale)*0.5;
    }
    this.initializedView=true;
  }

  screenToImage(px,py){
    return { x:Math.floor((px - this.offsetX)/this.scale),
             y:Math.floor((py - this.offsetY)/this.scale) };
  }

  handleWheel(e){
    e.preventDefault();
    const r=this.canvas.getBoundingClientRect();
    const sx=e.clientX-r.left, sy=e.clientY-r.top;
    const ix=(sx - this.offsetX)/this.scale, iy=(sy - this.offsetY)/this.scale;
    const ZOOM_STEP=1.15, MIN=0.2, MAX=12;
    const dir=e.deltaY>0?1/ZOOM_STEP:ZOOM_STEP;
    const ns=Math.max(MIN,Math.min(MAX,this.scale*dir));
    this.offsetX = sx - ix*ns; this.offsetY = sy - iy*ns; this.scale=ns;
  }
}
