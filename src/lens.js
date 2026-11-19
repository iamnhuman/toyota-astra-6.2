import * as THREE from 'three';
import { createSmoke, smokeBounds } from './smoke.js';
import { createLEDGlow } from './beams.js';

const vertex = `
  varying vec2 st;
  void main() { st = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
const glareFragment = `
  varying vec2 st;
  uniform sampler2D image;
  uniform vec2 stepSize;
  uniform bool extract;
  uniform float threshold;
  void main() {
    vec3 c = texture2D(image,st).rgb * .28;
    c += texture2D(image,st+stepSize).rgb * .18;
    c += texture2D(image,st-stepSize).rgb * .18;
    c += texture2D(image,st+stepSize*vec2(1.,-1.)).rgb * .18;
    c += texture2D(image,st+stepSize*vec2(-1.,1.)).rgb * .18;
    if (extract) {
      float v = max(max(c.r,c.g),c.b);
      c *= max(0.,v-threshold) / max(.01,v);
    }
    gl_FragColor = vec4(c,1.);
  }`;

const compositeFragment = `
  varying vec2 st;
  uniform sampler2D beauty, depthMap, glare, smokeMap, lampGlowMap;
  uniform mat4 carFromClip,previousClipFromClip,previousClipFromBodyClip,previousClipFromCar;
  uniform vec2 texel, smokeSize, lampGlowSize;
  uniform bool smokeEnabled,hdLens;
  uniform mat4 clipToSmoke;
  uniform vec3 smokeEye;
  uniform float shutter, wheelStep, focus, nearZ, farZ;

  float linearDepth(float d) { return nearZ*farZ / (farZ - d*(farZ-nearZ)); }
  float noise(vec2 p) { return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715)))); }
  ${smokeBounds}
  vec4 resolveSmoke(float depth,float z) {
    vec4 end=clipToSmoke*vec4(st*2.-1.,depth*2.-1.,1.);
    vec3 delta=end.xyz/end.w-smokeEye;
    float distanceToSurface=max(length(delta),.00001);
    vec2 span=plumeInterval(smokeEye,delta/distanceToSurface);
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
  vec3 lampGlow(float z){
    vec2 grid=st*lampGlowSize-.5,cell=floor(grid),part=fract(grid);
    vec3 sum=vec3(0.);float weights=0.;
    for(int y=0;y<2;y++)for(int x=0;x<2;x++){
      vec2 off=vec2(float(x),float(y)),b=mix(1.-part,part,off);
      vec4 tap=texture2D(lampGlowMap,(clamp(cell+off,vec2(0.),lampGlowSize-1.)+.5)/lampGlowSize);
      float diff=(tap.a*20.-min(z,20.))/(.095+.025*min(z,20.));
      float w=b.x*b.y/(1.+diff*diff);
      sum+=tap.rgb*w;weights+=w;
    }
    return sum/max(.025,weights);
  }
  void main() {
    float d = texture2D(depthMap,st).r;
    vec4 clip=vec4(st*2.-1.,d*2.-1.,1.);
    vec4 carPoint=carFromClip*clip;
    vec3 local=carPoint.xyz/carPoint.w;
    bool vehicle = abs(local.x)<1.06 && local.y>.030 && local.y<1.34 && local.z> -2.21 && local.z<2.50;
    vec4 prev=previousClipFromClip*clip;
    if (vehicle) {
      float axle = local.z>0. ? 1.3933 : -1.1341;
      vec2 wheel = local.yz - vec2(.33855,axle);
      if(abs(local.x)>.625 && dot(wheel,wheel)<.33855*.33855) {
        float a = -wheelStep;
        wheel = mat2(cos(a),sin(a),-sin(a),cos(a))*wheel;
        local.yz = wheel+vec2(.33855,axle);
        prev=previousClipFromCar*vec4(local,1.);
      }else{
        prev=previousClipFromBodyClip*clip;
      }
    }
    vec2 delta=prev.w>0. ? (st-(prev.xy/prev.w*.5+.5))*shutter : vec2(0.);
    float pixelLength=length(delta/texel);
    delta *= min(1.,27./max(.01,pixelLength));
    float z = linearDepth(d);
    // A tracking lens holds the body in focus. Shutter integration is
    // depth-aware, so a passing post cannot bleed across the silhouette.
    float coc = min(hdLens?1.05:1.36,abs(z-focus)/max(z,.1)*(hdLens?1.22:1.54));
    vec3 col = texture2D(beauty,st).rgb*1.5;
    float weights=1.5;
    int taps=hdLens?12:8;
    for(int i=0;i<12;i++){
      if(i>=taps)break;
      float t = (float(i)+.5)/float(taps)-.5;
      float ang = float(i)*2.39996;
      vec2 sampleAt=clamp(st-t*delta+vec2(cos(ang),sin(ang))*texel*coc*.83,texel,1.-texel);
      float sz=linearDepth(texture2D(depthMap,sampleAt).r);
      float dz=abs(z-sz)/max(.12,z*.13);
      float weight=1.-smoothstep(.4,2.3,dz);
      col+=texture2D(beauty,sampleAt).rgb*weight;
      weights+=weight;
    }
    col=col/weights+texture2D(glare,st).rgb*(hdLens ? .145 : .095);
    if(hdLens)col+=lampGlow(z);
    if(smokeEnabled){
      vec4 soot=resolveSmoke(d,z);
      col=col*(1.-soot.a)+soot.rgb;
    }
    vec2 lens=st*2.-1.;
    col*=1.-.063*pow(clamp(dot(lens,lens)*.53,0.,1.),1.42);
    gl_FragColor=vec4(col,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor.rgb+=(noise(gl_FragCoord.xy)-.5)/255.;
  }`;

function screenPass(fragment, uniforms) {
  return new THREE.ShaderMaterial({ vertexShader:vertex,fragmentShader:fragment,uniforms,depthTest:false,depthWrite:false });
}

export function makeLens(renderer,compact) {
  const floatBuffers=renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  // An sRGB attachment gives the byte fallback more levels near black.
  // The GPU encodes on write and decodes on sample; lighting stays linear.
  const colourBuffer={type:floatBuffers?THREE.HalfFloatType:THREE.UnsignedByteType,
    colorSpace:floatBuffers?THREE.LinearSRGBColorSpace:THREE.SRGBColorSpace};
  const gl=renderer.getContext();
  const supported=gl.getInternalformatParameter(gl.RENDERBUFFER,floatBuffers?gl.RGBA16F:gl.SRGB8_ALPHA8,gl.SAMPLES);
  const sampleCounts=Array.from(supported || []).sort((a,b)=>b-a);
  const samples=sampleCounts.find(n=>n<=4) || 0;
  const largeFrameSamples=sampleCounts.find(n=>n<=2) || 0;
  const main=new THREE.WebGLRenderTarget(1,1,{...colourBuffer,samples});
  main.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
  let smoke,ledGlow;
  const inverseRoad=new THREE.Matrix4();
  const low = () => new THREE.WebGLRenderTarget(1,1,{...colourBuffer,depthBuffer:false});
  const highlight=low(),halo=low();
  const container=new THREE.Scene(), camera=new THREE.Camera();
  const shape=new THREE.BufferGeometry();
  shape.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
  shape.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,2,0,0,2],2));
  const u = {
    beauty:{value:main.texture},depthMap:{value:main.depthTexture},glare:{value:halo.texture},
    lampGlowMap:{value:null},lampGlowSize:{value:new THREE.Vector2(1,1)},
    hdLens:{value:false},smokeEnabled:{value:false},smokeMap:{value:null},smokeSize:{value:new THREE.Vector2(1,1)},
    clipToSmoke:{value:new THREE.Matrix4()},smokeEye:{value:new THREE.Vector3()},plumePadding:{value:new THREE.Vector3()},
    carFromClip:{value:new THREE.Matrix4()},previousClipFromClip:{value:new THREE.Matrix4()},
    previousClipFromBodyClip:{value:new THREE.Matrix4()},previousClipFromCar:{value:new THREE.Matrix4()},
    texel:{value:new THREE.Vector2()},shutter:{value:0},wheelStep:{value:0},focus:{value:7},
    nearZ:{value:.12},farZ:{value:440},
  };
  const b={image:{value:null},stepSize:{value:new THREE.Vector2()},extract:{value:true},threshold:{value:1.75}};
  const blur=screenPass(glareFragment,b), finish=screenPass(compositeFragment,u);
  const quad=new THREE.Mesh(shape,blur);quad.frustumCulled=false;container.add(quad);
  function drawPass(material,target){
    quad.material=material;renderer.setRenderTarget(target);renderer.render(container,camera);
  }
  const vp=new THREE.Matrix4(),invVP=new THREE.Matrix4(),lastVP=new THREE.Matrix4(),lastCar=new THREE.Matrix4(),lastBody=new THREE.Matrix4();
  const lastStudio=new THREE.Matrix4();
  let valid=false,daylight=1;
  return {
    async prepareCar(root,view,scene){
      const previous=renderer.getRenderTarget();
      renderer.setRenderTarget(main);
      try{await renderer.compileAsync(root,view,scene);}
      finally{renderer.setRenderTarget(previous);}
    },
    setHD(enabled){
      u.hdLens.value=enabled;
      b.threshold.value=enabled && !floatBuffers ? .83 : 1.75;
      if(enabled && !ledGlow){
        ledGlow=createLEDGlow(main.depthTexture,colourBuffer,compact,vertex);
        u.lampGlowMap.value=ledGlow.target.texture;u.lampGlowSize.value=ledGlow.size;
      }
      if(enabled)ledGlow.resize(main.width,main.height);
      if(u.smokeEnabled.value)smoke.setHD(enabled);
    },
    setSmoke(enabled) {
      if(enabled && !smoke) {
        smoke=createSmoke(main.depthTexture,compact,colourBuffer);
        u.smokeMap.value=smoke.target.texture;u.smokeSize.value=smoke.size;
        u.clipToSmoke.value=smoke.material.uniforms.localFromClip.value;
        u.smokeEye.value=smoke.material.uniforms.eye.value;
        u.plumePadding.value=smoke.material.uniforms.plumePadding.value;
      }
      if(enabled){smoke.setHD(u.hdLens.value);smoke.resize(main.width,main.height);}
      u.smokeEnabled.value=enabled;
    },
    resize(w,h) {
      const nextSamples=u.hdLens.value && w*h>3_850_000?largeFrameSamples:samples;
      if(main.samples!==nextSamples){main.dispose();main.samples=nextSamples;}
      main.setSize(w,h);highlight.setSize(Math.max(2,w>>2),Math.max(2,h>>2));halo.setSize(highlight.width,highlight.height);
      if(u.smokeEnabled.value)smoke.resize(w,h);
      if(u.hdLens.value)ledGlow.resize(w,h);
      u.texel.value.set(1/w,1/h);valid=false;
    },
    render(scene, view, car, {elapsed,wheelAngle,focus,moving,time,distance,openSky,stunt,speed,studio}) {
      view.updateMatrixWorld();
      vp.multiplyMatrices(view.projectionMatrix,view.matrixWorldInverse);
      // Compose in CPU double precision. The shader reprojects directly
      // between frames, even centimetres from glass far along the road.
      invVP.copy(vp).invert();
      const rig=car.rig.matrixWorld,body=car.body?.matrixWorld??rig,previousVP=valid?lastVP:vp;
      u.carFromClip.value.copy(rig).invert().multiply(invVP);
      if(studio && valid){
        // The studio travels with the car. Reproject its crisp light strips
        // in that frame, including the height change during a flip.
        u.previousClipFromClip.value.copy(studio.rig.matrixWorld).invert().multiply(invVP).premultiply(lastStudio).premultiply(previousVP);
      }else u.previousClipFromClip.value.multiplyMatrices(previousVP,invVP);
      u.previousClipFromCar.value.multiplyMatrices(previousVP,valid?lastCar:rig);
      u.previousClipFromBodyClip.value.copy(body).invert().multiply(invVP).premultiply(valid?lastBody:body).premultiply(previousVP);
      u.shutter.value=valid && moving?Math.min(1,(u.hdLens.value?.008:.0105)/Math.max(.001,elapsed)):0;
      u.wheelStep.value=wheelAngle;
      u.focus.value=focus;u.nearZ.value=view.near;u.farZ.value=view.far;
      renderer.setRenderTarget(main);renderer.render(scene,view);
      if(studio || u.smokeEnabled.value)inverseRoad.copy(car.root.matrixWorld).invert();
      if(studio)ledGlow.render(drawPass,view,inverseRoad,invVP,studio);
      if(u.smokeEnabled.value) {
        daylight=THREE.MathUtils.damp(daylight,studio || openSky?1:.57,4,elapsed);
        smoke.update(view,inverseRoad,invVP,time,distance,daylight,stunt,speed,studio);
        smoke.render(drawPass);
      }
      quad.material=blur;b.image.value=main.texture;b.extract.value=true;b.stepSize.value.set(2/main.width,2/main.height);
      renderer.setRenderTarget(highlight);renderer.render(container,camera);
      b.image.value=highlight.texture;b.extract.value=false;b.stepSize.value.set(2.3/highlight.width,2.3/highlight.height);
      renderer.setRenderTarget(halo);renderer.render(container,camera);
      quad.material=finish;renderer.setRenderTarget(null);renderer.render(container,camera);
      lastVP.copy(vp);lastCar.copy(car.rig.matrixWorld);lastBody.copy(body);valid=true;
      if(studio)lastStudio.copy(studio.rig.matrixWorld);
    },
  };
}
