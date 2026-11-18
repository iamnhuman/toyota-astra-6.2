import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { frameForCar, frameAt } from './route.js';
import { idleMotion } from './stunt.js';

const wheelCodes = ['FL','FR','RL','RR'];
const tau = Math.PI * 2;
const yAxis = new THREE.Vector3(0, 1, 0);
const flipAxis = new THREE.Vector3(1,0,0);
const galleryAxis = new THREE.Vector3(.35,0,-Math.sqrt(1-.35**2));
const centreOfMass = new THREE.Vector3(0,.62,.13);

function skin(uCount, vCount, point) {
  const p = [], idx = [];
  for (let j = 0; j <= vCount; j++) {
    for (let i = 0; i <= uCount; i++) {
      p.push(...point(i / uCount, j / vCount));
      if (i === uCount || j === vCount) continue;
      const a = j * (uCount+1) + i, b = a + uCount + 1;
      idx.push(a,b,a+1,b,b+1,a+1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p,3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export function finishCabin(body, paint) {
  const cloth = new THREE.MeshStandardMaterial({ name:'Charcoal driving suit', color:0x302f31, roughness:.94 });
  const trim = new THREE.MeshStandardMaterial({ name:'Cabin stitching', color:0x57514b, roughness:.86 });
  const leather = new THREE.MeshStandardMaterial({ name:'Driving gloves', color:0x2d2826, roughness:.75 });
  const shell = new THREE.MeshPhysicalMaterial({ name:'Helmet shell', color:0xb9b7af, metalness:.18, roughness:.34, clearcoat:.6 });
  const visor = new THREE.MeshPhysicalMaterial({ name:'Visor', color:0x262d30, metalness:.48, roughness:.095, clearcoat:1, side:THREE.DoubleSide });
  function add(geometry,material) {
    const o=new THREE.Mesh(geometry,material);o.castShadow=o.receiveShadow=true;body.add(o);return o;
  }
  function oval(pos,scale,material) {
    const o=add(new THREE.SphereGeometry(1,28,18),material);o.position.set(...pos);o.scale.set(...scale);return o;
  }
  function arm(a,b,r,material) {
    const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),dir=end.clone().sub(start);
    const o=add(new THREE.CapsuleGeometry(r,Math.max(.016,dir.length()-r),5,14),material);
    o.position.copy(start).lerp(end,.5);o.quaternion.setFromUnitVectors(yAxis,dir.normalize());
  }
  oval([.347,.737,-.19],[.209,.23,.119],cloth);
  oval([.347,1.022,-.177],[.125,.141,.137],shell);
  const face=skin(35,9,(u,v)=>{
    const a=(u-.5)*2.68,b=-.27+v*.65-.09*(2*u-1)**2;
    return [.347+.127*Math.sin(a)*Math.cos(b),1.022+.143*Math.sin(b),-.177+.14*Math.cos(a)*Math.cos(b)];
  });
  add(face,visor);
  for(const side of [-1,1]) {
    const shoulder=[.347+side*.155,.84,-.162];
    const elbow=[.347+side*.186,.659,.032];
    const palm=[.347+side*.138,.803,.213];
    arm(shoulder,elbow,.066,cloth);arm(elbow,palm,.046,cloth);
    oval(palm,[.044,.043,.041],leather);
  }
  const belt=add(new RoundedBoxGeometry(.041,.36,.014,1,.004),trim);
  belt.position.set(.37,.755,-.074);belt.rotation.z=-.59;

  // The A80's high rear aerofoil. Its two swept uprights meet a closed,
  // tapered section, so its silhouette and reflections hold at grazing angles.
  const finish=paint.clone();
  finish.side=THREE.DoubleSide;
  finish.clearcoatRoughnessMap=null;
  finish.name='Lacquered rear aerofoil';
  const blade=skin(52,24,(u,v)=>{
    const x=(u-.5)*1.48,a=v*tau,tip=Math.abs(2*u-1);
    const taper = 1-.25*tip**4;
    return [x,1.176+.031*(1-tip*tip)+.033*Math.sin(a)*taper +.014*Math.cos(a),
      -1.815+.123*Math.cos(a)*taper+.065*tip**2];
  });
  add(blade,finish);
  for(const sign of [-1,1]) {
    const support=skin(24,15,(u,v)=>{
      const a=u*tau;
      return [sign*(.593+.105*v)+(.046+.016*(1-v)**2)*Math.cos(a),
        .875+.309*v, -1.621-.143*v + (.135-.032*v)*Math.sin(a)];
    });
    add(support,finish);
    oval([sign*.738,1.175,-1.750],[.008,.032,.095],finish);
  }
}

function contactPatch(rig) {
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=512;
  const ctx=canvas.getContext('2d'), image=ctx.createImageData(256,512);
  const supports=[[-.771,1.393],[.771,1.393],[-.792,-1.134],[.792,-1.134]];
  for(let row=0;row<512;row++)for(let col=0;col<256;col++){
    const x=(col/255-.5)*2.76,z=(row/511-.5)*5.18;
    let opacity=.43*Math.exp(-((x/.85)**4+((z-.04)/1.89)**4));
    for(const [wx,wz] of supports) {
      const d=((x-wx)/.172)**2+((z-wz)/.249)**2;
      opacity=1-(1-opacity)*(1-.78*Math.exp(-d));
    }
    const i=(row*256+col)*4;
    image.data[i]=image.data[i+1]=image.data[i+2]=14;image.data[i+3]=Math.round(255*opacity);
  }
  ctx.putImageData(image,0,0);
  const ao=new THREE.Mesh(new THREE.PlaneGeometry(2.76,5.18),
    new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(canvas),transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}));
  ao.rotation.x=-Math.PI/2;ao.position.y=.012;ao.renderOrder=2;rig.add(ao);
  return ao;
}

export async function loadSupra(manager) {
  const gltf=await new GLTFLoader(manager).loadAsync('/car/supra-a80.glb');
  const rig=gltf.scene, body=rig.getObjectByName('SprungMass');
  let paint;
  body.traverse(o=>{if(o.isMesh && o.material.name==='Paint')paint=o.material;});
  finishCabin(body,paint);
  const reflective=new Set();
  rig.traverse(o=>{
    if(!o.isMesh)return;
    o.receiveShadow=true;
    o.castShadow=!(o.material.transparent || o.material.transmission>0);
    if(o.material.transmission>0 || o.material.clearcoat>0 || o.material.metalness>.36) reflective.add(o.material);
    if(o.material.name==='GlassMtl.002')o.material.envMapIntensity=1.09;
    if(o.material.name==='InteriorA')o.material.envMapIntensity=.47;
  });
  const root=new THREE.Group();
  root.add(rig);
  const shadow=contactPatch(root);
  const wheels=wheelCodes.map(code=>({code,hub:rig.getObjectByName('Hub'+code),spin:rig.getObjectByName('Spin'+code)}));
  const radius=wheels[0].hub.userData.radius;
  const baseHeight=body.position.y;
  const a=new THREE.Vector3(),b=new THREE.Vector3();
  return {
    root, rig, radius, reflective,
    pose(s, time, speed, acceleration, motion=idleMotion) {
      const road=frameForCar(s,time);
      root.position.copy(road.position).addScaledVector(road.up,.007);
      root.quaternion.copy(road.rotation);
      rig.quaternion.setFromAxisAngle(motion.tight ? galleryAxis : flipAxis,motion.angle);
      rig.position.copy(centreOfMass).applyQuaternion(rig.quaternion).negate().add(centreOfMass);
      rig.position.y+=motion.lift;
      shadow.material.opacity=Math.exp(-2.1*motion.lift);
      shadow.scale.setScalar(1+.16*motion.lift);
      a.copy(frameAt(s-1.5).forward);b.copy(frameAt(s+1.5).forward);
      const curvature=Math.atan2(a.z*b.x-a.x*b.z,a.dot(b))/3;
      const vibration=.0024*Math.sin(s*.83)+.0011*Math.sin(s*2.17);
      body.position.y=baseHeight+vibration+motion.spring;
      body.rotation.x=-.0024*acceleration+.0018*Math.sin(s*.82);
      body.rotation.z=THREE.MathUtils.clamp(curvature*speed*speed*.013,-.03,.03)+.0015*Math.sin(s*.59);
      for(const {code,hub,spin} of wheels) {
        hub.rotation.y=code[0]==='F'?Math.atan2(2.53*curvature,1-hub.position.x*curvature):0;
        spin.rotation.x=(s/radius)%tau;
      }
      root.updateMatrixWorld(true);
      return road;
    },
  };
}
