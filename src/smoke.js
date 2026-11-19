import * as THREE from 'three';
import { sunDirection } from './surfaces.js';
import { createWake, puffCount, plumeMinZ, plumeMaxZ } from './wake.js';

import { turbulenceTexture } from './turbulence.js';

const domain = /* glsl */ `
  uniform vec3 plumePadding;
  vec3 plumeMin(){return vec3(-2.48,.035,${plumeMinZ})-vec3(plumePadding.x,0.,plumePadding.z);}
  vec3 plumeMax(){return vec3(2.48,3.15,${plumeMaxZ})+plumePadding;}
`;

export const smokeBounds = /* glsl */ `
  ${domain}
  vec2 plumeInterval(vec3 eyePoint, vec3 ray) {
    vec3 inv=mix(vec3(-1.),vec3(1.),greaterThanEqual(ray,vec3(0.)))/max(abs(ray),vec3(.00001));
    vec3 a=(plumeMin()-eyePoint)*inv, b=(plumeMax()-eyePoint)*inv;
    vec3 lo=min(a,b), hi=max(a,b);
    return vec2(max(0.,max(max(lo.x,lo.y),lo.z)),min(min(hi.x,hi.y),hi.z));
  }
`;

const vertex = /* glsl */ `
  out vec2 screenUV;
  void main() { screenUV=uv; gl_Position=vec4(position.xy,0.,1.); }
`;

// Each tile is one XY slice in metres relative to the car. Clamp the bilinear
// footprint to its slice, then interpolate between adjacent slices in Z.
const atlasLayout = /* glsl */ `
  uniform vec3 cells;
  uniform float columns;
  vec2 tile(float slice){return vec2(mod(slice,columns),floor(slice/columns));}
  vec3 atlasPoint(){
    vec2 block=floor(gl_FragCoord.xy/cells.xy);
    vec3 cell=vec3(mod(gl_FragCoord.xy,cells.xy),block.x+block.y*columns+.5);
    return mix(plumeMin(),plumeMax(),cell/cells);
  }
  vec4 sampleField(sampler2D field,vec3 p){
    vec3 coord=(p-plumeMin())/(plumeMax()-plumeMin());
    if(any(lessThan(coord,vec3(0.))) || any(greaterThan(coord,vec3(1.))))return vec4(0.);
    vec3 grid=clamp(coord*cells-.5,vec3(0.),cells-1.);
    float z=floor(grid.z);
    vec2 within=(grid.xy+.5)/cells.xy, tiles=vec2(columns,ceil(cells.z/columns));
    vec4 a=texture(field,(tile(z)+within)/tiles);
    vec4 b=texture(field,(tile(min(z+1.,cells.z-1.))+within)/tiles);
    return mix(a,b,fract(grid.z));
  }
`;

// A slice lists only the puffs that can occupy it. The splats are volumes of
// positive extinction; the grey contours come from light passing through soot.
const densityFragment = /* glsl */ `
  ${domain}
  ${atlasLayout}
  uniform highp sampler3D turbulence;
  uniform sampler2D sliceList;
  uniform vec4 centres[${puffCount}], shapes[${puffCount}];
  uniform vec3 impact;
  uniform float seconds,drift;
  out vec4 field;

  void main(){
    field=vec4(0.);
    int slice=int(floor(gl_FragCoord.x/cells.x)+columns*floor(gl_FragCoord.y/cells.y));
    if(slice>=int(cells.z))return;
    vec3 p=atlasPoint();
    bool landing=impact.y>.001 && p.y<.70;
    if(texelFetch(sliceList,ivec2(0,slice),0).r==0. && !landing)return;
    vec3 flow=p*vec3(.43,.50,.36)+vec3(.023*seconds,-.13*seconds,drift);
    vec3 twist=texture(turbulence,flow).gbr-.5;
    vec4 eddy=texture(turbulence,flow*2.16+1.53*twist+vec3(.45,.21,.66));
    vec3 warp=clamp(.92*twist+.34*(eddy.brg-.5),vec3(-.24),vec3(.24));
    vec3 q=p+warp;
    float mass=0.;
    for(int group=0;group<${Math.ceil(puffCount/4)};group++){
      ivec4 ids=ivec4(texelFetch(sliceList,ivec2(group,slice),0)*255.+.5);
      for(int lane=0;lane<4;lane++){
        int id=ids[lane]-1;
        if(id<0)break;
        vec4 source=centres[id],shape=shapes[id];
        vec3 d=(q-source.xyz)*shape.xyz;
        float rr=dot(d,d);
        if(rr>1.98)continue;
        // Winding weakens away from the core. Two offset lobes shear and separate.
        float a=source.w+2.12/(1.+2.7*rr);
        vec2 roll=mat2(cos(a),sin(a),-sin(a),cos(a))*d.xy;
        vec3 eddyA=vec3((roll-vec2(.24,.12))*vec2(.98,1.22),d.z+.10);
        vec3 eddyB=vec3((roll+vec2(.35,.24))*vec2(1.21,1.43),d.z-.17);
        float lobes=max(1.-dot(eddyA,eddyA),.84-.86*dot(eddyB,eddyB));
        mass+=shape.w*smoothstep(-.17,.91,lobes);
      }
      if(ids.w==0)break;
    }
    if(mass<.001 && !landing)return;
    float grains=texture(turbulence,flow*4.61+eddy.gbr*1.12).r;
    float fold=1.-smoothstep(.028,.24,abs(eddy.r+.50*twist.y+.24*(grains-.5)-.51));
    float aeration=smoothstep(.26,.67,eddy.g+.65*twist.x+.31*(grains-.5));
    float soot=mass*(.12+.85*aeration+.41*fold);
    if(landing){
      vec2 tyre=vec2(abs(p.x)-.79,min(abs(p.z+impact.z+1.13),abs(p.z+impact.z-1.39))*.84);
      float r=length(tyre)+.30*twist.y;
      float ring=1.-smoothstep(.05,.39,abs(r-(.15+1.27*impact.x)));
      float low=1.-smoothstep(.035,.31,abs(p.y-.13-.13*impact.x));
      soot+=.68*impact.y*ring*low*(.32+.68*aeration);
    }
    vec3 edge=plumeMax()-p;
    soot*=smoothstep(.035,.13,p.y)*smoothstep(plumeMin().z,plumeMin().z+.48,p.z)*
          smoothstep(0.,.25,min(min(edge.x,p.x-plumeMin().x),min(edge.y,edge.z)));
    field=vec4(1.-exp(-1.24*soot),0.,0.,1.);
  }
`;

