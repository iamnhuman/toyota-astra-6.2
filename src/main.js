import * as THREE from 'three';
import { loadLocation, skyDome, sunDirection } from './surfaces.js';
import { buildRoad } from './location.js';
import { loadSupra } from './car.js';
import { createCamera } from './camera.js';
import { vehicleProbe } from './reflections.js';
import { makeLens } from './lens.js';
import { covered, span, start, wrap } from './route.js';
import { createStunt } from './stunt.js';
import { createStudio } from './studio.js';

const el = (id) => document.getElementById(id);
const stage=el('drive'),canvas=el('road'),controls=el('controls'),status=el('loading');
const compact=matchMedia('(max-width: 700px), (pointer: coarse)').matches;
let playing=!matchMedia('(prefers-reduced-motion: reduce)').matches;
let ready=false,showUntil=performance.now()+4500,forceUntil=0,hiddenByKey=false,preparingHD=false;

function showControls() {
  hiddenByKey=false;showUntil=performance.now()+3300;stage.classList.remove('quiet');
}
function touchCamera() { forceUntil=performance.now()+1550; showControls(); }
const rigCamera=createCamera(canvas,()=>{flightLabel();touchCamera();});
const {camera}=rigCamera;
function flightLabel(){
  const enabled=rigCamera.flying;
  el('shot').setAttribute('aria-pressed',String(enabled));
  el('shot').title=(enabled?'Выключить':'Включить')+' облёт камеры (C)';
}
function select(i) {
  rigCamera.setShot(i);flightLabel();touchCamera();
}
function setPlay(value) {
  playing=value;
  el('play').querySelector('use').setAttribute('href',playing?'#pause-icon':'#play-icon');
  const label=playing?'Пауза':'Продолжить';
  el('play').setAttribute('aria-label',label);el('play').title=label+' (пробел)';
  touchCamera();
}
async function fullscreen() {
  try {
    if(document.fullscreenElement)await document.exitFullscreen();
    else if(document.webkitFullscreenElement)document.webkitExitFullscreen();
    else if(stage.requestFullscreen)await stage.requestFullscreen();
    else stage.webkitRequestFullscreen?.();
  } catch { showControls(); }
}
el('play').addEventListener('click',()=>setPlay(!playing));
el('shot').addEventListener('click',()=>{
  rigCamera.toggleFlight();flightLabel();
  if(rigCamera.flying && !playing)setPlay(true);
  else touchCamera();
});
stage.addEventListener('pointermove',showControls,{passive:true});
stage.addEventListener('pointerdown',showControls,{passive:true});
document.addEventListener('keydown',e=>{
  if(!ready || preparingHD || e.metaKey || e.ctrlKey || e.altKey)return;
  if(e.code==='Space' && e.target.closest?.('button'))return;
  if(e.code==='Space'){e.preventDefault();setPlay(!playing);}
  else if(['Digit1','Digit2','Digit3'].includes(e.code))select(Number(e.code.at(-1))-1);
  else if(e.code==='KeyC' && !e.repeat)el('shot').click();
  else if(e.code==='KeyQ' && !e.repeat)el('hd').click();
  else if(e.code==='KeyS' && !e.repeat)el('smoke').click();
  else if(e.code==='KeyJ' && !e.repeat)el('flip').click();
  else if(e.code==='KeyF')void fullscreen();
  else if(e.code==='KeyH'){
    hiddenByKey=!stage.classList.contains('quiet');
    if(hiddenByKey){showUntil=0;canvas.focus({preventScroll:true});stage.classList.add('quiet');}
    else showControls();
  }
});
function failed(message) {
  ready=false;stage.classList.remove('ready');controls.inert=true;
  status.hidden=false;el('message').textContent=message;
  status.querySelector('progress').hidden=true;el('retry').hidden=false;
}
el('retry').addEventListener('click',()=>{
  if(ready)el('hd').click();
  else location.reload();
});
const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
async function waitForFrame(gl){
  const fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);
  if(!fence)throw new Error('Could not fence the HD frame');
  try{
    gl.flush();
    for(;;){
      await nextFrame();
      const state=gl.clientWaitSync(fence,0,0);
      if(state===gl.ALREADY_SIGNALED || state===gl.CONDITION_SATISFIED)return;
      if(state===gl.WAIT_FAILED || gl.isContextLost())throw new Error('HD frame unavailable');
    }
  }finally{gl.deleteSync(fence);}
}
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();failed('Графический контекст прерван.');});
canvas.addEventListener('webglcontextrestored',()=>location.reload());

