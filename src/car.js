import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createDriver } from './driver.js';
import { createExhaust } from './exhaust.js';
import { makeCarDetail } from './car-detail.js';
import { installTrunkAudio } from './trunk.js';
import { frameForCar, frameAt } from './route.js';
import { centreOfMass, idleMotion, orientStunt } from './stunt.js';

const wheelCodes = ['FL','FR','RL','RR'];
const tau = Math.PI * 2;

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

function addRearWing(body,paint) {
  function add(geometry,material) {
    const o=new THREE.Mesh(geometry,material);o.castShadow=o.receiveShadow=true;body.add(o);return o;
  }
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
    const tip=add(new THREE.SphereGeometry(1,28,18),finish);
    tip.position.set(sign*.738,1.175,-1.750);tip.scale.set(.008,.032,.095);
  }
}

function contactPatch(rig) {
  const material=new THREE.MeshBasicMaterial({color:new THREE.Color().setScalar(14/255),
    transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2});
  // Evaluate coverage at the displayed resolution. Premultiplying this dark
  // tint in an 8-bit canvas had left only a handful of levels over black.
  material.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec2 groundPoint;\n'+shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n groundPoint=vec2(position.x,-position.y);');
    shader.fragmentShader='varying vec2 groundPoint;\n'+shader.fragmentShader.replace('#include <alphamap_fragment>',`
      vec2 p=vec2(abs(groundPoint.x),groundPoint.y);
      vec2 chassis=(p-vec2(0.,.04))/vec2(.85,1.89);
      chassis*=chassis;
      float body=.43*exp(-dot(chassis,chassis));
      vec2 front=(p-vec2(.771,1.393))/vec2(.172,.249);
      vec2 rear=(p-vec2(.792,-1.134))/vec2(.172,.249);
      float wheels=.78*(exp(-dot(front,front))+exp(-dot(rear,rear)));
      vec2 edge=1.-smoothstep(vec2(1.24,2.34),vec2(1.38,2.59),abs(p));
      diffuseColor.a*=(body+(1.-body)*wheels)*edge.x*edge.y;
    `);
  };
  const ao=new THREE.Mesh(new THREE.PlaneGeometry(2.76,5.18),material);
  ao.name='Tyre contact shadow';
  ao.rotation.x=-Math.PI/2;ao.position.y=.012;ao.renderOrder=2;rig.add(ao);
  return ao;
}

function intercoolerFins(body) {
  const core=body.getObjectByName('GRILLE7_Grille7A002_0');
  body.updateWorldMatrix(true,true);
  const toBody=new THREE.Matrix4().copy(body.matrixWorld).invert().multiply(core.matrixWorld);
  const vertices=core.geometry.getAttribute('position'),bounds=new THREE.Box3(),p=new THREE.Vector3();
  for(let i=0;i<vertices.count;i++)bounds.expandByPoint(p.fromBufferAttribute(vertices,i).applyMatrix4(toBody));
  const {min,max}=bounds;
  const face=(x,y,offset)=>[x,y,min.z+(y-min.y)*(max.z-min.z)/(max.y-min.y)+offset];
  const pos=[],indices=[];
  function strip(a,b,c,d){
    const i=pos.length/3;pos.push(...a,...b,...c,...d);indices.push(i,i+1,i+2,i,i+2,i+3);
  }
  const rows=12,folds=154;
  for(let row=0;row<rows;row++){
    const y0=THREE.MathUtils.lerp(min.y,max.y,row/rows);
    const y1=THREE.MathUtils.lerp(min.y,max.y,(row+1)/rows);
    strip(face(min.x,y0,.0055),face(max.x,y0,.0055),face(max.x,y0+.0017,.0055),face(min.x,y0+.0017,.0055));
    for(let fold=0;fold<folds;fold++){
      const a=THREE.MathUtils.lerp(min.x,max.x,fold/folds),b=THREE.MathUtils.lerp(min.x,max.x,(fold+1)/folds);
      const low=y0+.0017,ya=fold%2?y1:low,yb=fold%2?low:y1;
      strip(face(a,ya,.001),face(b,yb,.001),face(b,yb,.0043),face(a,ya,.0043));
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  const material=new THREE.MeshStandardMaterial({color:0x89918f,metalness:.78,roughness:.45,side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(geometry,material);
  mesh.name='Folded aluminium intercooler fins';mesh.receiveShadow=true;body.add(mesh);
  return mesh;
}

export async function loadSupra(manager) {
  const gltf=await new GLTFLoader(manager).loadAsync('/car/supra-a80.glb');
  const rig=gltf.scene, body=rig.getObjectByName('SprungMass');
  let paint;
  body.traverse(o=>{if(o.isMesh && o.material.name==='Paint')paint=o.material;});
  addRearWing(body,paint);
  installTrunkAudio(body);
  // The driver's frameless window is fully lowered under the resting elbow.
  body.getObjectByName('DoorLGlass_GlassMtl002_0').visible=false;
  // These panes are crossed by the camera. Refraction should sample
  // the cabin, but the lens's depth/velocity pass needs the seats behind it.
  const windowMeshes=['DoorRGlass_GlassMtl002_0','GLASSS_GlassMtl002_0','TrunkGlass_GlassMtl002_0'];
  const glazing=body.getObjectByName(windowMeshes[0]).material.clone();
  glazing.name='Cabin glazing';glazing.transparent=true;glazing.forceSinglePass=true;glazing.depthWrite=false;
  glazing.envMapIntensity=1.09;
  for(const name of windowMeshes)body.getObjectByName(name).material=glazing;
  const reflective=new Set();
  rig.traverse(o=>{
    if(!o.isMesh)return;
    o.receiveShadow=true;
    o.castShadow=!(o.material.transparent || o.material.transmission>0);
    if(o.material.transmission>0 || o.material.clearcoat>0 || o.material.metalness>.36) reflective.add(o.material);
    if(o.material.name==='GlassMtl.002')o.material.envMapIntensity=1.09;
    if(o.material.name==='InteriorA')o.material.envMapIntensity=.47;
  });
  const driver=createDriver(body),exhaust=createExhaust(body);
  const root=new THREE.Group();
  root.add(rig);
  const shadow=contactPatch(root);
  const wheels=wheelCodes.map(code=>({code,hub:rig.getObjectByName('Hub'+code),spin:rig.getObjectByName('Spin'+code)}));
  const radius=wheels[0].hub.userData.radius;
  const baseHeight=body.position.y;
  const a=new THREE.Vector3(),b=new THREE.Vector3();
  let detail,hd=false;
  return {
    root, rig, body, radius, reflective,
    setHD(enabled) {
      hd=enabled;driver.setHD(hd);exhaust.setHD(hd);
      if(enabled && !detail){
        detail=makeCarDetail(body,wheels);
        detail.parts.push(intercoolerFins(body));
      }
      if(detail)for(const part of detail.parts)part.visible=enabled;
    },
    pose(s, time, speed, acceleration, motion=idleMotion) {
      const road=frameForCar(s,time);
      root.position.copy(road.position).addScaledVector(road.up,.007);
      root.quaternion.copy(road.rotation);
      orientStunt(motion,rig.quaternion);
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
      driver.update(time);exhaust.update(time);
      if(hd)detail.update(speed,acceleration);
      root.updateMatrixWorld(true);
      return road;
    },
  };
}
