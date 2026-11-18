import * as THREE from 'three';
import { createSmoke, smokeBounds } from './smoke.js';

const vertex = `
  varying vec2 st;
  void main() { st = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
const glareFragment = `
  varying vec2 st;
  uniform sampler2D image;
  uniform vec2 stepSize;
  uniform bool extract;
  void main() {
    vec3 c = texture2D(image,st).rgb * .28;
    c += texture2D(image,st+stepSize).rgb * .18;
    c += texture2D(image,st-stepSize).rgb * .18;
    c += texture2D(image,st+stepSize*vec2(1.,-1.)).rgb * .18;
    c += texture2D(image,st+stepSize*vec2(-1.,1.)).rgb * .18;
    if (extract) {
      float v = max(max(c.r,c.g),c.b);
      c *= max(0.,v-1.75) / max(.01,v);
    }
    gl_FragColor = vec4(c,1.);
  }`;

const compositeFragment = `
  varying vec2 st;
  uniform sampler2D beauty, depthMap, glare, smokeMap;
  uniform mat4 invVP, prevVP, invCar, prevCar;
  uniform vec2 texel, smokeSize;
  uniform bool smokeEnabled;
  uniform mat4 clipToSmoke;
  uniform vec3 smokeEye;
  uniform float smokeLift;
  uniform float shutter, wheelStep, focus, nearZ, farZ, grainFrame;

  float linearDepth(float d) { return nearZ*farZ / (farZ - d*(farZ-nearZ)); }
  float noise(vec2 p) { return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715)))); }
  ${smokeBounds}
  vec4 resolveSmoke(float depth,float z) {
    vec4 end=clipToSmoke*vec4(st*2.-1.,depth*2.-1.,1.);
    vec3 delta=end.xyz/end.w-smokeEye;
    float distanceToSurface=max(length(delta),.00001);
    vec2 span=plumeInterval(smokeEye,delta/distanceToSurface,smokeLift);
    if(span.y<=span.x || distanceToSurface<=span.x)return vec4(0.);
    // A twig and the sky behind it see the same complete column of smoke
    // whenever both depths are beyond the plume.
    vec2 depthRange=span*(z/distanceToSurface);
    float endDepth=min(z,depthRange.y);
    vec2 grid=st*smokeSize-.5, cell=floor(grid), part=fract(grid);
    vec4 result=vec4(0.);
    float weights=0.;
    for(int y=0;y<2;y++)for(int x=0;x<2;x++) {
      vec2 offset=vec2(float(x),float(y));
      vec2 coord=(clamp(cell+offset,vec2(0.),smokeSize-1.)+.5)/smokeSize;
      float tapDepth=clamp(linearDepth(texture2D(depthMap,coord).r),depthRange.x,depthRange.y);
      float difference=(tapDepth-endDepth)/(.13+.047*endDepth);
      vec2 bilinear=mix(1.-part,part,offset);
      float w=bilinear.x*bilinear.y/(1.+difference*difference);
      result+=texture2D(smokeMap,coord)*w;weights+=w;
    }
    return result/max(.00000001,weights);
  }
  void main() {
    float d = texture2D(depthMap,st).r;
    vec4 world = invVP * vec4(st*2.-1.,d*2.-1.,1.);
    world /= world.w;
    vec3 local = (invCar*world).xyz;
    bool vehicle = abs(local.x)<1.06 && local.y>.030 && local.y<1.34 && local.z> -2.21 && local.z<2.50;
    vec4 lastWorld = world;
    if (vehicle) {
      float axle = local.z>0. ? 1.3933 : -1.1341;
      vec2 wheel = local.yz - vec2(.33855,axle);
      if(abs(local.x)>.625 && dot(wheel,wheel)<.33855*.33855) {
        float a = -wheelStep;
        wheel = mat2(cos(a),sin(a),-sin(a),cos(a))*wheel;
        local.yz = wheel+vec2(.33855,axle);
      }
      lastWorld = prevCar*vec4(local,1.);
    }
    vec4 prev = prevVP*lastWorld;
    vec2 delta = (st - (prev.xy/max(.001,prev.w)*.5+.5))*shutter;
    float pixelLength=length(delta/texel);
    delta *= min(1.,27./max(.01,pixelLength));
    float z = linearDepth(d);
    // A tracking lens holds the body in focus. Shutter integration is
    // depth-aware, so a passing post cannot bleed across the silhouette.
    float coc = min(1.36,abs(z-focus)/max(z,.1)*1.54);
    vec3 col = texture2D(beauty,st).rgb*1.5;
    float weights=1.5;
    for(int i=0;i<8;i++){
      float t = (float(i)+.5)/8.-.5;
      float ang = float(i)*2.39996;
      vec2 sampleAt=clamp(st-t*delta+vec2(cos(ang),sin(ang))*texel*coc*.83,texel,1.-texel);
      float sz=linearDepth(texture2D(depthMap,sampleAt).r);
      float dz=abs(z-sz)/max(.12,z*.13);
      float weight=1.-smoothstep(.4,2.3,dz);
      col+=texture2D(beauty,sampleAt).rgb*weight;
      weights+=weight;
    }
    col=col/weights+texture2D(glare,st).rgb*.095;
    if(smokeEnabled){
      vec4 soot=resolveSmoke(d,z);
      col=col*(1.-soot.a)+soot.rgb;
    }
    vec2 lens=st*2.-1.;
    col*=1.-.063*pow(clamp(dot(lens,lens)*.53,0.,1.),1.42);
    gl_FragColor=vec4(col,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor.rgb+=(noise(gl_FragCoord.xy+grainFrame)-.5)*.0019;
  }`;

function screenPass(fragment, uniforms) {
  return new THREE.ShaderMaterial({ vertexShader:vertex,fragmentShader:fragment,uniforms,depthTest:false,depthWrite:false });
}

export function makeLens(renderer,compact) {
  const floatBuffers=renderer.extensions.has('EXT_color_buffer_float');
  const type=floatBuffers?THREE.HalfFloatType:THREE.UnsignedByteType;
  const gl=renderer.getContext();
  const supported=gl.getInternalformatParameter(gl.RENDERBUFFER,floatBuffers?gl.RGBA16F:gl.RGBA8,gl.SAMPLES);
  const samples=Array.from(supported || []).find(n=>n<=4) || 0;
  const main=new THREE.WebGLRenderTarget(1,1,{type,samples});
  main.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
  let smoke;
  const inverseRoad=new THREE.Matrix4();
  const low = () => new THREE.WebGLRenderTarget(1,1,{type,depthBuffer:false});
  const highlight=low(),halo=low();
  const container=new THREE.Scene(), camera=new THREE.Camera();
  const shape=new THREE.BufferGeometry();
  shape.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
  shape.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,2,0,0,2],2));
  const u = {
    beauty:{value:main.texture},depthMap:{value:main.depthTexture},glare:{value:halo.texture},
    smokeEnabled:{value:false},smokeMap:{value:null},smokeSize:{value:new THREE.Vector2(1,1)},
    clipToSmoke:{value:new THREE.Matrix4()},smokeEye:{value:new THREE.Vector3()},smokeLift:{value:0},
    invVP:{value:new THREE.Matrix4()},prevVP:{value:new THREE.Matrix4()},
    invCar:{value:new THREE.Matrix4()},prevCar:{value:new THREE.Matrix4()},
    texel:{value:new THREE.Vector2()},shutter:{value:0},wheelStep:{value:0},focus:{value:7},
    nearZ:{value:.12},farZ:{value:440},grainFrame:{value:0},
  };
  const b={image:{value:null},stepSize:{value:new THREE.Vector2()},extract:{value:true}};
  const blur=screenPass(glareFragment,b), finish=screenPass(compositeFragment,u);
  const quad=new THREE.Mesh(shape,blur);quad.frustumCulled=false;container.add(quad);
  const vp=new THREE.Matrix4(),lastVP=new THREE.Matrix4(),lastCar=new THREE.Matrix4();
  let valid=false,daylight=1;
  return {
    setSmoke(enabled) {
      if(enabled && !smoke) {
        smoke=createSmoke(main.depthTexture,compact,type);
        smoke.resize(main.width,main.height);
        u.smokeMap.value=smoke.target.texture;u.smokeSize.value=smoke.size;
        u.clipToSmoke.value=smoke.material.uniforms.localFromClip.value;
        u.smokeEye.value=smoke.material.uniforms.eye.value;
      }
      u.smokeEnabled.value=enabled;
    },
    resize(w,h) {
      main.setSize(w,h);highlight.setSize(Math.max(2,w>>2),Math.max(2,h>>2));halo.setSize(highlight.width,highlight.height);
      smoke?.resize(w,h);
      u.texel.value.set(1/w,1/h);valid=false;
    },
    render(scene, view, car, {elapsed,wheelAngle,focus,moving,time,distance,openSky,lift}) {
      view.updateMatrixWorld();
      vp.multiplyMatrices(view.projectionMatrix,view.matrixWorldInverse);
      u.invVP.value.copy(vp).invert();
      u.invCar.value.copy(car.rig.matrixWorld).invert();
      u.prevVP.value.copy(valid?lastVP:vp);u.prevCar.value.copy(valid?lastCar:car.rig.matrixWorld);
      u.shutter.value=valid && moving?Math.min(1,.0105/Math.max(.001,elapsed)):0;
      u.wheelStep.value=wheelAngle;
      u.focus.value=focus;u.nearZ.value=view.near;u.farZ.value=view.far;
      if(moving)u.grainFrame.value=(u.grainFrame.value+17)%8192;
      renderer.setRenderTarget(main);renderer.render(scene,view);
      if(u.smokeEnabled.value) {
        daylight=THREE.MathUtils.damp(daylight,openSky?1:.57,4,elapsed);
        inverseRoad.copy(car.root.matrixWorld).invert();
        u.smokeLift.value=lift;
        smoke.update(view,inverseRoad,u.invVP.value,time,distance,daylight,lift);
        quad.material=smoke.material;renderer.setRenderTarget(smoke.target);renderer.render(container,camera);
      }
      quad.material=blur;b.image.value=main.texture;b.extract.value=true;b.stepSize.value.set(2/main.width,2/main.height);
      renderer.setRenderTarget(highlight);renderer.render(container,camera);
      b.image.value=highlight.texture;b.extract.value=false;b.stepSize.value.set(2.3/highlight.width,2.3/highlight.height);
      renderer.setRenderTarget(halo);renderer.render(container,camera);
      quad.material=finish;renderer.setRenderTarget(null);renderer.render(container,camera);
      lastVP.copy(vp);lastCar.copy(car.rig.matrixWorld);valid=true;
    },
  };
}
