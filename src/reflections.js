import * as THREE from 'three';
import { covered, span, wrap } from './route.js';

// Correct the local cubemap against the road, wall and roof planes. Between
// captures a painted panel samples the position of its reflection in the
// gallery, rather than a highlight fixed to the car.
export function vehicleProbe(renderer, scene, vehicle, compact) {
  const target=new THREE.WebGLCubeRenderTarget(compact?128:256,{
    type:renderer.extensions.has('EXT_color_buffer_float')?THREE.HalfFloatType:THREE.UnsignedByteType,
    generateMipmaps:false, minFilter:THREE.LinearFilter,
  });
  const camera=new THREE.CubeCamera(.13,240,target);
  const origin={value:new THREE.Vector3()}, basis={value:new THREE.Matrix3()}, roof={value:0};
  const carInverse={value:new THREE.Matrix4()};
  const probeHeight={value:.94};
  for(const mat of vehicle.reflective) {
    const lacquer=mat.name==='Paint' || mat.name==='Lacquered rear aerofoil';
    mat.envMap=target.texture;
    mat.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,{probeOrigin:origin,probeBasis:basis,probeRoof:roof,probeHeight,carInverse:carInverse});
      shader.vertexShader='varying vec3 probeSurface;\n'+shader.vertexShader.replace(
        '#include <worldpos_vertex>','#include <worldpos_vertex>\nprobeSurface = (modelMatrix*vec4(transformed,1.)).xyz;',
      );
      const chunk=THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
        'envMapRotation * reflectVec, roughness','envMapRotation * localReflection(reflectVec), roughness',
      );
      shader.fragmentShader=shader.fragmentShader.replace('#include <envmap_physical_pars_fragment>',`
        varying vec3 probeSurface;
        uniform vec3 probeOrigin;
        uniform mat3 probeBasis;
        uniform float probeRoof;
        uniform float probeHeight;
        vec3 localReflection(vec3 ray) {
          vec3 worldOffset=probeSurface-probeOrigin;
          vec3 p=probeBasis*worldOffset+vec3(0.,probeHeight,0.);
          vec3 dir=probeBasis*ray;
          float t=190.;
          if(dir.y < -.006) t=min(t,-p.y/dir.y);
          if(dir.x < -.01) {
            float wall=(-8.28-p.x)/dir.x;
            float at=p.y+dir.y*wall;
            if(at>0. && at<mix(2.65,4.91,probeRoof)) t=min(t,wall);
          }
          if(probeRoof>.5 && dir.y>.01) {
            float top=(4.86-p.y)/dir.y;
            if(p.x+dir.x*top<3.87) t=min(t,top);
          }
          return normalize(worldOffset+ray*max(.16,t));
        }
        `+chunk);
      if(lacquer) {
        shader.fragmentShader='uniform mat4 carInverse;\n'+shader.fragmentShader.replace(
          '#include <color_fragment>', `#include <color_fragment>
            vec3 panelPoint=(carInverse*vec4(probeSurface,1.)).xyz;
            float lowPanel=1.-smoothstep(.14,.49,panelPoint.y);
            float roadDust=lowPanel*(.48+.25*sin(panelPoint.z*19.+panelPoint.y*8.)+.17*sin(panelPoint.z*41.));
            diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.16,.125,.098),roadDust*.135);
          `,
        ).replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=min(1.,roughnessFactor+.079*roadDust);');
      }
    };
    mat.customProgramCacheKey=()=> lacquer?'gallery-lacquer-2':'gallery-reflection-2';
    mat.needsUpdate=true;
  }
  let last=-Infinity, lastS=-Infinity;
  return function capture(s,time,frame,force=false,lift=0) {
    carInverse.value.copy(vehicle.rig.matrixWorld).invert();
    if(!force && (time-last<(compact?.245:.125) || Math.abs(s-lastS)<.65))return;
    last=time;lastS=s;
    probeHeight.value=.94+lift;
    origin.value.copy(frame.position).addScaledVector(frame.up,probeHeight.value);
    camera.position.copy(origin.value);
    basis.value.set(frame.lateral.x,frame.lateral.y,frame.lateral.z,
      frame.up.x,frame.up.y,frame.up.z,frame.forward.x,frame.forward.y,frame.forward.z);
    roof.value=Number(covered(Math.floor(wrap(s)/span)));
    const update=renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate=false;
    vehicle.root.visible=false;
    try{camera.update(renderer,scene);}
    finally{vehicle.root.visible=true;renderer.shadowMap.autoUpdate=update;}
  };
}
