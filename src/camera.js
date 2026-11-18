import * as THREE from 'three';
import { lane } from './route.js';
import { idleMotion } from './stunt.js';

export const shots = [
  { name:'Передние три четверти', yaw:-.67, radius:6.92, height:1.12, field:5.77, targetZ:.14 },
  { name:'Профиль', yaw:-1.47, radius:6.55, height:1.08, field:5.92, targetZ:.03 },
  { name:'Задние три четверти', yaw:-2.51, radius:7.0, height:1.27, field:5.75, targetZ:-.12 },
];
const clamp=THREE.MathUtils.clamp;
const damp=THREE.MathUtils.damp;
export function createCamera(canvas, onManual) {
  const camera=new THREE.PerspectiveCamera(28,1,.13,460);
  const localPosition=new THREE.Vector3(),aim=new THREE.Vector3();
  let selected=0, yaw=shots[0].yaw, radius=shots[0].radius, height=shots[0].height, field=shots[0].field;
  let aimZ=shots[0].targetZ, orbit=0, rise=0, zoom=1, drag=null;
  let stuntViewSide=1;
  canvas.addEventListener('pointerdown',e=>{
    if(!e.isPrimary || e.button!==0)return;
    drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove',e=>{
    if(!drag || !e.isPrimary)return;
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    orbit-=dx*.006;rise=clamp(rise+dy*.005,-.64,1.60);
    drag={x:e.clientX,y:e.clientY};onManual();
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>{drag=null;});
  canvas.addEventListener('wheel',e=>{
    e.preventDefault();zoom=clamp(zoom*Math.exp(e.deltaY*.0007),.76,1.34);onManual();
  },{passive:false});
  return {
    camera,
    setShot(i){selected=i;orbit=0;rise=0;zoom=1;},
    place(frame,time,dt,aspect,motion=idleMotion) {
      const shot=shots[selected], desired=shot.yaw+orbit+.064*Math.sin(time*.18);
      const shortest=Math.atan2(Math.sin(desired-yaw),Math.cos(desired-yaw));
      yaw+=shortest*(1-Math.exp(-4.4*dt));
      radius=damp(radius,shot.radius,4.4,dt);height=damp(height,shot.height+rise,4.4,dt);
      field=damp(field,shot.field*zoom,4.4,dt);aimZ=damp(aimZ,shot.targetZ,4.4,dt);
      const z=Math.cos(yaw)*radius;
      if(!motion.active)stuntViewSide=z<0?-1:1;
      const x=clamp(Math.sin(yaw)*radius,-5.91-lane,4.20-lane+.56*motion.framing);
      // Along the outside barrier, pull back along the lane as the car turns.
      const pullback=x>0 ? Math.max(0,5.6-Math.hypot(x,z))*motion.framing : 0;
      localPosition.set(x,height+.39*motion.lift+.016*Math.sin(time*1.19),z+stuntViewSide*1.6*pullback);
      camera.position.copy(localPosition).applyQuaternion(frame.rotation).add(frame.position);
      aim.set(0,.565+.91*motion.lift+.006*Math.sin(time*.88),aimZ).applyQuaternion(frame.rotation).add(frame.position);
      camera.up.lerp(frame.up,.15).normalize();camera.lookAt(aim);
      const distance=camera.position.distanceTo(aim);
      const vertical=Math.max(2.08+(motion.tight?4.55:6.34)*motion.framing,field*(1+.16*motion.framing)/aspect);
      const fov=THREE.MathUtils.radToDeg(2*Math.atan(vertical/(2*distance)));
      if(Math.abs(camera.fov-fov)>.002 || camera.aspect!==aspect) {
        camera.fov=clamp(fov,15,103);camera.aspect=aspect;camera.updateProjectionMatrix();
      }
      return distance;
    },
  };
}
