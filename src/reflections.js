import * as THREE from 'three';
import { covered, span, wrap } from './route.js';

// Correct the local cubemap against the road, wall and roof planes. Between
// captures a painted panel samples the position of its reflection in the
// gallery, rather than a highlight fixed to the car.
export function vehicleProbe(renderer, scene, vehicle, compact) {
  const baseSize=compact?128:256;
  const makeTarget=size=>new THREE.WebGLCubeRenderTarget(size,{
    type:renderer.extensions.has('EXT_color_buffer_float')?THREE.HalfFloatType:THREE.UnsignedByteType,
    generateMipmaps:false, minFilter:THREE.LinearFilter,
  });
  const camera=new THREE.CubeCamera(.13,240,makeTarget(baseSize));
  const filter=new THREE.PMREMGenerator(renderer);
  let requestedSize=baseSize,filtered;
  const hdPaint={value:false};
  const origin={value:new THREE.Vector3()}, basis={value:new THREE.Matrix3()}, roof={value:0};
  const carInverse={value:new THREE.Matrix4()};
  const probeHeight={value:.94};
  for(const mat of vehicle.reflective) {
    const lacquer=mat.name==='Paint' || mat.name==='Lacquered rear aerofoil';
    const glazing=mat.name==='Cabin glazing';
    mat.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,{probeOrigin:origin,probeBasis:basis,probeRoof:roof,probeHeight,studioProbe:hdPaint,carInverse});
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
        uniform bool studioProbe;
        vec3 localReflection(vec3 ray) {
          vec3 worldOffset=probeSurface-probeOrigin;
          if(studioProbe)return normalize(ray*5.2+worldOffset);
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
        shader.uniforms.hdPaint=hdPaint;
        shader.fragmentShader='uniform mat4 carInverse;\nuniform bool hdPaint;\n'+shader.fragmentShader.replace(
          '#include <color_fragment>', `#include <color_fragment>
            vec3 panelPoint=(carInverse*vec4(probeSurface,1.)).xyz;
            float lowPanel=1.-smoothstep(.14,.49,panelPoint.y);
            float roadDust=lowPanel*(.48+.25*sin(panelPoint.z*19.+panelPoint.y*8.)+.17*sin(panelPoint.z*41.));
            diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.16,.125,.098),roadDust*.135);
          `,
        ).replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=min(1.,roughnessFactor+.079*roadDust);')
        .replace('#include <clearcoat_normal_fragment_maps>',`#include <clearcoat_normal_fragment_maps>
          #ifdef USE_CLEARCOAT
          if(hdPaint){
            // Band-limit the fine orange peel so highlights stay continuous in motion.
            vec3 angles=panelPoint*vec3(483.,576.,391.)+panelPoint.yzx*vec3(167.,149.,212.);
            vec3 resolved=1.-smoothstep(vec3(.55),vec3(2.85),fwidth(angles));
            vec3 slope=.0065*resolved*sin(angles+.72*sin(panelPoint.zxy*89.));
            slope=mat3(viewMatrix)*transpose(mat3(carInverse))*slope;
            clearcoatNormal=normalize(clearcoatNormal+slope-clearcoatNormal*dot(clearcoatNormal,slope));
          }
          #endif`);
      }
      if(glazing){
        // Remove the pane's refracted image continuously as the lens enters
        // the glass. At the near plane the full-resolution cabin is already visible.
        shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',
          '#include <opaque_fragment>\n gl_FragColor.a*=smoothstep(.055,.34,length(vViewPosition));');
      }
    };
    mat.customProgramCacheKey=()=>glazing?'cabin-glazing':lacquer?'gallery-lacquer-2':'gallery-reflection-2';
    mat.needsUpdate=true;
  }
  let last=-Infinity, lastS=-Infinity;
  function capture(s,time,frame,force=false,lift=0,hold=false) {
    carInverse.value.copy(vehicle.rig.matrixWorld).invert();
    const holdCapture=hold && Number.isFinite(last) && !force;
    if(!holdCapture && !force && (time-last<(compact?.245:.125) || Math.abs(s-lastS)<.65))return;
    // During a cabin pass, project the last exterior capture in the moving
    // car's frame. Changing quality still takes a fresh map immediately.
    probeHeight.value=.94+lift;
    origin.value.copy(frame.position).addScaledVector(frame.up,probeHeight.value);
    basis.value.set(frame.lateral.x,frame.lateral.y,frame.lateral.z,
      frame.up.x,frame.up.y,frame.up.z,frame.forward.x,frame.forward.y,frame.forward.z);
    if(holdCapture)return;
    if(camera.renderTarget.width!==requestedSize){
      camera.renderTarget.dispose();
      camera.renderTarget=makeTarget(requestedSize);
      filtered?.dispose();filtered=undefined;
    }
    last=time;lastS=s;
    camera.position.copy(origin.value);
    roof.value=Number(covered(Math.floor(wrap(s)/span)));
    const update=renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate=false;
    vehicle.root.visible=false;
    try{
      camera.update(renderer,scene);
      const newMap=!filtered;
      filtered=filter.fromCubemap(camera.renderTarget.texture,filtered);
      if(newMap){
        for(const mat of vehicle.reflective){mat.envMap=filtered.texture;mat.needsUpdate=true;}
      }
      if(hdPaint.value)scene.environment=filtered.texture;
    }
    finally{vehicle.root.visible=true;renderer.shadowMap.autoUpdate=update;}
  }
  capture.setHD=enabled=>{
    requestedSize=Math.min(baseSize*(enabled?2:1),renderer.capabilities.maxCubemapSize);
    hdPaint.value=enabled;
    camera.layers.set(enabled?1:0);
    last=lastS=-Infinity;
  };
  return capture;
}
