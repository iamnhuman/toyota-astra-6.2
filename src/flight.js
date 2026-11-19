import { MathUtils,Vector3 } from 'three';
import { lane } from './route.js';

const {clamp,lerp}=MathUtils;
const playbackRate=1.6;
const angleTo=(from,to)=>Math.atan2(Math.sin(to-from),Math.cos(to-from));
function shot([x,height,z],[targetX,targetY,targetZ],field,duration,pass=null){
  return {yaw:Math.atan2(x,z),radius:Math.hypot(x,z),height,targetX,targetY,targetZ,field,duration,pass};
}
// Each cockpit key specifies eye position and gaze direction independently.
// All positions are in metres relative to the car, with +Z toward the bonnet.
const rearToFront=[
  [[-.12,1.58,-1.70],[.16,-1.62,1]], [[-.060,1.31,-1.49],[.10,-.88,1]],
  [[-.025,1.085,-1.13],[.05,-.22,1]], [[-.024,1.02,-.49],[.06,-.068,1]],
  [[-.023,1.01,.21],[.07,-.052,1]], [[-.070,1.095,.85],[.16,-.064,1]],
  [[-.40,1.20,1.94],[.84,-.09,.60]], [[-1.59,1.26,3.10],[1,-.12,-.53]],
];
const frontToRear=[
  [[.28,1.39,2.50],[.09,-.13,-1]], [[-.016,1.060,.65],[.12,-.12,-1]],
  [[-.028,1.02,.04],[.10,-.14,-1]], [[-.033,1.025,-.53],[.02,-.20,-1]],
  [[-.052,1.056,-1.03],[-.10,-.23,-1]], [[-.090,1.215,-1.57],[-.19,-.12,-1]],
  [[-.39,1.44,-2.32],[.80,-.14,-.62]], [[-1.51,1.43,-2.87],[.96,-.12,.52]],
];
const sideWindow=[
  [[-1.54,1.10,-.015],[1,-.045,-.14]], [[-.64,1.045,.035],[1,-.03,-.11]],
  [[-.10,1.035,.065],[1,-.02,-.06]], [[.68,1.055,.11],[1,-.015,.03]],
  [[1.40,1.18,.32],[.86,-.09,.47]], [[1.76,1.36,1.10],[-.48,-.14,.88]],
];
const windscreenToSide=[
  [[.49,1.33,2.22],[-.43,-.15,-1]], [[-.08,1.065,.62],[-.65,-.09,-1]],
  [[-.37,1.02,.22],[-.79,-.065,-1]], [[-.83,1.025,-.13],[-1,-.05,-.73]],
  [[-1.84,1.18,-.77],[-1,-.07,-.22]], [[-2.64,1.28,.12],[-.45,-.12,1]],
];

