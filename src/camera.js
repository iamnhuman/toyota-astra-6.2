import * as THREE from 'three';
import { lane } from './route.js';
import { idleMotion } from './stunt.js';
import { createFlight } from './flight.js';

export const shots = [
  { name:'Передние три четверти', yaw:-.67, radius:6.92, height:1.12, field:5.77, targetZ:.14 },
  { name:'Профиль', yaw:-1.47, radius:6.55, height:1.08, field:5.92, targetZ:.03 },
  { name:'Задние три четверти', yaw:-2.51, radius:7.0, height:1.27, field:5.75, targetZ:-.12 },
];
const {clamp,damp,lerp,smoothstep,smootherstep,radToDeg}=THREE.MathUtils;
const angleTo=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
const aimHeight=.565;
const corners=[];
for(const x of [-.99,.99])for(const y of [0,1.34])for(const z of [-2.22,2.50])corners.push(new THREE.Vector3(x,y,z));

export function createCamera(canvas,onManual){
  const camera=new THREE.PerspectiveCamera(28,1,.13,460);
  const eye=new THREE.Vector3(),aim=new THREE.Vector3(),forward=new THREE.Vector3(),orbitEye=new THREE.Vector3();
  const corner=new THREE.Vector3(),viewFromCar=new THREE.Matrix4();
  const mountPosition=new THREE.Vector3(),mountRotation=new THREE.Quaternion(),bodyRotation=new THREE.Quaternion();
  const pointers=new Map(),crop=new THREE.Vector3(0,0,1),desiredCrop=crop.clone(),entryCrop=crop.clone();
  let manual=shots[0],yaw=manual.yaw,radius=manual.radius,height=manual.height,field=manual.field;
  let aimX=0,aimY=aimHeight,aimZ=manual.targetZ,orbit=0,rise=0,focus=6;
  let flight=null,lastTime=0,near=.13,stuntSide=1,manualFit=1,inCabinPass=false,entryTime=0,entryDuration=1;
  eye.set(Math.sin(yaw)*radius,height,Math.cos(yaw)*radius);
  forward.set(0,aimHeight,aimZ).sub(eye);focus=forward.length();forward.normalize();

  function stopFlight(){
    if(!flight)return;
    flight=null;orbit=rise=0;manualFit=0;
    // Give manual orbit a point in the car, including when taking over inside the cockpit.
    manual={yaw,radius:Math.max(radius,3.1),height,field:Math.max(field,2.33),
      targetX:clamp(aimX,-.84,.84),targetY:clamp(aimY,.34,1.14),targetZ:clamp(aimZ,-1.75,1.95)};
  }
  function zoomAt(factor,x,y,previousX=x,previousY=y){
    stopFlight();
    const box=canvas.getBoundingClientRect();
    const before=desiredCrop.z,scale=clamp(before*factor,.06,3);
    if(scale>=1 && factor>1){
      manual={...manual,radius:Math.max(manual.radius,shots[1].radius),targetX:0,targetY:.65,targetZ:.13};
    }
    const unit=(value,start,length)=>Number.isFinite(value)?clamp((value-start)/length,0,1):.5;
    const anchor=(offset,from,to)=>scale>=1?(1-scale)/2:clamp(offset+from*before-to*scale,0,1-scale);
    desiredCrop.set(
      anchor(desiredCrop.x,unit(previousX,box.left,box.width),unit(x,box.left,box.width)),
      anchor(desiredCrop.y,unit(previousY,box.top,box.height),unit(y,box.top,box.height)),scale);
    onManual();
  }
  canvas.addEventListener('wheel',e=>{
    if(canvas.inert)return;
    e.preventDefault();
    const units=e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight:1;
    const sensitivity=e.ctrlKey ? .008 : .0015;
    zoomAt(Math.exp(clamp(e.deltaY*units*sensitivity,-2.4,2.4)),e.clientX,e.clientY);
  },{passive:false});
  canvas.addEventListener('pointerdown',e=>{
    if(canvas.inert || e.button!==0 || pointers.size>=2)return;
    pointers.set(e.pointerId,new THREE.Vector2(e.clientX,e.clientY));canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove',e=>{
    const p=pointers.get(e.pointerId);
    if(canvas.inert || !p)return;
    const dx=e.clientX-p.x,dy=e.clientY-p.y;
    if(!dx && !dy)return;
    if(pointers.size===2){
      const other=[...pointers.values()].find(value=>value!==p);
      const oldX=(p.x+other.x)/2,oldY=(p.y+other.y)/2;
      const before=p.distanceTo(other);p.set(e.clientX,e.clientY);
      const after=p.distanceTo(other);
      if(before>2 && after>2)zoomAt(before/after,(p.x+other.x)/2,(p.y+other.y)/2,oldX,oldY);
    }else{
      stopFlight();orbit-=dx*.006*Math.min(1,desiredCrop.z**.65);
      rise=clamp(rise+dy*.005*Math.min(1,desiredCrop.z**.65),-.64,1.60);
      p.set(e.clientX,e.clientY);onManual();
    }
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture']){
    canvas.addEventListener(event,e=>pointers.delete(e.pointerId));
  }
  return {
    camera,
    get flying(){return flight!==null;},
    get inCabinPass(){return inCabinPass;},
    toggleFlight(){
      if(flight){stopFlight();return;}
      const gate=Math.max(.48,1/camera.aspect);
      const startField=2*focus*Math.tan(THREE.MathUtils.degToRad(camera.fov)*.5)/gate;
      flight=createFlight(eye,forward,focus,startField);
      entryCrop.copy(crop);entryTime=0;entryDuration=Math.max(1.35,1.6*Math.abs(Math.log(crop.z)));
      desiredCrop.set(0,0,1);
    },
    setShot(i){stopFlight();manual=shots[i];orbit=rise=0;desiredCrop.set(0,0,1);},
    place(frame,time,dt,aspect,motion=idleMotion,vehicleMatrix=null,bodyMatrix=null){
      const stunt=smoothstep(motion.framing,0,.42);
      if(flight){
        const elapsed=motion.active?0:Math.max(0,time-lastTime);
        entryTime+=elapsed;
        const k=flight.sample(elapsed);
        eye.set(k[0],k[1],k[2]);yaw=Math.atan2(eye.x,eye.z);radius=Math.hypot(eye.x,eye.z);height=eye.y;
        forward.set(Math.sin(k[3])*Math.cos(k[4]),Math.sin(k[4]),Math.cos(k[3])*Math.cos(k[4]));
        focus=Math.exp(k[5]);field=2*focus*Math.exp(k[6]);aim.copy(eye).addScaledVector(forward,focus);
        aimX=aim.x;aimY=aim.y;aimZ=aim.z;
        near=lerp(.012,.13,smoothstep(radius,1.55,3.10));
      }else{
        manualFit=damp(manualFit,1,3.2,dt);
        const steady=Math.min(1,crop.z);
        yaw+=angleTo(yaw,manual.yaw+orbit+.064*steady*Math.sin(time*.18))*(1-Math.exp(-4.4*dt));
        radius=damp(radius,manual.radius,4.4,dt);height=damp(height,manual.height+rise,4.4,dt);
        field=damp(field,manual.field,4.4,dt);aimZ=damp(aimZ,manual.targetZ,4.4,dt);
        aimX=damp(aimX,manual.targetX??0,4.4,dt);aimY=damp(aimY,manual.targetY??aimHeight,4.4,dt);
        eye.set(clamp(Math.sin(yaw)*radius,-5.91-lane,4.20-lane),clamp(height+.016*steady*Math.sin(time*1.19),.30,4.02),Math.cos(yaw)*radius);
        aim.set(aimX,aimY+.006*steady*Math.sin(time*.88),aimZ);
        near=damp(near,.13,5,dt);
      }
      lastTime=time;
      if(!motion.active)stuntSide=eye.z<0?-1:1;
      if(stunt>0){
        const r=Math.max(radius,6.1),x=clamp(Math.sin(yaw)*r,-5.91-lane,4.20-lane+.56*motion.framing),z=Math.cos(yaw)*r;
        const pull=x>0?Math.max(0,5.6-Math.hypot(x,z))*motion.framing:0;
        orbitEye.set(x,clamp(height+.39*motion.lift,.30,4.02),z+stuntSide*1.6*pull);
        eye.lerp(orbitEye,stunt);aim.lerp(orbitEye.set(0,aimHeight+.91*motion.lift,.13),stunt);
      }
      forward.subVectors(aim,eye);focus=Math.max(.05,forward.length());forward.normalize();
      // At the windows the entire optical rig is on the sprung chassis.
      // A stationary dashboard point then has zero suspension-induced motion,
      // even as the road banks. Ease back to the road rig for exterior shots.
      const mount=(1-smootherstep(radius,2.55,4.75))*(1-stunt);
      inCabinPass=Boolean(flight && mount>.97);
      mountPosition.copy(frame.position);mountRotation.copy(frame.rotation);
      if(bodyMatrix && mount>0){
        mountPosition.lerp(corner.setFromMatrixPosition(bodyMatrix),mount);
        mountRotation.slerp(bodyRotation.setFromRotationMatrix(bodyMatrix),mount);
      }
      camera.position.copy(eye).applyQuaternion(mountRotation).add(mountPosition);
      aim.copy(forward).applyQuaternion(mountRotation).add(camera.position);
      camera.up.set(0,1,0).applyQuaternion(mountRotation);camera.lookAt(aim);
      const vertical=Math.max(Math.min(2.08,field*.48)+(motion.tight?4.55:6.34)*motion.framing,
        lerp(field,Math.max(field*1.16,6.85),motion.framing)/aspect);
      let halfFov=vertical/(2*focus);
      if(flight)halfFov=lerp(field/(2*focus)*Math.max(.48,1/aspect),halfFov,stunt);
      if(vehicleMatrix && (!flight || stunt>0)){
        camera.updateMatrixWorld();viewFromCar.multiplyMatrices(camera.matrixWorldInverse,vehicleMatrix);
        let fit=halfFov;
        for(const p of corners){
          corner.copy(p).applyMatrix4(viewFromCar);
          fit=Math.max(fit,1.12*Math.max(Math.abs(corner.y),Math.abs(corner.x)/aspect)/Math.max(.12,-corner.z));
        }
        const weight=flight?smoothstep(motion.framing,0,.35):manualFit*smoothstep(radius,2.5,4.5);
        halfFov=lerp(halfFov,fit,weight);
      }
      const fov=clamp(radToDeg(2*Math.atan(halfFov)),15,flight?(aspect<1?150:112):174);
      if(flight){
        const blend=smootherstep(entryTime,0,entryDuration);
        const scale=Math.exp((1-blend)*Math.log(entryCrop.z));
        const offset=Math.abs(1-entryCrop.z)>1e-7?(1-scale)/(1-entryCrop.z):1-blend;
        crop.set(entryCrop.x*offset,entryCrop.y*offset,scale);
      }else crop.lerp(desiredCrop,1-Math.exp(-10*dt));
      if(crop.distanceToSquared(desiredCrop)<1e-12)crop.copy(desiredCrop);
      const scale=lerp(crop.z,1,stunt),left=crop.x*(1-stunt)*aspect,top=crop.y*(1-stunt);
      const view=camera.view;
      if(camera.aspect!==aspect || Math.abs(camera.fov-fov)>1e-9 || Math.abs(camera.near-near)>1e-9 ||
         !view || view.offsetX!==left || view.offsetY!==top || view.height!==scale){
        camera.fov=fov;camera.near=near;
        camera.setViewOffset(aspect,1,left,top,aspect*scale,scale);
      }
      return focus;
    },
  };
}
