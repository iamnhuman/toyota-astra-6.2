import * as THREE from 'three';
import { turbulenceTexture } from './turbulence.js';

// Tailpipe coordinates: +Z follows the bore out through the slash-cut tip.
const boundsMin=new THREE.Vector3(-.112,-.080,-.020);
const boundsMax=new THREE.Vector3(.112,.155,.54);
const fragmentShader=`
  uniform highp sampler3D noiseField;
  uniform vec3 eye,boundsMin,boundsMax;
  uniform mat4 clipFromPipe;
  uniform float phase,reach,strength;
  uniform int samples;
  in vec3 surface;
  out vec4 flame;

  vec4 gas(vec3 p){
    float u=(p.z+.009)/reach;
    if(u<=0. || u>=1.)return vec4(0.);
    vec3 flow=vec3(p.x*5.6,p.y*6.1,p.z*3.2-phase*1.9);
    vec3 eddy=texture(noiseField,flow).rgb-.5;
    float fine=texture(noiseField,flow*2.65+eddy).a-.5;
    float wave=sin(phase*15.-u*9.);
    vec2 bend=vec2(.018*wave*u,.044*u*u)+(.012+.077*u)*eddy.xy;
    vec2 q=p.xy-bend;
    float width=.039*(1.-u)+.020*sin(3.14159*u)+.005;
    float radius=length(q)/width;
    float core=1.-smoothstep(.32,1.03,radius+u*(1.05*eddy.z+.43*fine));
    vec2 curl=q-vec2(-.025,.019)*u*(.65+.35*wave);
    float tongue=(1.-smoothstep(.25,1.,length(curl)/(width*.60)))*smoothstep(.31,.60,u);
    float gasDensity=max(core,tongue)*(1.-smoothstep(.73+.14*eddy.y,1.,u))*smoothstep(0.,.044,u);
    float heat=clamp(.98-.55*u-.42*radius+.42*eddy.y+.20*fine,0.,1.);
    vec3 amber=mix(vec3(2.45,.19,.008),vec3(6.1,2.35,.24),smoothstep(.12,.89,heat));
    vec3 blue=mix(vec3(.35,.61,2.15),vec3(2.6,2.8,3.4),heat);
    return vec4(mix(blue,amber,smoothstep(.05,.23,u)),gasDensity);
  }

  void main(){
    vec3 ray=normalize(surface-eye);
    vec3 inv=mix(vec3(-1.),vec3(1.),greaterThanEqual(ray,vec3(0.)))/max(abs(ray),vec3(1e-7));
    vec3 a=(boundsMin-eye)*inv,b=(boundsMax-eye)*inv;
    vec3 lo=min(a,b),hi=max(a,b);
    float start=max(0.,max(lo.x,max(lo.y,lo.z))),end=min(hi.x,min(hi.y,hi.z));
    if(end<=start)discard;
    float ds=(end-start)/float(samples),t=start+.5*ds,transmit=1.,first=-1.;
    vec3 emission=vec3(0.);
    for(int i=0;i<samples;i++,t+=ds){
      vec4 flamelet=gas(eye+ray*t);
      if(flamelet.a<.004)continue;
      if(first<0.)first=t;
      float alpha=1.-exp(-flamelet.a*51.*strength*ds);
      emission+=transmit*alpha*flamelet.rgb;transmit*=1.-alpha;
    }
    if(first<0.)discard;
    // Test the first burning gas against the bumper, rather than testing the
    // back of the bounding box and clipping the flame at the metal lip.
    vec4 clip=clipFromPipe*vec4(eye+first*ray,1.);
    gl_FragDepth=clamp(.5+.5*clip.z/max(.00001,clip.w),0.,1.);
    flame=vec4(emission,1.-transmit);
  }`;

const burstNoise=n=>THREE.MathUtils.euclideanModulo(Math.sin(n*78.233+1.173)*43758.5453,1);
const pulse=t=>THREE.MathUtils.smoothstep(t,0,.15)*(1-THREE.MathUtils.smoothstep(t,.30,1));

export function createExhaust(body){
  const size=boundsMax.clone().sub(boundsMin),centre=boundsMax.clone().add(boundsMin).multiplyScalar(.5);
  const volume=new THREE.BoxGeometry(size.x,size.y,size.z).translate(centre.x,centre.y,centre.z);
  const u={boundsMin:{value:boundsMin},boundsMax:{value:boundsMax},noiseField:{value:turbulenceTexture()},
    eye:{value:new THREE.Vector3()},clipFromPipe:{value:new THREE.Matrix4()},
    phase:{value:0},strength:{value:0},reach:{value:.1},samples:{value:26}};
  const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms:u,side:THREE.BackSide,
    transparent:true,blending:THREE.AdditiveBlending,premultipliedAlpha:true,depthWrite:false,toneMapped:false,
    vertexShader:`out vec3 surface;
      void main(){surface=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader});
  const jet=new THREE.Mesh(volume,material);jet.name='Exhaust afterfire';jet.visible=false;
  jet.position.set(.541,.3125,-2.114);
  jet.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3(.162,.002,-1).normalize());
  body.add(jet);
  jet.onBeforeRender=(_renderer,_scene,camera)=>{
    jet.worldToLocal(u.eye.value.setFromMatrixPosition(camera.matrixWorld));
    u.clipFromPipe.value.multiplyMatrices(camera.matrixWorldInverse,jet.matrixWorld).premultiply(camera.projectionMatrix);
  };
  return {
    setHD(enabled){u.samples.value=enabled?40:26;},
    update(time){
      // Drive the entire envelope from simulation time, so pause, dropped
      // frames and repeated renders produce the same burst.
      const interval=3.85,cycle=Math.floor(time/interval),seed=burstNoise(cycle);
      const age=time-cycle*interval-.42-1.06*seed;
      const duration=.42+.28*burstNoise(cycle+11);
      const first=pulse(age/duration);
      const second=seed>.45 ? .62*pulse((age-duration*.86)/.27) : 0;
      const strength=Math.max(first,second);
      jet.visible=strength>.001;
      u.strength.value=strength;
      if(!jet.visible)return;
      u.phase.value=age+13*seed;
      u.reach.value=.075+strength*(.205+.19*burstNoise(cycle+23))*(.94+.06*Math.sin(age*26+seed));
    },
  };
}
