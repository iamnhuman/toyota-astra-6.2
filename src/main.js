import * as THREE from 'three';
import { loadLocation, skyDome, sunDirection } from './surfaces.js';
import { buildRoad } from './location.js';
import { loadSupra } from './car.js';
import { createCamera, shots } from './camera.js';
import { vehicleProbe } from './reflections.js';
import { makeLens } from './lens.js';
import { start } from './route.js';

const el = (id) => document.getElementById(id);
const stage=el('drive'),canvas=el('road'),controls=el('controls'),status=el('loading'),details=el('details');
const compact=matchMedia('(max-width: 700px), (pointer: coarse)').matches;
let playing=!matchMedia('(prefers-reduced-motion: reduce)').matches;
let ready=false,selection=0,showUntil=performance.now()+4500,forceUntil=0,hiddenByKey=false,restorePlay=false;
const labels=['Спереди','Сбоку','Сзади'];

function showControls() {
  hiddenByKey=false;showUntil=performance.now()+3300;stage.classList.remove('quiet');
}
function touchCamera() { forceUntil=performance.now()+1550; showControls(); }
const rigCamera=createCamera(canvas,touchCamera);
const {camera}=rigCamera;
function select(i) {
  selection=i;rigCamera.setShot(i);el('shot-name').textContent=labels[i];
  el('shot').setAttribute('aria-label','Сменить ракурс. Сейчас '+shots[i].name.toLowerCase());
  touchCamera();
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
if(!stage.requestFullscreen && !stage.webkitRequestFullscreen)el('expand').hidden=true;
function fullscreenLabel() {
  const on=Boolean(document.fullscreenElement||document.webkitFullscreenElement);
  el('expand').querySelector('use').setAttribute('href',on?'#shrink-icon':'#expand-icon');
  const label=on?'Выйти из полного экрана':'Во весь экран';
  el('expand').setAttribute('aria-label',label);el('expand').title=label+' (F)';touchCamera();
}
document.addEventListener('fullscreenchange',fullscreenLabel);
document.addEventListener('webkitfullscreenchange',fullscreenLabel);
el('expand').addEventListener('click',fullscreen);
el('play').addEventListener('click',()=>setPlay(!playing));
el('shot').addEventListener('click',()=>select((selection+1)%shots.length));
el('info').addEventListener('click',()=>{restorePlay=playing;setPlay(false);details.showModal();});
el('close').addEventListener('click',()=>details.close());
details.addEventListener('close',()=>{setPlay(restorePlay);el('info').focus();});
stage.addEventListener('pointermove',showControls,{passive:true});
stage.addEventListener('pointerdown',showControls,{passive:true});
document.addEventListener('keydown',e=>{
  if(!ready || e.metaKey || e.ctrlKey || e.altKey || details.open)return;
  if(e.code==='Space' && e.target.closest('button'))return;
  if(e.code==='Space'){e.preventDefault();setPlay(!playing);}
  else if(['Digit1','Digit2','Digit3'].includes(e.code))select(Number(e.code.at(-1))-1);
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
el('retry').addEventListener('click',()=>location.reload());
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
  scene.fog=new THREE.FogExp2(0xb0b8b3,.0054);
  const sun=new THREE.DirectionalLight(0xfff0d7,3.05);
  sun.castShadow=true;sun.shadow.mapSize.setScalar(Math.min(renderer.capabilities.maxTextureSize,compact?1536:3072));
  Object.assign(sun.shadow.camera,{left:-20,right:20,bottom:-20,top:20,near:.5,far:108});
  sun.shadow.camera.updateProjectionMatrix();sun.shadow.normalBias=.016;sun.shadow.bias=-.00013;
  scene.add(sun,sun.target,new THREE.HemisphereLight(0xcddce5,0x8c7d6b,.32));
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
  scene.add(skyDome(location.sky),road.world,car.rig);
  const lens=makeLens(renderer),probe=vehicleProbe(renderer,scene,car,compact);
  let s=start,time=0,speed=19.2,aspect=1,rateScale=1,lastPerf=0,slowFrames=0,fastFrames=0,performanceFrames=0;
  const surfaceSize=new THREE.Vector2(),target=new THREE.Vector3();
  const lightX=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),sunDirection).normalize();
  const lightY=new THREE.Vector3().crossVectors(sunDirection,lightX).normalize();
  function resize() {
    const w=Math.max(2,stage.clientWidth),h=Math.max(2,stage.clientHeight);
    aspect=w/h;
    const maxPixels=compact?1_350_000:2_650_000;
    const baseRatio=Math.min(devicePixelRatio||1,compact?1.6:1.75,Math.sqrt(maxPixels/(w*h)));
    const pixelRatio=Math.min(baseRatio*rateScale,devicePixelRatio||1,2,Math.sqrt(8_294_400/(w*h)));
    renderer.setPixelRatio(pixelRatio);renderer.setSize(w,h,false);
    renderer.getDrawingBufferSize(surfaceSize);lens.resize(surfaceSize.x,surfaceSize.y);
    forceUntil=performance.now()+150;
  }
  new ResizeObserver(resize).observe(stage);resize();

  function placeSun(frame) {
    target.copy(frame.position).addScaledVector(frame.forward,1.0);
    const grid=40/sun.shadow.mapSize.x;
    for(const axis of [lightX,lightY]){
      const coord=target.dot(axis);target.addScaledVector(axis,Math.round(coord/grid)*grid-coord);
    }
    sun.target.position.copy(target);sun.position.copy(target).addScaledVector(sunDirection,53);
  }
  let carFrame=car.pose(s,time,speed,0);
  road.update(s);placeSun(carFrame);rigCamera.place(carFrame,time,1,aspect);
  scene.updateMatrixWorld(true);
  probe(s,0,carFrame,true);
  await renderer.compileAsync(scene,camera);
  setPlay(playing);select(0);
  let last=performance.now(),renderTime=0,oldSpeed='';
  function draw(now) {
    if(!ready)return;
    requestAnimationFrame(draw);
    if(document.hidden){last=now;return;}
    const wallDelta=Math.max(.001,(now-last)/1000);last=now;
    const dt=Math.min(wallDelta,.065);
    const quiet=hiddenByKey || (playing && now>showUntil && !details.open);
    stage.classList.toggle('quiet',quiet);
    if(!playing && now>forceUntil)return;
    const previousSpeed=speed;
    let rolled=0;
    if(playing){
      time+=dt;
      speed=19.2+1.9*Math.sin(time*.115)+.74*Math.sin(time*.229);
      rolled=.5*(speed+previousSpeed)*dt;s+=rolled;
    }
    renderTime+=dt;
    road.update(s);carFrame=car.pose(s,time,speed,(speed-previousSpeed)/dt);
    placeSun(carFrame);
    const focus=rigCamera.place(carFrame,time,dt,aspect);
    probe(s,renderTime,carFrame);
    lens.render(scene,camera,car.rig,dt,rolled/car.radius,focus,playing);
    const speedText=Math.round(speed*3.6)+' км/ч';
    if(speedText!==oldSpeed){el('speed').textContent=speedText;oldSpeed=speedText;}
    // Reduce pixel cost only after sustained slow frames, excluding loading,
    // focus changes and pauses. Camera timing and tyre speed stay in metres.
    if(playing && now>lastPerf+800 && wallDelta<.13){
      performanceFrames++;
      if(wallDelta>.036)slowFrames++;
      if(wallDelta<.0195)fastFrames++;
      if(performanceFrames>=150){
        const oldScale=rateScale;
        if(slowFrames>82)rateScale=Math.max(.64,rateScale-.12);
        else if(!compact && fastFrames>142)rateScale=Math.min(1.72,rateScale+.10);
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
