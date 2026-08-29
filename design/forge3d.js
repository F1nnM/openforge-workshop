// forge3d.js — three.js engine for OpenForge Studio: procedural tile meshes, thumbnails, orbit viewer, room builder
let P;
export function getEngine(){ P ??= build(); return P; }

async function build(){
  const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js');
  const TINT={'cut-stone':'#8b8376','dungeon-stone':'#6f6963','rough-stone':'#7d7264','smooth':'#9a938a','plain':'#57524b','wood':'#7a5a38'};
  const texCache=new Map(), matCache=new Map();
  function shade(hex,f){const n=parseInt(hex.slice(1),16);const r=Math.min(255,Math.round(((n>>16)&255)*f)),g=Math.min(255,Math.round(((n>>8)&255)*f)),b=Math.min(255,Math.round((n&255)*f));return `rgb(${r},${g},${b})`;}
  function speckle(x,n,a){for(let i=0;i<n;i++){x.fillStyle=Math.random()<.5?`rgba(0,0,0,${a})`:`rgba(255,255,255,${a*0.7})`;x.fillRect(Math.random()*256,Math.random()*256,1.5+Math.random()*2,1.5+Math.random()*2);}}
  function pattern(pat,tint){
    const key=pat+tint; if(texCache.has(key))return texCache.get(key);
    const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');
    const dark=shade(tint,0.5);
    if(pat==='tile'){x.fillStyle=dark;x.fillRect(0,0,256,256);for(let r=0;r<2;r++)for(let cc=0;cc<2;cc++){x.fillStyle=shade(tint,0.88+Math.random()*0.3);x.fillRect(cc*128+3,r*128+3,122,122);x.strokeStyle='rgba(255,255,255,0.10)';x.lineWidth=2;x.strokeRect(cc*128+5,r*128+5,118,118);}speckle(x,500,0.06);}
    else if(pat==='brick'){x.fillStyle=dark;x.fillRect(0,0,256,256);for(let r=0;r<4;r++){const off=r%2?64:0;for(let cc=-1;cc<3;cc++){x.fillStyle=shade(tint,0.85+Math.random()*0.35);x.fillRect(cc*128+off+2,r*64+2,124,60);}}speckle(x,500,0.06);}
    else if(pat==='mosaic'){x.fillStyle=dark;x.fillRect(0,0,256,256);for(let i=0;i<70;i++){x.fillStyle=shade(tint,0.75+Math.random()*0.5);const w=28+Math.random()*52,h=22+Math.random()*44;x.fillRect(Math.random()*256-10,Math.random()*256-10,w,h);}x.strokeStyle='rgba(0,0,0,0.25)';for(let i=0;i<40;i++){x.strokeRect(Math.random()*256-10,Math.random()*256-10,30+Math.random()*50,24+Math.random()*40);}speckle(x,600,0.07);}
    else if(pat==='noise'){x.fillStyle=tint;x.fillRect(0,0,256,256);speckle(x,2200,0.09);}
    else if(pat==='flat'){x.fillStyle=tint;x.fillRect(0,0,256,256);speckle(x,320,0.05);x.strokeStyle='rgba(0,0,0,0.18)';x.lineWidth=2;x.strokeRect(0,0,256,256);x.beginPath();x.moveTo(128,0);x.lineTo(128,256);x.moveTo(0,128);x.lineTo(256,128);x.stroke();}
    else{ // plank
      x.fillStyle=shade(tint,0.45);x.fillRect(0,0,256,256);for(let i=0;i<6;i++){x.fillStyle=shade(tint,0.8+Math.random()*0.4);x.fillRect(i*43+2,0,39,256);x.strokeStyle='rgba(0,0,0,0.15)';for(let g=0;g<4;g++){x.beginPath();const gx=i*43+6+Math.random()*30;x.moveTo(gx,0);x.bezierCurveTo(gx+4,80,gx-4,170,gx+2,256);x.stroke();}}speckle(x,300,0.05);}
    texCache.set(key,c);return c;
  }
  function mat(pat,tint,rx,ry){
    const key=`${pat}|${tint}|${rx}|${ry}`; if(matCache.has(key))return matCache.get(key);
    const t=new THREE.CanvasTexture(pattern(pat,tint)); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(rx,ry); t.anisotropy=4;
    const m=new THREE.MeshStandardMaterial({map:t,roughness:0.95,metalness:0}); matCache.set(key,m); return m;
  }
  let _dark; const darkMat=()=> _dark ??= new THREE.MeshStandardMaterial({color:0x3d372f,roughness:0.95});

  function buildTile(tile){
    const g=new THREE.Group(); const tint=TINT[tile.set]||TINT.plain;
    const fPat=tile.set==='dungeon-stone'?'mosaic':tile.set==='rough-stone'?'noise':tile.set==='smooth'?'flat':'tile';
    const wPat=(tile.set==='dungeon-stone'||tile.set==='rough-stone')?'mosaic':'brick';
    const box=(w,h,d,m)=>{const ms=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);ms.position.y=h/2;return ms;};
    switch(tile.geo){
      case'floor':{const top=mat(fPat,tint,tile.w/2,tile.d/2);const s=darkMat();const ms=new THREE.Mesh(new THREE.BoxGeometry(tile.w,0.25,tile.d),[s,s,top,s,s,s]);ms.position.y=0.125;g.add(ms);break;}
      case'base': g.add(box(tile.w,0.15,tile.d,mat('flat',tint,tile.w/2,tile.d/2))); break;
      case'curve':{const s=new THREE.Shape();s.moveTo(0,0);s.absarc(0,0,2,0,Math.PI/2,false);s.lineTo(0,0);const geo=new THREE.ExtrudeGeometry(s,{depth:0.25,bevelEnabled:false});geo.rotateX(-Math.PI/2);g.add(new THREE.Mesh(geo,mat(fPat,tint,0.5,0.5)));break;}
      case'wall': g.add(box(tile.w,2,0.3,mat(wPat,tint,tile.w/2,1))); break;
      case'slit':{g.add(box(tile.w,2,0.3,mat(wPat,tint,tile.w/2,1)));const sl=box(0.14,1.0,0.34,new THREE.MeshStandardMaterial({color:0x14100c,roughness:1}));sl.position.y=1.1;g.add(sl);break;}
      case'wallOnTile':{const top=mat(fPat,tint,tile.w/2,0.5);const s=darkMat();const fl=new THREE.Mesh(new THREE.BoxGeometry(tile.w,0.25,1),[s,s,top,s,s,s]);fl.position.y=0.125;g.add(fl);const wl=box(tile.w,1.85,0.4,mat(wPat,tint,tile.w/2,1));wl.position.y=0.25+1.85/2;wl.position.z=-0.5+0.2;g.add(wl);break;}
      case'door':{const w=tile.w;const s=new THREE.Shape();s.moveTo(-w/2,0);s.lineTo(-w/2,2);s.lineTo(w/2,2);s.lineTo(w/2,0);s.closePath();const h=new THREE.Path();h.moveTo(-0.55,0);h.lineTo(-0.55,1.15);h.absarc(0,1.15,0.55,Math.PI,0,true);h.lineTo(0.55,0);h.closePath();s.holes.push(h);const geo=new THREE.ExtrudeGeometry(s,{depth:0.35,bevelEnabled:false});geo.translate(0,0,-0.175);g.add(new THREE.Mesh(geo,mat(wPat,tint,0.5,0.5)));break;}
      case'stairs':{const m=mat(fPat,tint,tile.w/2,0.3);for(let i=0;i<4;i++){const h=(i+1)*0.5,sd=tile.d/4;const st=box(tile.w,h,sd,m);st.position.z=tile.d/2-sd/2-i*sd;g.add(st);}break;}
      case'column':{const m=mat('flat',tint,0.5,0.5);g.add(box(0.9,0.22,0.9,m));const cyl=new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.36,1.56,20),m);cyl.position.y=0.22+0.78;g.add(cyl);const cap=box(0.8,0.16,0.8,m);cap.position.y=0.22+1.56+0.08;g.add(cap);break;}
      case'pillar': g.add(box(0.45,2,0.45,mat(wPat,tint,0.25,1))); break;
      case'crate':{const m=mat('plank',TINT.wood,0.5,0.5);g.add(box(0.9,0.9,0.9,m));const fr=new THREE.MeshStandardMaterial({color:0x4a3620,roughness:1});[[0,-0.42],[0,0.42]].forEach(([q,z])=>{const e=box(0.94,0.1,0.06,fr);e.position.set(0,0.05,z);g.add(e);const e2=box(0.94,0.1,0.06,fr);e2.position.set(0,0.85,z);g.add(e2);});break;}
      case'barrel':{const m=mat('plank',TINT.wood,1,0.6);const cyl=new THREE.Mesh(new THREE.CylinderGeometry(0.34,0.3,1.0,16),m);cyl.position.y=0.5;g.add(cyl);const bm=new THREE.MeshStandardMaterial({color:0x33261a,roughness:0.8});[0.22,0.78].forEach(y=>{const b=new THREE.Mesh(new THREE.CylinderGeometry(0.35,0.35,0.05,16),bm);b.position.y=y;g.add(b);});break;}
    }
    const b=new THREE.Box3().setFromObject(g);
    const cx=(b.min.x+b.max.x)/2, cz=(b.min.z+b.max.z)/2, my=b.min.y;
    g.children.forEach(ch=>{ch.position.x-=cx;ch.position.z-=cz;ch.position.y-=my;});
    g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
    return g;
  }

  function makeLights(scene,sz){
    scene.add(new THREE.HemisphereLight(0xfff1dc,0x2c241b,1.15));
    const dir=new THREE.DirectionalLight(0xffdfae,1.9); dir.position.set(6,11,5); dir.castShadow=true;
    dir.shadow.mapSize.set(2048,2048); const c=dir.shadow.camera; c.left=-sz;c.right=sz;c.top=sz;c.bottom=-sz;
    scene.add(dir);
  }
  function shadowPlane(){const gp=new THREE.Mesh(new THREE.PlaneGeometry(60,60),new THREE.ShadowMaterial({opacity:0.28}));gp.rotation.x=-Math.PI/2;gp.receiveShadow=true;return gp;}

  // ---------- thumbnails ----------
  let tR,tScene,tCam,tHolder;
  function thumbCtx(w,h){
    if(!tR){tR=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});tR.shadowMap.enabled=true;tR.shadowMap.type=THREE.PCFSoftShadowMap;tScene=new THREE.Scene();makeLights(tScene,10);tScene.add(shadowPlane());tCam=new THREE.PerspectiveCamera(30,1,0.1,200);tHolder=new THREE.Group();tScene.add(tHolder);}
    tR.setSize(w,h);tCam.aspect=w/h;tCam.updateProjectionMatrix();
  }
  function frame(cam,obj,f){const b=new THREE.Box3().setFromObject(obj);const sp=b.getBoundingSphere(new THREE.Sphere());const d=sp.radius*f+0.5;cam.position.copy(sp.center).addScaledVector(new THREE.Vector3(1.15,0.8,1.35).normalize(),d);cam.lookAt(sp.center);}
  function thumbnail(tile){
    thumbCtx(300,225); tHolder.clear(); tHolder.add(buildTile(tile));
    frame(tCam,tHolder,2.7); tR.render(tScene,tCam); return tR.domElement.toDataURL('image/png');
  }
  function composition(recs,getTile,w,h){
    thumbCtx(w,h); tHolder.clear();
    recs.forEach(rc=>{const m=buildTile(getTile(rc.tileId));m.rotation.y=(rc.rot||0)*Math.PI/2;m.position.set(rc.x,rc.y||0,rc.z);tHolder.add(m);});
    frame(tCam,tHolder,1.9); tR.render(tScene,tCam); return tR.domElement.toDataURL('image/png');
  }

  // ---------- orbit viewer ----------
  function createViewer(canvas){
    const r=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});r.setPixelRatio(Math.min(2,devicePixelRatio));r.shadowMap.enabled=true;r.shadowMap.type=THREE.PCFSoftShadowMap;
    const scene=new THREE.Scene();makeLights(scene,8);scene.add(shadowPlane());
    const holder=new THREE.Group();scene.add(holder);
    const cam=new THREE.PerspectiveCamera(32,1,0.1,200);
    let ctr=new THREE.Vector3(),rad=6,th=0.7,ph=1.05,auto=true,resume=0,disposed=false,drag=null;
    canvas.style.touchAction='none';
    canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);auto=false;});
    canvas.addEventListener('pointermove',e=>{if(!drag)return;th-=(e.clientX-drag.x)*0.008;ph=Math.min(1.45,Math.max(0.25,ph-(e.clientY-drag.y)*0.006));drag={x:e.clientX,y:e.clientY};});
    canvas.addEventListener('pointerup',()=>{drag=null;resume=Date.now()+2500;});
    canvas.addEventListener('wheel',e=>{e.preventDefault();rad=Math.min(40,Math.max(1.5,rad*(1+e.deltaY*0.001)));},{passive:false});
    function loop(){
      if(disposed)return;requestAnimationFrame(loop);
      const w=canvas.clientWidth||300,h=canvas.clientHeight||240;
      if(canvas.width!==w*r.getPixelRatio()){r.setSize(w,h,false);cam.aspect=w/h;cam.updateProjectionMatrix();}
      if(auto||(resume&&Date.now()>resume))th+=0.004;
      cam.position.set(ctr.x+rad*Math.sin(ph)*Math.cos(th),ctr.y+rad*Math.cos(ph),ctr.z+rad*Math.sin(ph)*Math.sin(th));
      cam.lookAt(ctr);r.render(scene,cam);
    }
    loop();
    return {
      setTile(tile){holder.clear();holder.add(buildTile(tile));const b=new THREE.Box3().setFromObject(holder);const sp=b.getBoundingSphere(new THREE.Sphere());ctr=sp.center.clone();rad=sp.radius*2.6+0.6;auto=true;resume=0;},
      dispose(){disposed=true;r.dispose();}
    };
  }

  // ---------- room builder ----------
  function createBuilder(canvas,{getTile,onChange,snap=0.5,placements=[]}){
    const r=new THREE.WebGLRenderer({canvas,antialias:true});r.setPixelRatio(Math.min(2,devicePixelRatio));r.shadowMap.enabled=true;r.shadowMap.type=THREE.PCFSoftShadowMap;r.setClearColor(0x14100c);
    const scene=new THREE.Scene();scene.fog=new THREE.Fog(0x14100c,55,95);makeLights(scene,18);
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(160,160),new THREE.MeshStandardMaterial({color:0x1d1712,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-0.02;ground.receiveShadow=true;scene.add(ground);
    const grid=new THREE.GridHelper(24,24,0x9c7a45,0x39322a);grid.material.transparent=true;grid.material.opacity=0.55;scene.add(grid);
    const placed=new THREE.Group();scene.add(placed);
    const cam=new THREE.PerspectiveCamera(42,1,0.1,300);
    const target=new THREE.Vector3(0,0,0);let th=0.85,ph=0.95,rad=24;
    let recs=[],uidn=1,active=null,tool='place',rot=0,ghost=null,snapV=snap,disposed=false;
    const ray=new THREE.Raycaster(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),0),pt=new THREE.Vector3();
    const ghostMat=new THREE.MeshStandardMaterial({color:0xc98e3f,transparent:true,opacity:0.5,depthWrite:false});
    function fp(tile,rr){return rr%2?[tile.d,tile.w]:[tile.w,tile.d];}
    function elev(tile,x,z){if(tile.kind==='floor'||tile.kind==='base')return 0;for(const rc of recs){const t=getTile(rc.tileId);if(t.kind!=='floor')continue;const[w,d]=fp(t,rc.rot);if(Math.abs(x-rc.x)<=w/2&&Math.abs(z-rc.z)<=d/2)return 0.25;}return 0;}
    function addRec(rc){const tile=getTile(rc.tileId);if(!tile)return;const m=buildTile(tile);m.rotation.y=rc.rot*Math.PI/2;m.position.set(rc.x,rc.y,rc.z);m.userData.uid=rc.uid;placed.add(m);recs.push(rc);uidn=Math.max(uidn,rc.uid+1);}
    placements.forEach(rc=>addRec({...rc}));
    function emit(){onChange&&onChange(recs.map(rc=>({...rc})));}
    function rebuildGhost(){if(ghost){placed.parent.remove(ghost);ghost=null;}if(active&&tool==='place'){ghost=buildTile(active);ghost.traverse(o=>{if(o.isMesh)o.material=ghostMat;});ghost.rotation.y=rot*Math.PI/2;ghost.visible=false;scene.add(ghost);}}
    function ptrPoint(e){const rect=canvas.getBoundingClientRect();ray.setFromCamera({x:((e.clientX-rect.left)/rect.width)*2-1,y:-((e.clientY-rect.top)/rect.height)*2+1},cam);return ray.ray.intersectPlane(plane,pt)?pt:null;}
    function snapPos(p,tile){const[w,d]=fp(tile,rot);return{x:Math.round((p.x-w/2)/snapV)*snapV+w/2,z:Math.round((p.z-d/2)/snapV)*snapV+d/2};}
    let down=null,dragging=false;
    canvas.style.touchAction='none';
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    canvas.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY,b:e.button};dragging=false;canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove',e=>{
      if(down){
        const dx=e.clientX-down.x,dy=e.clientY-down.y;
        if(dragging||Math.hypot(dx,dy)>5){
          dragging=true;
          if(down.b===1||e.shiftKey){const s=rad*0.0016;const fw=new THREE.Vector3(Math.cos(th),0,Math.sin(th)),rt=new THREE.Vector3(-Math.sin(th),0,Math.cos(th));target.addScaledVector(rt,-dx*s).addScaledVector(fw,dy*s);}
          else{th-=dx*0.006;ph=Math.min(1.35,Math.max(0.2,ph-dy*0.005));}
          down.x=e.clientX;down.y=e.clientY;
        }
      } else if(ghost){const p=ptrPoint(e);if(p){const sp=snapPos(p,active);ghost.visible=true;ghost.position.set(sp.x,elev(active,sp.x,sp.z),sp.z);}}
    });
    canvas.addEventListener('pointerup',e=>{
      const wasDrag=dragging;const b=down?down.b:0;down=null;dragging=false;
      if(wasDrag||b!==0)return;
      if(tool==='place'&&active){const p=ptrPoint(e);if(!p)return;const sp=snapPos(p,active);addRec({uid:uidn++,tileId:active.id,x:sp.x,z:sp.z,y:elev(active,sp.x,sp.z),rot});emit();}
      else if(tool==='erase'){const rect=canvas.getBoundingClientRect();ray.setFromCamera({x:((e.clientX-rect.left)/rect.width)*2-1,y:-((e.clientY-rect.top)/rect.height)*2+1},cam);const hits=ray.intersectObjects(placed.children,true);if(hits.length){let o=hits[0].object;while(o&&o.userData.uid===undefined)o=o.parent;if(o){recs=recs.filter(rc=>rc.uid!==o.userData.uid);placed.remove(o);emit();}}}
    });
    canvas.addEventListener('pointerleave',()=>{if(ghost)ghost.visible=false;});
    canvas.addEventListener('wheel',e=>{e.preventDefault();rad=Math.min(70,Math.max(6,rad*(1+e.deltaY*0.001)));},{passive:false});
    function loop(){
      if(disposed)return;requestAnimationFrame(loop);
      const w=canvas.clientWidth||600,h=canvas.clientHeight||400;
      if(canvas.width!==Math.floor(w*r.getPixelRatio())){r.setSize(w,h,false);cam.aspect=w/h;cam.updateProjectionMatrix();}
      cam.position.set(target.x+rad*Math.sin(ph)*Math.cos(th),target.y+rad*Math.cos(ph),target.z+rad*Math.sin(ph)*Math.sin(th));
      cam.lookAt(target);r.render(scene,cam);
    }
    loop();
    return {
      setActive(tile){active=tile;rot=0;rebuildGhost();},
      setTool(t){tool=t;rebuildGhost();canvas.style.cursor=t==='erase'?'crosshair':'default';},
      rotate(){rot=(rot+1)%4;if(ghost)ghost.rotation.y=rot*Math.PI/2;},
      setSnap(v){snapV=v;},
      clear(){placed.clear();recs=[];emit();},
      dispose(){disposed=true;r.dispose();}
    };
  }

  return {THREE,buildTile,thumbnail,composition,createViewer,createBuilder};
}
