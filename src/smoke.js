import * as THREE from 'three';
import { sunDirection } from './surfaces.js';

// Four independent, seamless noise channels. The GPU samples this volume
// with trilinear filtering, including when the camera moves through a wisp.
export function makeTurbulence(size = 48) {
  const voxels = new Float32Array(size ** 3 * 4);
  let seed = 0x7d085259;
  for (const [cells, weight] of [[3, .52], [6, .28], [12, .14], [24, .06]]) {
    const grid = new Float32Array(cells ** 3 * 4);
    for (let i = 0; i < grid.length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      grid[i] = (seed >>> 0) / 4294967296;
    }
    const axis = Array.from({ length: size }, (_, i) => {
      const p = (i + .5) * cells / size, base = Math.floor(p), d = p - base;
      return [base, (base + 1) % cells, d * d * (3 - 2 * d)];
    });
    let out = 0;
    for (const [z0, z1, z] of axis) for (const [y0, y1, y] of axis) {
      const row = (y, z) => (z * cells + y) * cells * 4;
      const a = row(y0, z0), b = row(y1, z0), c = row(y0, z1), d = row(y1, z1);
      for (const [x0, x1, x] of axis) {
        for (let ch = 0; ch < 4; ch++) {
          const i = 4 * x0 + ch, j = 4 * x1 + ch;
          const lo = (grid[a+i]*(1-x)+grid[a+j]*x)*(1-y) + (grid[b+i]*(1-x)+grid[b+j]*x)*y;
          const hi = (grid[c+i]*(1-x)+grid[c+j]*x)*(1-y) + (grid[d+i]*(1-x)+grid[d+j]*x)*y;
          voxels[out++] += (lo*(1-z)+hi*z)*weight;
        }
      }
    }
  }
  const bytes = Uint8Array.from(voxels, x => Math.round(255 * x));
  const texture = new THREE.Data3DTexture(bytes, size, size, size);
  texture.format = THREE.RGBAFormat;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

export const smokeField = /* glsl */ `
  uniform highp sampler3D turbulence;
  uniform float seconds, drift;
  const vec3 lowCorner = vec3(-2.48, .035, -7.35);
  const vec3 highCorner = vec3(2.48, 3.15, 3.15);

  float smokeDensity(vec3 p, out float sunEdge) {
    // Two flows meet over the roof. On either flank the wheel wake rolls
    // around its own centre before opening into a pair of trailing vortices.
    float trail = max(0., -p.z-1.25);
    float side = p.x < 0. ? -1. : 1.;
    float phase = p.z*1.86 + seconds*1.31 + side*1.76;
    float roll = sin(phase);
    float roofZ = (p.z+.13)*.92;
    float ridge = .83 + .53*exp(-roofZ*roofZ) + .10*roll;
    float sideY = .56 + .16*roll + .12*min(trail, 1.);
    float lengthMask = 1.-smoothstep(2.14, 2.95, abs(p.z-.10));
    float crown = 1.-smoothstep(.36, 1.26, length(vec2(p.x*.85, (p.y-ridge-.16)*1.67)));
    float shoulder = 1.-smoothstep(.25, 1.22, length(vec2((abs(p.x)-.94-.09*cos(phase))*1.91, (p.y-sideY)*1.58)));
    float wakeY = .66 + .21*trail + .19*sin(trail*1.64-seconds*1.47+side*.94);
    float wakeX = .72 + .09*trail + .21*cos(trail*1.34-seconds*1.12+side*1.76);
    float wake = 1.-smoothstep(.15, 1.35, length(vec2((abs(p.x)-wakeX)*1.21, (p.y-wakeY)*1.23)));
    wake *= smoothstep(0., 1.10, trail)*(1.-smoothstep(2.65, 5.85, trail));
    float envelope = max(max(.96*crown, shoulder)*lengthMask, wake*.92);
    envelope *= smoothstep(.035,.22,p.y);
    sunEdge = 0.;
    if (envelope < .008) return 0.;

    vec3 flow = p*vec3(.31, .38, .255) + vec3(.013*seconds,-.12*seconds,drift);
    vec3 warp = texture(turbulence, flow*.54+vec3(.13,.52,.30)).gba - .5;
    // Counter-rotating shear folds the noise around the two sides of the car.
    vec3 folded = flow + warp*1.05 + vec3(.070*roll, .092*cos(phase+p.y*1.7), .036*side*roll);
    vec4 cloud = texture(turbulence, folded);
    float fray = texture(turbulence, folded*2.81-warp*.54+vec3(.29,.17,.53)).r;
    float billow = .76*cloud.r + .24*fray;
    float mass = smoothstep(.385, .695, billow + .31*envelope - .19);
    sunEdge = clamp(.62 + 1.34*(cloud.g-cloud.r) + .18*roll, .05, 1.);
    return envelope*mass*3.35;
  }
`;

const vertex = /* glsl */ `
  out vec2 screenUV;
  void main() { screenUV=uv; gl_Position=vec4(position.xy,0.,1.); }
`;

const fragment = /* glsl */ `
  in vec2 screenUV;
  out vec4 soot;
  uniform sampler2D sceneDepth;
  uniform mat4 localFromClip;
  uniform vec3 eye, sunlight;
  uniform float daylight;
  ${smokeField}
  void main() {
    float depth = texture(sceneDepth,screenUV).r;
    vec4 h = localFromClip*vec4(screenUV*2.-1.,depth*2.-1.,1.);
    vec3 end = h.xyz/h.w, delta = end-eye;
    float farPoint=length(delta);
    vec3 ray=delta/max(farPoint,.00001);
    vec3 reciprocal=mix(vec3(-1.),vec3(1.),greaterThanEqual(ray,vec3(0.)))/max(abs(ray),vec3(.00001));
    vec3 a=(lowCorner-eye)*reciprocal, b=(highCorner-eye)*reciprocal;
    vec3 first=min(a,b), last=max(a,b);
    float entry=max(max(max(first.x,first.y),first.z),0.);
    float exitPoint=min(min(min(last.x,last.y),last.z),farPoint);
    if(exitPoint<=entry){soot=vec4(0.);return;}
    float stepSize=(exitPoint-entry)/float(SMOKE_STEPS);
    float jitter=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
    vec3 p=eye+ray*(entry+stepSize*(.17+.66*jitter));
    vec3 radiance=vec3(0.);
    float transmission=1.;
    float rim=pow(clamp(dot(ray,sunlight)*.5+.5,0.,1.),3.);
    for(int i=0;i<SMOKE_STEPS;i++){
      float edge;
      float density=smokeDensity(p,edge);
      float intercepted=1.-exp(-density*stepSize);
      float light=edge*exp(-.54*density)*daylight;
      vec3 scattering=mix(vec3(.009,.010,.015),vec3(.106,.113,.123),light*(.73+.27*rim));
      // Red paint reflects just into the underside of the soot.
      scattering.r+=.006*exp(-1.65*abs(p.y-.70))*light;
      radiance+=transmission*intercepted*scattering;
      transmission*=1.-intercepted;
      if(transmission<.018)break;
      p+=ray*stepSize;
    }
    if(abs(end.x)<1.82 && end.y<1.58 && end.y>-.12 && abs(end.z)<2.85){
      float unused;
      float cover=smokeDensity(end+.30*sunlight,unused)+.58*smokeDensity(end+.71*sunlight,unused);
      transmission*=exp(-.069*daylight*cover);
    }
    soot=vec4(radiance,1.-transmission);
  }
`;

export function createSmoke(depth, compact, type) {
  const target = new THREE.WebGLRenderTarget(1,1,{type,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  const uniforms = {
    sceneDepth:{value:depth}, turbulence:{value:makeTurbulence()},
    localFromClip:{value:new THREE.Matrix4()}, eye:{value:new THREE.Vector3()}, sunlight:{value:new THREE.Vector3()},
    seconds:{value:0}, drift:{value:0}, daylight:{value:1},
  };
  const material = new THREE.ShaderMaterial({
    glslVersion:THREE.GLSL3, uniforms, defines:{SMOKE_STEPS:compact?26:42},
    vertexShader:vertex,fragmentShader:fragment,depthTest:false,depthWrite:false,toneMapped:false,
  });
  const size = new THREE.Vector2(1,1);
  return {
    target, material, size,
    resize(w,h) {
      const ratio=Math.min(compact?.40:.52,Math.sqrt((compact?190000:540000)/(w*h)));
      size.set(Math.max(2,Math.ceil(w*ratio)),Math.max(2,Math.ceil(h*ratio)));
      target.setSize(size.x,size.y);
    },
    update(camera,inverseCar,inverseVP,time,distance,daylight) {
      uniforms.localFromClip.value.multiplyMatrices(inverseCar,inverseVP);
      uniforms.eye.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inverseCar);
      uniforms.sunlight.value.copy(sunDirection).transformDirection(inverseCar);
      uniforms.seconds.value=time;uniforms.drift.value=distance*.022;
      uniforms.daylight.value=daylight;
    },
  };
}