const lightFragment = /* glsl */ `
  ${domain}
  ${atlasLayout}
  uniform sampler2D densityMap;
  uniform vec3 sunlight,rimLight;
  uniform bool fineSmoke;
  out vec4 illumination;
  void main(){
    float density=texelFetch(densityMap,ivec2(gl_FragCoord.xy),0).r;
    illumination=vec4(0.);
    if(density<.002)return;
    vec3 p=atlasPoint();
    float key=.06*density,back=.08*density;
    int count=fineSmoke?6:4;
    float prev=0.;
    for(int i=1;i<=6;i++){
      if(i>count)break;
      float t=float(i)/float(count),next=1.76*t*t,mid=.5*(prev+next);
      key+=(next-prev)*sampleField(densityMap,p+sunlight*mid).r;
      if(fineSmoke)back+=(next-prev)*sampleField(densityMap,p+rimLight*mid).r;
      prev=next;
    }
    float sky=.39*sampleField(densityMap,p+vec3(0.,.25,0.)).r+.52*sampleField(densityMap,p+vec3(0.,.63,0.)).r;
    illumination=density*vec4(1.,exp(-5.1*key),fineSmoke?exp(-4.8*back):0.,exp(-4.5*sky));
  }
`;

const volumeFragment = /* glsl */ `
  in vec2 screenUV;
  out vec4 soot;
  uniform sampler2D sceneDepth,litMap;
  uniform highp sampler3D turbulence;
  uniform mat4 localFromClip;
  uniform vec3 eye,sunlight;
  uniform float seconds,drift,daylight,stepLength,stepLimit;
  uniform bool fineSmoke;
  ${smokeBounds}
  ${atlasLayout}
  void main(){
    float depth=texture(sceneDepth,screenUV).r;
    vec4 h=localFromClip*vec4(screenUV*2.-1.,depth*2.-1.,1.);
    vec3 delta=h.xyz/h.w-eye;
    float distance=length(delta);
    vec3 ray=delta/max(distance,.00001);
    vec2 span=plumeInterval(eye,ray);
    float lengthInSmoke=min(span.y,distance)-span.x;
    soot=vec4(0.);
    if(lengthInSmoke<=0.)return;
    int steps=int(clamp(ceil(lengthInSmoke/stepLength),3.,stepLimit));
    float ds=lengthInSmoke/float(steps);
    vec3 advance=ray*ds,p=eye+ray*(span.x+.5*ds);
    float transmission=1.,radiance=0.,phase=.76+.24*pow(max(0.,dot(ray,sunlight)),2.);
    for(int i=0;i<92;i++,p+=advance){
      if(i>=steps)break;
      vec4 lit=sampleField(litMap,p);
      if(lit.r<.003)continue;
      vec3 uvw=p*vec3(1.09,1.29,.91)+vec3(.035*seconds,-.24*seconds,2.38*drift);
      vec3 fray=texture(turbulence,uvw).rgb;
      float fibre=fray.g+.53*(fray.r-.5);
      if(fineSmoke)fibre+=.38*(texture(turbulence,uvw*2.67+.95*fray.brg).g-.5);
      float density=lit.r*smoothstep(.16,.68,fibre)*(1.36-.36*lit.r);
      float intercepted=1.-exp(-6.3*density*ds);
      vec3 light=clamp(lit.gba/lit.r,0.,1.);
      float scatter=.003+.030*light.z+.31*light.x*light.x*phase+.12*light.y*light.y;
      scatter*=daylight*(1.-.68*smoothstep(.10,.76,density));
      radiance+=transmission*intercepted*scatter;
      transmission*=1.-intercepted;
      if(transmission<.012)break;
    }
    soot=vec4(vec3(radiance),1.-transmission);
  }
`;