async function init() {
  const renderer=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false,powerPreference:'high-performance'});
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.AgXToneMapping;
  renderer.toneMappingExposure=1.13;
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.transmissionResolutionScale=compact?.44:.65;
  const scene=new THREE.Scene();
  const daylightFog=new THREE.FogExp2(0xb0b8b3,.0054),black=new THREE.Color(0);
  scene.fog=daylightFog;
  const sun=new THREE.DirectionalLight(0xfff0d7,3.05);
  sun.castShadow=true;sun.shadow.mapSize.setScalar(Math.min(renderer.capabilities.maxTextureSize,compact?1536:3072));
  Object.assign(sun.shadow.camera,{left:-20,right:20,bottom:-20,top:20,near:.5,far:108});
  sun.shadow.camera.updateProjectionMatrix();sun.shadow.normalBias=.016;sun.shadow.bias=-.00013;
  const skyLight=new THREE.HemisphereLight(0xcddce5,0x8c7d6b,.32);
  scene.add(sun,sun.target,skyLight);
  const manager=new THREE.LoadingManager();
  const embeddedAssets = document.getElementById('scene-assets');
  if (embeddedAssets) {
    const files = JSON.parse(embeddedAssets.textContent);
    manager.setURLModifier(url => files[url] ?? url);
    embeddedAssets.remove();
  }
  let progress=0;
  manager.onProgress=(_,loaded,total)=>{
    progress=Math.max(progress,Math.min(.9,loaded/Math.max(1,total)*.9));
    const bar=status.querySelector('progress');bar.max=1;bar.value=progress;
  };
  const [location,car]=await Promise.all([loadLocation(renderer,manager),loadSupra(manager)]);
  el('message').textContent='Настройка света…';
  scene.environment=location.environment.texture;
  scene.environmentIntensity=.88;
  const road=buildRoad(location.materials);
  const sky=skyDome(location.sky);
  scene.add(sky,road.world,car.root);
  const lens=makeLens(renderer,compact),probe=vehicleProbe(renderer,scene,car,compact);
  let s=start,time=0,speed=19.2,aspect=1,rateScale=1,lastPerf=0,slowFrames=0,fastFrames=0,performanceFrames=0;
  let hd=false,studio;
  const savedScale=[1,1];
  const stunt=createStunt(),smokeButton=el('smoke'),flipButton=el('flip'),hdButton=el('hd');
  function setQuality(enabled){
    savedScale[Number(hd)]=rateScale;
    hd=enabled;
    rateScale=savedScale[Number(hd)];
    slowFrames=fastFrames=performanceFrames=0;
    lastPerf=performance.now();
    if(hd && !studio){studio=createStudio(compact);scene.add(studio.rig);}
    if(studio)studio.rig.visible=hd;
    sky.visible=road.world.visible=sun.visible=skyLight.visible=!hd;
    scene.background=hd?black:null;scene.fog=hd?null:daylightFog;
    scene.environment=hd?null:location.environment.texture;
    scene.environmentIntensity=hd?.65:.88;
    renderer.transmissionResolutionScale=hd?(compact?.72:1):(compact?.44:.65);
    location.setHD(hd);
    car.setHD(hd);
    probe.setHD(hd);
    lens.setHD(hd);
    resize();
  }
  function updateHDButton(){
    hdButton.setAttribute('aria-pressed',String(hd));
    hdButton.title=(hd?'Выключить':'Включить')+' HD и студийный свет (Q)';
    touchCamera();
  }
  hdButton.addEventListener('click',async()=>{
    if(!ready || preparingHD)return;
    if(hd){setQuality(false);updateHDButton();return;}
    preparingHD=true;
    const restoreFocus=document.activeElement===hdButton;
    stage.classList.add('preparing-hd');
    canvas.inert=controls.inert=true;
    canvas.setAttribute('aria-busy','true');
    el('message').textContent='Загрузка HD…';
    const bar=status.querySelector('progress');
    bar.removeAttribute('value');bar.hidden=false;bar.setAttribute('aria-label','Загрузка HD');
    el('retry').hidden=true;status.hidden=false;
    let loaded=false;
    try{
      // Let the browser paint the status before any synchronous texture uploads.
      await nextFrame();await nextFrame();
      if(!ready)return;
      setQuality(true);
      studio.place(carFrame,time,motion.lift);
      scene.updateMatrixWorld(true);
      probe(s,renderTime,carFrame,true,motion.lift);
      await lens.prepareCar(car.root,camera,scene);
      if(!ready)return;
      // Include the real shadow, glass, reflection, smoke and composite passes.
      // A resize invalidates the completed frame, including on a paused scene.
      let version;
      do{
        version=viewportVersion;
        renderFrame(0,false);
        await waitForFrame(renderer.getContext());
        if(!ready)return;
      }while(version!==viewportVersion);
      loaded=true;
    }catch(error){
      if(ready && !renderer.getContext().isContextLost()){
        console.error(error);
        setQuality(false);
        el('message').textContent='Не удалось включить HD. Обычный режим доступен.';
        bar.hidden=true;el('retry').hidden=false;
      }
    }finally{
      preparingHD=false;stage.classList.remove('preparing-hd');
      canvas.removeAttribute('aria-busy');
      if(ready){
        status.hidden=loaded;canvas.inert=controls.inert=false;
        last=lastPerf=performance.now();updateHDButton();
        if(restoreFocus)hdButton.focus({preventScroll:true});
      }
    }
  });
  smokeButton.addEventListener('click',()=>{
    const enabled=smokeButton.getAttribute('aria-pressed')!=='true';
    lens.setSmoke(enabled);
    smokeButton.setAttribute('aria-pressed',String(enabled));
    smokeButton.title=(enabled?'Выключить':'Включить')+' дым (S)';
    touchCamera();
  });
  flipButton.addEventListener('click',()=>{
    if(!stunt.start(time,s,speed))return;
    flipButton.setAttribute('aria-disabled','true');
    el('trick-name').textContent=stunt.at(time).name;
    if(!playing)setPlay(true);
    else touchCamera();
  });
  const surfaceSize=new THREE.Vector2(),target=new THREE.Vector3();
  const lightX=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),sunDirection).normalize();
  const lightY=new THREE.Vector3().crossVectors(sunDirection,lightX).normalize();
  let viewportVersion=0;
  function resize() {
    viewportVersion++;
    const w=Math.max(2,stage.clientWidth),h=Math.max(2,stage.clientHeight);
    aspect=w/h;
    const maxPixels=compact?1_350_000:2_650_000;
    const baseRatio=Math.min(devicePixelRatio||1,compact?1.6:1.75,Math.sqrt(maxPixels/(w*h)));
    const hdRatio=Math.min(Math.max(devicePixelRatio||1,compact?1.45:1.65),2.5,Math.sqrt((compact?2_900_000:6_600_000)/(w*h)));
    const requested=hd?hdRatio*rateScale:Math.min(baseRatio*rateScale,devicePixelRatio||1,2);
    const pixelRatio=Math.min(requested,2.5,Math.sqrt(8_294_400/(w*h)),renderer.capabilities.maxTextureSize/Math.max(w,h));
    renderer.setPixelRatio(pixelRatio);renderer.setSize(w,h,false);
    renderer.getDrawingBufferSize(surfaceSize);lens.resize(surfaceSize.x,surfaceSize.y);
    forceUntil=performance.now()+150;
  }
  new ResizeObserver(resize).observe(stage);resize();

  function placeSun(frame) {
    target.copy(frame.position).addScaledVector(frame.forward,1.0);
    const grid=(sun.shadow.camera.right-sun.shadow.camera.left)/sun.shadow.mapSize.x;
    for(const axis of [lightX,lightY]){
      const coord=target.dot(axis);target.addScaledVector(axis,Math.round(coord/grid)*grid-coord);
    }
    sun.target.position.copy(target);sun.position.copy(target).addScaledVector(sunDirection,53);
  }
  let acceleration=1.9*.115+.74*.229;
  let motion=stunt.at(time),carFrame=car.pose(s,time,speed,acceleration,motion);
  road.update(s);placeSun(carFrame);rigCamera.place(carFrame,time,1,aspect,motion,car.rig.matrixWorld,car.body.matrixWorld);
  scene.updateMatrixWorld(true);
  probe(s,0,carFrame,true);
  await renderer.compileAsync(scene,camera);
  setPlay(playing);select(0);
  let last=performance.now(),renderTime=0,oldSpeed='';
  function renderFrame(dt,advance){
    const previousSpeed=speed;
    let rolled=0;
    if(advance){
      time+=dt;
      speed=19.2+1.9*Math.sin(time*.115)+.74*Math.sin(time*.229);
      acceleration=1.9*.115*Math.cos(time*.115)+.74*.229*Math.cos(time*.229);
      rolled=.5*(speed+previousSpeed)*dt;s+=rolled;
    }
    renderTime+=dt;
    motion=stunt.at(time);
    if(!motion.active && flipButton.hasAttribute('aria-disabled')){
      flipButton.removeAttribute('aria-disabled');el('trick-name').textContent='';
    }
    if(!hd)road.update(s);
    carFrame=car.pose(s,time,speed,acceleration,motion);
    if(hd)studio.place(carFrame,time,motion.lift);
    else placeSun(carFrame);
    const focus=rigCamera.place(carFrame,time,dt,aspect,motion,car.rig.matrixWorld,car.body.matrixWorld);
    probe(s,renderTime,carFrame,false,motion.lift,rigCamera.inCabinPass);
    const openSky=!covered(Math.floor(wrap(s)/span));
    lens.render(scene,camera,car,{elapsed:dt,wheelAngle:rolled/car.radius,focus,moving:advance,time,distance:s-start,openSky,stunt,speed,studio:hd?studio:null});
    const speedText=Math.round(speed*3.6)+' км/ч';
    if(speedText!==oldSpeed){el('speed').textContent=speedText;oldSpeed=speedText;}
  }
  function draw(now) {
    if(!ready)return;
    requestAnimationFrame(draw);
    if(document.hidden || preparingHD){last=now;return;}
    const wallDelta=Math.max(.001,(now-last)/1000);last=now;
    const dt=Math.min(wallDelta,.065);
    const quiet=hiddenByKey || (playing && now>showUntil);
    stage.classList.toggle('quiet',quiet);
    if(!playing && now>forceUntil)return;
    renderFrame(dt,playing);
    // Reduce pixel cost only after sustained slow frames, excluding loading,
    // focus changes and pauses. Camera timing and tyre speed stay in metres.
    if(playing && now>lastPerf+800 && wallDelta<.32){
      performanceFrames++;
      if(wallDelta>.036)slowFrames++;
      if(wallDelta<.0195)fastFrames++;
      if(performanceFrames>=150){
        const oldScale=rateScale;
        if(slowFrames>82)rateScale=Math.max(hd?.84:.64,rateScale-.12);
        else if(!compact && fastFrames>142)rateScale=Math.min(hd?1.16:1.72,rateScale+.10);
        if(oldScale!==rateScale){resize();lastPerf=now;}
        performanceFrames=slowFrames=fastFrames=0;
      }
    }
  }
  ready=true;draw(performance.now());
  status.hidden=true;controls.inert=false;stage.classList.add('ready');showControls();
  document.addEventListener('visibilitychange',()=>{last=performance.now();forceUntil=last+180;});
}
init().catch(error=>{
  console.error(error);
  const message=String(error?.message||error);
  failed(/WebGL|context/i.test(message)?'Для движения сцены нужен WebGL 2 с аппаратным ускорением.':'Не удалось загрузить материалы сцены.');
});
