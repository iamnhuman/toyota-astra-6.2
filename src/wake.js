import * as THREE from 'three';
import { centreOfMass, idleMotion, orientStunt } from './stunt.js';

const streams=[
  {side:-1,front:true,interval:.253,phase:.18}, {side:1,front:true,interval:.287,phase:.71},
  {side:-1,front:false,interval:.314,phase:.84}, {side:1,front:false,interval:.328,phase:.36},
];
const perStream=7;
export const puffCount=streams.length*perStream;
export const plumeMinZ=-7.35,plumeMaxZ=3.15;
function random(id){
  let n=Math.imul(id^(id>>>16),0x45d9f3b);
  n=Math.imul(n^(n>>>16),0x45d9f3b);
  return ((n^(n>>>16))>>>0)/4294967296;
}

// Puffs retain the position and velocity of the arch at the instant of emission.
// Sampling their birth times also reconstructs the trail when S is turned on mid-flip.
export function createWake(){
  const vectors=()=>Array.from({length:puffCount},()=>new THREE.Vector4());
  const centres=vectors(),shapes=vectors(),padding=new THREE.Vector3(),impact=new THREE.Vector3();
  const arm=new THREE.Vector3(),inherited=new THREE.Vector3(),angularVelocity=new THREE.Vector3(),rotation=new THREE.Quaternion();
  const past={},counts=new Uint8Array(256),stride=4*Math.ceil(puffCount/4);
  return {centres,shapes,padding,impact,
    update(stunt,time,speed){
      const event=stunt?.lastLanding(time),since=event?time-event.landing:Infinity;
      const phase=THREE.MathUtils.clamp(since/.85,0,1);
      const strength=event && since>=0 ? (4*event.height/event.airtime)/8*
        THREE.MathUtils.smoothstep(phase,0,.12)*(1-THREE.MathUtils.smoothstep(phase,.21,1)) : 0;
      impact.set(phase,strength,strength>0?since*speed*.40:0);
      padding.set(0,0,0);
      for(const [s,{side,front,interval,phase:offset}] of streams.entries()){
        const last=Math.floor(time/interval-offset);
        for(let i=0;i<perStream;i++){
          const id=last-i,age=time-(id+offset)*interval,index=s*perStream+i;
          const seed=Math.imul(id,107)+s*9137,roll=random(seed+31),spread=random(seed+79);
          const life=interval*(5.3+1.53*random(seed+23)),progress=Math.min(1,age/life);
          const fade=THREE.MathUtils.smoothstep(age,0,.13)*(1-THREE.MathUtils.smoothstep(progress,.53,1));
          const base=(front?.22:.29)+.125*spread;
          const radius=base+(front?.30:.49)*progress+.12*Math.sin(Math.PI*progress);
          const rx=radius*(.74+.36*roll),ry=radius*(.81+.39*spread),rz=radius*(1.12+.52*random(seed+57));
          const abundance=(front?.74:1)*(.36+.79*random(seed+97))*fade;
          shapes[index].set(1/rx,1/ry,1/rz,abundance);
          const pos=centres[index];
          if(!abundance){pos.set(0,0,0,0);continue;}
          const born=time-age;
          const motion=stunt?stunt.sample(born,past):idleMotion;
          orientStunt(motion,rotation,angularVelocity);
          const originX=side*(.81+.075*spread),originY=.47+.18*roll,originZ=(front?1.29:-1.32)+.23*(roll-.5);
          arm.set(originX,originY,originZ);
          arm.sub(centreOfMass).applyQuaternion(rotation);
          inherited.crossVectors(angularVelocity,arm);
          inherited.y+=motion.verticalSpeed;
          const carry=.51*age*Math.exp(-2.27*age);
          arm.add(centreOfMass).addScaledVector(inherited,carry);
          const turn=(front?3.1:3.65)*age+6.28*roll;
          const outward=(front?.12:.25)*age+.23*age*Math.sin(turn)+.26*age*(spread-.4);
          const buoyancy=(front?.30:.45)*age+(.24+.41*spread)*age*age;
          const slip=(front?.106:.139)*speed*(.83+.29*random(seed+43));
          pos.set(arm.x+side*outward,Math.max(.15,arm.y+motion.lift+buoyancy+.18*age*Math.cos(turn)),
            arm.z-age*slip,6.283*roll+age*(side*(1.3+spread)));
          // Keep the sampling grid fixed in ordinary driving. Only displaced
          // emissions expand it, easing their influence in and out with age.
          const influence=THREE.MathUtils.smoothstep(fade,0,.24);
          padding.x=Math.max(padding.x,Math.abs(arm.x-originX)*influence);
          padding.y=Math.max(padding.y,(arm.y+motion.lift-originY)*influence);
          padding.z=Math.max(padding.z,Math.abs(arm.z-originZ)*influence);
        }
      }
    },
    fillSlices(texture){
      const {data,height}=texture.image,lo=plumeMinZ-padding.z,scale=height/(plumeMaxZ+padding.z-lo);
      counts.fill(0,0,height);data.fill(0);
      for(let i=0;i<puffCount;i++){
        if(shapes[i].w<=.001)continue;
        const z=centres[i].z,extent=1.45/shapes[i].z+.25;
        const first=Math.max(0,Math.floor((z-extent-lo)*scale)),last=Math.min(height-1,Math.floor((z+extent-lo)*scale));
        for(let k=first;k<=last;k++)data[k*stride+counts[k]++]=i+1;
      }
      texture.needsUpdate=true;
    },
  };
}
