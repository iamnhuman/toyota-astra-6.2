import { Quaternion, Vector3 } from 'three';
import { covered, span } from './route.js';

const preload=.14,settle=.42,fullTurn=2*Math.PI;
const clamp01=n=>Math.min(1,Math.max(0,n));
const pitch=new Vector3(1,0,0),roll=new Vector3(0,0,1),yaw=new Vector3(0,1,0);
const diagonal=new Vector3(.35,0,-Math.sqrt(1-.35**2));
const tricks=[
  {name:'Сальто назад',axis:pitch,turns:-1,height:3.09,airtime:1.62},
  {name:'Левая бочка',axis:roll,turns:1,height:2.10,airtime:1.37,low:true},
  {name:'Сальто вперёд',axis:pitch,turns:1,height:2.94,airtime:1.54},
  {name:'Штопор',axis:diagonal,turns:-1,height:2.63,airtime:1.55,low:true},
  {name:'Двойное сальто назад',axis:pitch,turns:-2,height:3.60,airtime:2.06},
  {name:'Правая бочка',axis:roll,turns:-1,height:2.24,airtime:1.43,low:true},
  {name:'Сальто вперёд с винтом',axis:pitch,turns:1,twist:-1,height:3.22,airtime:1.84},
  {name:'Двойная бочка',axis:roll,turns:2,height:2.69,airtime:1.77,low:true},
  {name:'Бочка с разворотом',axis:yaw,turns:-1,twist:1,height:2.48,airtime:1.73,low:true},
];
const longestFlight=Math.max(...tricks.map(trick=>trick.airtime));
export const centreOfMass=new Vector3(0,.62,.13);
export const idleMotion=Object.freeze({name:'',axis:pitch,lift:0,verticalSpeed:0,angle:0,spin:0,
  twist:0,twistSpeed:0,spring:0,framing:0,tight:false,active:false});

function crossesGallery(distance,speed){
  const from=distance-2.7,to=distance+(speed+1.2)*(preload+longestFlight)+2.7;
  for(let bay=Math.floor(from/span);bay<=Math.floor(to/span);bay++){
    if(covered(bay) || (covered(bay-1) && bay*span+.42>=from))return true;
  }
  return false;
}

// Roll about the car's own nose after the primary turn. The emitters need
// the same pose and its angular velocity in road coordinates at emission time.
const twistRotation=new Quaternion(),nose=new Vector3();
export function orientStunt(motion,rotation,angularVelocity){
  rotation.setFromAxisAngle(motion.axis,motion.angle);
  if(angularVelocity)angularVelocity.copy(motion.axis).multiplyScalar(motion.spin);
  if(motion.twist || motion.twistSpeed){
    if(angularVelocity)angularVelocity.addScaledVector(nose.copy(roll).applyQuaternion(rotation),motion.twistSpeed);
    rotation.multiply(twistRotation.setFromAxisAngle(roll,motion.twist));
  }
  return rotation;
}

const easedTurn=t=>fullTurn*t-Math.sin(fullTurn*t);
const turnRate=t=>fullTurn*(1-Math.cos(fullTurn*t));

// Both the car and the smoke emitters sample the same trajectory. Its analytic
// velocities give released smoke a reproducible impulse at any frame rate.
function trajectory(event,time,out){
  if(!event || time<event.start){
    Object.assign(out,idleMotion);
    return out;
  }
  const age=time-event.start;
  const phase=clamp01((age-preload)/event.airtime),arc=4*phase*(1-phase);
  const airborne=age>=preload && phase<1;
  const {trick}=event;
  out.name=trick.name;out.axis=trick.axis;
  out.tight=event.tight;out.framing=arc;out.lift=arc*event.height;
  out.angle=airborne?trick.turns*easedTurn(phase):0;
  out.spin=airborne?trick.turns*turnRate(phase)/event.airtime:0;
  // The secondary roll starts after takeoff and unwinds before touchdown.
  const twistPhase=clamp01((phase-.12)/.76),twists=trick.twist??0;
  out.twist=airborne?twists*easedTurn(twistPhase):0;
  out.twistSpeed=airborne?twists*turnRate(twistPhase)/(.76*event.airtime):0;
  out.verticalSpeed=airborne?4*event.height*(1-2*phase)/event.airtime:0;
  const landing=clamp01((time-event.landing)/settle);
  if(age<preload)out.spring=-.043*Math.sin(Math.PI*age/preload)**2;
  else if(airborne)out.spring=.018*arc;
  else out.spring=-.111*Math.sin(2.6*Math.PI*landing)*Math.exp(-4.1*landing)*(1-landing);
  out.active=landing<1;
  return out;
}

export function createStunt(){
  const motion={...idleMotion},lineup=[...tricks];
  let current=null,previous=null;
  return {
    start(time,distance,speed){
      if(current && time<current.landing+settle)return false;
      // Leave tall tricks at the front of the queue until the road opens up.
      const tight=crossesGallery(distance,speed);
      const next=lineup.findIndex(trick=>!tight || trick.low);
      const [trick]=lineup.splice(next,1);lineup.push(trick);
      previous=current;
      const airtime=tight?trick.airtime*.91:trick.airtime;
      current={start:time,trick,tight,airtime,height:tight?Math.min(1.77,trick.height*.72):trick.height,
        landing:time+preload+airtime};
      trajectory(current,time,motion);
      return true;
    },
    at(time){return current?trajectory(current,time,motion):motion;},
    sample(time,out){return trajectory(current && time>=current.start?current:previous,time,out);},
    lastLanding(time){return current && time>=current.landing?current:previous;},
  };
}
