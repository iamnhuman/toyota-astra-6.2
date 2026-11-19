import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { createLEDFixture } from './led-fixture.js';

export const studioLights=6;

export function createStudio(compact){
  RectAreaLightUniformsLib.init();
  const rig=new THREE.Group();rig.name='LED studio';
  const fixtures=[],sources=[],axes=[],strips=[],colours=[];
  const aluminium=new THREE.MeshStandardMaterial({name:'Studio fixture metal',vertexColors:true,metalness:.58,roughness:.38});
  // A little spill from the optics picks out the metalwork on the unlit side.
  aluminium.onBeforeCompile=shader=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n totalEmissiveRadiance += .055 * vColor.rgb;');
  };
  function bar(name,position,aim,along,length,width,tint,radiance,power,area=false){
    const mount=new THREE.Group();mount.name=name;mount.position.fromArray(position);
    const normal=new THREE.Vector3(...aim).sub(mount.position).normalize();
    const axis=new THREE.Vector3(...along).projectOnPlane(normal).normalize();
    const shortAxis=new THREE.Vector3().crossVectors(normal,axis);
    mount.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(axis,shortAxis,normal));
    const {housing,optics}=createLEDFixture(length,width,tint,radiance,aluminium);
    mount.add(housing,optics);rig.add(mount);
    const light=area?new THREE.RectAreaLight(tint,power,length,width):new THREE.SpotLight(tint,power,28,.63,.93,2);
    light.position.copy(optics.position);
    if(area)light.rotation.y=Math.PI;
    else{light.target.position.set(0,0,1);mount.add(light.target);}
    mount.add(light);
    const surface=mount.position.clone().addScaledVector(normal,optics.position.z);
    fixtures.push(surface);
    sources.push(new THREE.Vector4(surface.x,surface.y,surface.z,width*.5));
    axes.push(new THREE.Vector4(normal.x,normal.y,normal.z,.024+width*.14));
    strips.push(new THREE.Vector4(axis.x,axis.y,axis.z,length*.5));
    colours.push(new THREE.Color(tint).multiplyScalar(.085));
    return light;
  }

  bar('Warm overhead rail',[-2.65,3.56,.38],[0,.70,.18],[0,0,1],5.95,.194,0xffefd9,13,32,true);
  bar('Ice overhead rail',[2.74,2.91,-.50],[0,.72,-.22],[0,0,1],5.48,.182,0xc7e6ff,16,28.4,true);
  bar('Front blade',[-4.30,1.61,6.55],[-.12,.53,.93],[.12,1,0],2.52,.110,0xeaf3ff,11,58);
  bar('Tail blade',[-3.98,1.60,-6.60],[-.27,.59,-1.23],[-.10,1,0],2.49,.115,0xfff1dd,13,61);
  const top=bar('Overhead crossbar',[.06,4.72,2.04],[0,.35,.42],[1,0,0],3.47,.16,0xf2f6ff,13,39);
  bar('Rear rim blade',[4.18,1.66,-6.42],[.28,.69,-1.13],[.10,1,0],2.66,.112,0xd4e9ff,13,66);
  top.castShadow=true;top.shadow.mapSize.setScalar(compact?1024:2048);
  Object.assign(top.shadow.camera,{near:.35,far:19});top.shadow.bias=-.00018;top.shadow.normalBias=.009;
  const direction=new THREE.Vector3().copy(axes[0]).negate(),rimDirection=new THREE.Vector3().copy(axes[1]).negate();
  return {rig,direction,rimDirection,sources,axes,strips,colours,
    place(frame,_time,lift){
      const elevation=.80*lift;
      rig.position.copy(frame.position).addScaledVector(frame.up,elevation);
      rig.quaternion.copy(frame.rotation);rig.updateWorldMatrix(true,false);
      for(let i=0;i<fixtures.length;i++)sources[i].y=fixtures[i].y+elevation-.007;
    },
  };
}