const flightShots=[
  // Rear approach, glass-to-glass pass, front optics and an overhead reveal.
  shot([-1.78,1.68,-3.75],[0,.90,-1.27],3.60,2.20),
  shot([-.48,2.01,-2.13],[0,.834,-1.385],1.56,2.65),
  shot([-.19,1.83,-1.82],[0,.834,-1.385],1.24,2.45),
  shot([-3.4,1.23,3.7],[0,.69,.45],4.75,3.75,rearToFront),
  shot([-.97,.64,3.16],[-.58,.65,2.07],1.24,1.72),
  shot([.16,.34,3.92],[0,.35,2.07],2.40,1.24),
  shot([1.84,.90,2.32],[.76,.38,1.39],1.54,1.48),
  shot([1.67,2.74,.40],[.19,.78,.03],3.84,1.26),
  shot([.19,3.98,.16],[.02,.62,.04],5.68,1.59),
  shot([-3.86,2.42,-2.62],[0,.85,-.64],5.14,1.52),
  // The wing, the plate, a low wheel tracking shot, then side window to side window.
  shot([-.90,1.43,-2.99],[-.38,1.10,-1.72],1.64,1.51),
  shot([.34,.57,-3.21],[0,.53,-1.96],1.31,1.33),
  shot([2.11,.37,-1.84],[.77,.35,-1.14],1.77,1.53),
  shot([-.62,2.87,-4.34],[0,.55,-.14],5.37,1.69),
  shot([-4.05,1.08,-.20],[-.18,.88,.01],3.74,1.42),
  shot([2.16,1.52,2.46],[.12,.78,.09],3.53,3.25,sideWindow),
  shot([1.10,3.43,3.36],[0,.76,1.12],3.92,1.54),
  shot([-.13,1.64,5.65],[0,.81,.62],4.95,1.37),
  // Reverse the longitudinal pass; sweep from the tail lamps to the opposite flank.
  shot([-3.23,1.22,-3.18],[0,.79,-.76],4.36,3.68,frontToRear),
  shot([-1.09,.87,-2.81],[-.62,.72,-1.85],1.33,1.42),
  shot([-2.87,.34,-1.13],[-.79,.35,-1.13],1.66,1.43),
  shot([-4.15,.53,.16],[-.46,.48,.12],4.86,1.28),
  shot([-1.91,.41,1.98],[-.76,.36,1.39],1.43,1.55),
  shot([-1.13,2.35,2.50],[-.23,.77,1.13],2.67,1.36),
  shot([.73,3.96,-.87],[0,.79,-.51],3.87,1.76),
  shot([1.91,1.74,-3.69],[.33,.95,-1.50],3.18,1.47),
  // A long tail chase, the mirror, and a diagonal pass out of the passenger window.
  shot([.10,.38,-6.02],[0,.57,-1.02],4.56,1.58),
  shot([-5.83,1.89,-2.95],[0,.59,-.24],6.37,1.53),
  shot([-2.18,1.18,.95],[-.86,.91,.29],1.26,1.68),
  shot([-.81,1.82,4.56],[0,.91,.52],3.76,1.52),
  shot([-3.64,1.46,1.57],[-.27,.78,-.05],3.72,3.38,windscreenToSide),
  shot([-4.84,3.42,.55],[0,.62,0],5.95,1.52),
  shot([1.93,1.99,4.79],[.27,.65,1.23],4.04,1.70),
  shot([2.16,.65,.32],[.75,.56,.13],2.83,1.55),
];
function eyeOf(p){
  return new Vector3(clamp(Math.sin(p.yaw)*p.radius,-5.91-lane,4.20-lane),p.height,Math.cos(p.yaw)*p.radius);
}
function targetOf(p){return new Vector3(p.targetX,p.targetY,p.targetZ);}
function cameraKey(eye,direction,focus,field){
  return [eye.x,eye.y,eye.z,Math.atan2(direction.x,direction.z),Math.atan2(direction.y,Math.hypot(direction.x,direction.z)),
    Math.log(focus),Math.log(field/(2*focus))];
}
function exterior(eye,target,field){
  const direction=target.clone().sub(eye);
  return cameraKey(eye,direction,direction.length(),field);
}


// Integrate a quintic change of velocity around a waypoint. Outside this
// window the dolly travels at its authored speed. Widen the window for pans.
function roundedCorner(offset,window){
  if(Math.abs(offset)>=window)return 0;
  const u=(window-Math.abs(offset))/(2*window);
  return 2*window*u**4*(2.5-3*u+u*u);
}

