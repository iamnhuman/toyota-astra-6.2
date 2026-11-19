import * as THREE from 'three';
import { studioLights } from './studio.js';

const fragmentShader=`
  varying vec2 st;
  uniform sampler2D depthMap;
  uniform mat4 roadFromClip;
  uniform vec3 eye,colours[${studioLights}];
  uniform vec4 sources[${studioLights}],axes[${studioLights}],strips[${studioLights}];
  uniform float nearZ,farZ;
  void main(){
    float depth=texture2D(depthMap,st).r;
    vec4 hit=roadFromClip*vec4(st*2.-1.,depth*2.-1.,1.);
    vec3 offset=hit.xyz/hit.w-eye;
    float surfaceDistance=length(offset);
    vec3 ray=offset/max(.00001,surfaceDistance),glow=vec3(0.);
    for(int i=0;i<${studioLights};i++){
      vec3 axis=strips[i].xyz,fromLamp=eye-sources[i].xyz;
      float facing=smoothstep(-.09,.37,dot(axes[i].xyz,-ray));
      if(facing==0.)continue;
      // Closest points on the viewing ray and the finite LED strip. Its
      // optical halo stays on the diffuser and disappears behind bodywork.
      float alongRay=dot(fromLamp,ray),alignment=dot(axis,ray);
      float alongStrip=(dot(fromLamp,axis)-alignment*alongRay)/max(.00001,1.-alignment*alignment);
      alongStrip=clamp(alongStrip,-strips[i].w,strips[i].w);
      float t=alignment*alongStrip-alongRay;
      if(t<=0. || t>surfaceDistance+sources[i].w)continue;
      float distanceToAxis=length(fromLamp+t*ray-alongStrip*axis);
      float edge=max(0.,distanceToAxis-sources[i].w);
      float falloff=edge/axes[i].w;
      // Let the emitting geometry supply its own light on the face of the bar.
      // The halo is strongest just outside its silhouette.
      float clearAir=smoothstep(0.,sources[i].w+.035,surfaceDistance-t);
      glow+=colours[i]*facing*mix(.18,1.,clearAir)*exp(-2.*falloff*falloff);
    }
    float z=nearZ*farZ/(farZ-depth*(farZ-nearZ));
    gl_FragColor=vec4(glow,min(z,20.)/20.);
  }`;

// Alpha stores scene depth for bilateral reconstruction at display resolution.
export function createLEDGlow(depth,colourBuffer,compact,vertexShader){
  const target=new THREE.WebGLRenderTarget(1,1,{...colourBuffer,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  const size=new THREE.Vector2(1,1);
  const uniforms={depthMap:{value:depth},roadFromClip:{value:new THREE.Matrix4()},eye:{value:new THREE.Vector3()},
    sources:{value:[]},axes:{value:[]},strips:{value:[]},colours:{value:[]},nearZ:{value:.13},farZ:{value:460}};
  const material=new THREE.ShaderMaterial({vertexShader,fragmentShader,uniforms,depthTest:false,depthWrite:false,toneMapped:false});
  return {target,size,
    resize(w,h){
      const scale=Math.min(.52,Math.sqrt((compact?135000:360000)/(w*h)));
      size.set(Math.max(2,Math.ceil(w*scale)),Math.max(2,Math.ceil(h*scale)));target.setSize(size.x,size.y);
    },
    render(draw,view,inverseRoad,inverseVP,studio){
      uniforms.roadFromClip.value.multiplyMatrices(inverseRoad,inverseVP);
      uniforms.eye.value.setFromMatrixPosition(view.matrixWorld).applyMatrix4(inverseRoad);
      uniforms.sources.value=studio.sources;uniforms.axes.value=studio.axes;uniforms.strips.value=studio.strips;uniforms.colours.value=studio.colours;
      uniforms.nearZ.value=view.near;uniforms.farZ.value=view.far;
      draw(material,target);
    },
  };
}