export function createSmoke(depth,compact,colourBuffer){
  const target=new THREE.WebGLRenderTarget(1,1,{...colourBuffer,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  const atlas=()=>new THREE.WebGLRenderTarget(1,1,{depthBuffer:false,type:THREE.UnsignedByteType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
  const density=atlas(),lit=atlas(),size=new THREE.Vector2(1,1),wake=createWake();
  const listWidth=Math.ceil(puffCount/4);
  const uniforms={
    sceneDepth:{value:depth},turbulence:{value:turbulenceTexture()},densityMap:{value:density.texture},litMap:{value:lit.texture},
    localFromClip:{value:new THREE.Matrix4()},eye:{value:new THREE.Vector3()},sunlight:{value:new THREE.Vector3()},rimLight:{value:new THREE.Vector3()},
    cells:{value:new THREE.Vector3()},columns:{value:1},fineSmoke:{value:false},stepLength:{value:.1},stepLimit:{value:42},
    seconds:{value:0},drift:{value:0},daylight:{value:1},plumePadding:{value:wake.padding},
    centres:{value:wake.centres},shapes:{value:wake.shapes},impact:{value:wake.impact},sliceList:{value:null},
  };
  const pass=fragmentShader=>new THREE.ShaderMaterial({
    glslVersion:THREE.GLSL3,uniforms,vertexShader:vertex,fragmentShader,depthTest:false,depthWrite:false,
    blending:THREE.NoBlending,toneMapped:false,
  });
  const makeDensity=pass(densityFragment),lightVolume=pass(lightFragment),material=pass(volumeFragment);
  const key=new THREE.Vector3(),back=new THREE.Vector3();
  let dirty=true,relight=true;
  function setHD(enabled){
    const grid=uniforms.cells.value;
    if(grid.x && enabled===uniforms.fineSmoke.value)return;
    if(compact)grid.set(...(enabled?[64,38,112]:[48,28,72]));
    else grid.set(...(enabled?[88,48,144]:[64,36,96]));
    const columns=Math.ceil(Math.sqrt(grid.z));
    uniforms.columns.value=columns;uniforms.fineSmoke.value=enabled;
    uniforms.stepLength.value=enabled?.064:.096;
    uniforms.stepLimit.value=enabled?(compact?66:88):(compact?40:60);
    density.setSize(grid.x*columns,grid.y*Math.ceil(grid.z/columns));lit.setSize(density.width,density.height);
    uniforms.sliceList.value?.dispose();
    uniforms.sliceList.value=new THREE.DataTexture(new Uint8Array(4*listWidth*grid.z),listWidth,grid.z);
    dirty=true;
  }
  setHD(false);
  return {
    target,material,size,setHD,
    resize(w,h){
      const hd=uniforms.fineSmoke.value;
      const scale=hd?(compact?.64:.76):(compact?.40:.52);
      const budget=hd?(compact?365000:950000):(compact?190000:540000);
      const ratio=Math.min(scale,Math.sqrt(budget/(w*h)));
      size.set(Math.max(2,Math.ceil(w*ratio)),Math.max(2,Math.ceil(h*ratio)));
      target.setSize(size.x,size.y);
    },
    update(camera,inverseRoad,inverseVP,time,distance,daylight,stunt,speed,studio){
      const drift=distance*.044;
      dirty ||= uniforms.seconds.value!==time || uniforms.drift.value!==drift;
      if(dirty){
        wake.update(stunt,time,speed??19.2);wake.fillSlices(uniforms.sliceList.value);
      }
      uniforms.localFromClip.value.multiplyMatrices(inverseRoad,inverseVP);
      uniforms.eye.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inverseRoad);
      if(studio){key.copy(studio.direction);back.copy(studio.rimDirection);}
      else {key.copy(sunDirection).transformDirection(inverseRoad);back.set(-key.x,.46,-key.z).normalize();}
      relight ||= !key.equals(uniforms.sunlight.value) || !back.equals(uniforms.rimLight.value);
      uniforms.sunlight.value.copy(key);uniforms.rimLight.value.copy(back);
      uniforms.seconds.value=time;uniforms.drift.value=drift;uniforms.daylight.value=daylight;
    },
    render(draw){
      if(dirty)draw(makeDensity,density);
      if(dirty || relight)draw(lightVolume,lit);
      dirty=relight=false;draw(material,target);
    },
  };
}