export function createFlight(eye,forward,focus,field){
  const start=cameraKey(eye,forward,focus,field);
  const dollyWindow=1.04,panWindow=1.32,cabinSpeed=.63;
  const keys=[{at:0,pose:start},{at:panWindow,pose:start}];
  let previous={yaw:Math.atan2(eye.x,eye.z),radius:Math.hypot(eye.x,eye.z),height:eye.y,field,
    targetX:eye.x+forward.x*focus,targetY:eye.y+forward.y*focus,targetZ:eye.z+forward.z*focus};

  function addMove(dest){
    const points=[];
    if(dest.pass){
      for(const [position,look] of dest.pass){
        // A fixed lens and focus through the glass avoid a zoom pulse at the seats.
        const focus=1.52;
        points.push(cameraKey(new Vector3(...position),new Vector3(...look),focus,1.62*focus));
      }
    }else{
      const sweep=angleTo(previous.yaw,dest.yaw),steps=Math.ceil(Math.abs(sweep)/.52);
      for(let i=1;i<steps;i++){
        const t=i/steps,radius=lerp(previous.radius,dest.radius,t),yaw=previous.yaw+t*sweep;
        const eye=eyeOf({radius,yaw,height:lerp(previous.height,dest.height,t)});
        points.push(exterior(eye,targetOf(previous).lerp(targetOf(dest),t),lerp(previous.field,dest.field,t)));
      }
    }
    points.push(exterior(eyeOf(dest),targetOf(dest),dest.field));
    let last=keys.at(-1).pose,length=0,pan=0,zoom=0;
    const spans=points.map(pose=>{
      pose[3]=last[3]+angleTo(last[3],pose[3]);
      const distance=Math.hypot(pose[0]-last[0],pose[1]-last[1],pose[2]-last[2]);
      const turn=Math.hypot(pose[3]-last[3],pose[4]-last[4]);
      const lens=Math.abs(pose[6]-last[6]);
      length+=distance;pan+=turn;zoom+=lens;last=pose;
      return {pose,distance,turn,lens};
    });
    // Use one pace for the entire exterior move, including its orbit guides.
    const duration=Math.max(dest.duration,length/2.20,pan/.97,zoom/.55);
    for(const [i,{pose,distance,turn,lens}] of spans.entries()){
      let seconds=length>.0001?duration*distance/length:duration/spans.length;
      if(dest.pass){
        const throughGlass=i>0 && i<spans.length-1;
        seconds=distance/(throughGlass?cabinSpeed:1.48);
      }
      // Limit each pan and focal-length pull, including short pieces of an
      // orbit. A slow dolly should never whip the horizon at a window.
      const span=Math.max(.025,seconds,turn/(dest.pass?.72:1.02),lens/.55);
      keys.push({at:keys.at(-1).at+span,pose});
    }
    previous=dest;
  }

  // Both ends of the loop sit on the same shot with identical neighbours.
  // Precompute the whole tour so a cabin entry never triggers path generation.
  const firstExit=flightShots.findIndex(shot=>shot.pass);
  for(let i=0;i<=firstExit;i++)addMove(flightShots[i]);
  const loopStart=keys.at(-1).at;
  for(let i=1;i<=flightShots.length;i++)addMove(flightShots[(firstExit+i)%flightShots.length]);
  const loopEnd=keys.at(-1).at;
  addMove(flightShots[firstExit+1]);addMove(flightShots[firstExit+2]);
  for(let i=0;i<keys.length-1;i++){
    const a=keys[i],b=keys[i+1];
    a.velocity=a.pose.map((v,ch)=>(b.pose[ch]-v)/(b.at-a.at));
  }
  const result=new Float64Array(start.length);
  let time=0,index=0;
  return {
    sample(delta){
      time+=Math.max(0,delta)*playbackRate;
      if(time>=loopEnd){time=loopStart+(time-loopStart)%(loopEnd-loopStart);index=0;}
      while(keys[index+1].at<=time)index++;
      const key=keys[index];
      for(let ch=0;ch<result.length;ch++)result[ch]=key.pose[ch]+(time-key.at)*key.velocity[ch];
      let first=index;
      while(first>1 && time-keys[first-1].at<panWindow)first--;
      for(let k=Math.max(first,1);k<keys.length-1 && keys[k].at<time+panWindow;k++){
        const offset=time-keys[k].at,pan=roundedCorner(offset,panWindow);
        const dolly=roundedCorner(offset,dollyWindow);
        for(let ch=0;ch<result.length;ch++){
          result[ch]+=(keys[k].velocity[ch]-keys[k-1].velocity[ch])*(ch<3?dolly:pan);
        }
      }
      return result;
    },
  };
}
