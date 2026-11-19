import * as THREE from 'three';
import { turbulenceTexture } from './turbulence.js';

// Add whole texels toward the footwell and the driver's window. Keep the
// original spacing and texel centres at the face and steering wheel.
const upperHalf=new THREE.Vector3(.285,.399,.311);
const nx=74,ny=84,nz=100;
const half=new THREE.Vector3(upperHalf.x*nx/44,upperHalf.y*ny/64,upperHalf.z*nz/48);
const rearPadding=4*(2*upperHalf.z/48);
const centre=new THREE.Vector3(half.x-upperHalf.x,upperHalf.y-half.y,half.z-upperHalf.z-rearPadding);
const firePalette=`
  vec3 fireColour(float heat){
    vec3 ember=mix(vec3(1.65,.042,.002),vec3(4.2,.64,.016),smoothstep(.06,.58,heat));
    vec3 gold=mix(ember,vec3(6.1,2.65,.16),smoothstep(.48,.84,heat));
    return mix(gold,vec3(8.1,5.3,1.55),smoothstep(.79,1.,heat));
  }`;
const vertexShader=`
  uniform vec3 halfSize,volumeCentre;
  uniform float layers,nearPlane;
  uniform mat4 fromView;
  out vec3 point;
  out vec3 slabStep;
  void intersectEdge(vec3 middle,vec3 axis,float depth,inout vec2 lo,inout vec2 hi){
    if(abs(axis.z)<.000001)return;
    float t=(-depth-middle.z)/axis.z;
    if(abs(t)>1.00001)return;
    vec2 hit=middle.xy+clamp(t,-1.,1.)*axis.xy;
    lo=min(lo,hit);hi=max(hi,hit);
  }
  void boundSlice(vec3 centre,vec3 size,float depth,inout vec2 lo,inout vec2 hi){
    vec3 x=modelViewMatrix[0].xyz*size.x,y=modelViewMatrix[1].xyz*size.y,z=modelViewMatrix[2].xyz*size.z;
    if(abs(depth+centre.z)>abs(x.z)+abs(y.z)+abs(z.z))return;
    for(int a=-1;a<=1;a+=2)for(int b=-1;b<=1;b+=2){
      intersectEdge(centre+float(a)*y+float(b)*z,x,depth,lo,hi);
      intersectEdge(centre+float(a)*x+float(b)*z,y,depth,lo,hi);
      intersectEdge(centre+float(a)*x+float(b)*y,z,depth,lo,hi);
    }
  }
  void main(){
    vec3 centre=(modelViewMatrix*vec4(volumeCentre,1.)).xyz;
    float extent=dot(abs(vec3(modelViewMatrix[0].z,modelViewMatrix[1].z,modelViewMatrix[2].z)),halfSize);
    float farEnd=-centre.z+extent;
    float ds=max(0.,farEnd-max(nearPlane,-centre.z-extent))/layers;
    float depth=farEnd-(float(gl_InstanceID)+.5)*ds;
    // Bound the torso, outstretched arm and legs separately to avoid drawing
    // the entire windscreen when only the hand is close to the lens.
    vec2 lo=vec2(1e5),hi=vec2(-1e5);
    boundSlice(modelViewMatrix[3].xyz,vec3(.326,.399,.353),depth,lo,hi);
    boundSlice((modelViewMatrix*vec4(.377,.058,-.092,1.)).xyz,vec3(.276,.215,.277),depth,lo,hi);
    vec3 legMin=volumeCentre-halfSize,legMax=vec3(.39,-.12,(volumeCentre+halfSize).z);
    boundSlice((modelViewMatrix*vec4(.5*(legMin+legMax),1.)).xyz,.5*(legMax-legMin),depth,lo,hi);
    vec3 v=vec3(mix(lo,hi,position.xy+.5),-depth);
    point=(fromView*vec4(v,1.)).xyz;
    slabStep=(fromView*vec4(v*(ds/max(.001,depth)),0.)).xyz;
    gl_Position=ds>0. && lo.x<=hi.x?projectionMatrix*vec4(v,1.):vec4(2.,2.,2.,1.);
  }`;
const fragmentShader=`
  uniform highp sampler3D shape,noiseField;
  uniform vec3 halfSize,volumeCentre,eye;
  uniform float seconds;
  uniform bool fine;
  in vec3 point,slabStep;
  out vec4 mist;
  ${firePalette}
  // Each tongue tapers and curls in two directions as hot gas rises from the lid.
  float tongue(vec3 p,float foot,float radius,float height,float lean,float phase,vec3 eddy){
    float h=clamp((p.y+.006)/height,0.,1.);
    vec2 centre=vec2(foot+lean*h*h,.003+.013*h);
    centre+=h*vec2(.009*sin(phase-7.1*h),.004*cos(.76*phase-5.3*h));
    centre+=(.22+.78*h)*eddy.xz*vec2(.038,.024);
    float width=radius*max(.03,1.-h*h)*(.83+.17*sin(phase-9.*h));
    float radial=length((p.xz-centre)*vec2(1.,1.16))/width;
    return (1.-smoothstep(.30,1.06,radial))*(1.-smoothstep(.85,1.,h));
  }
  vec4 fireAt(vec3 p){
    float seed=p.x<0.?1.73:5.48;
    vec3 s=vec3(abs(p.x)-.046,p.y-.232,p.z+.057);
    s.y-=.28*s.x;s.z+=.20*s.x;
    if(s.y<-.011 || s.y>.102 || abs(s.x)>.046 || abs(s.z-.008)>.036)return vec4(0.);
    vec3 flow=s*vec3(7.5,6.7,8.1)+vec3(seed,.63*seed-.64*seconds,.29*seed);
    vec3 eddy=texture(noiseField,flow).rgb-.5;
    if(fine)eddy+=.32*(texture(noiseField,2.53*flow+.84*eddy).gbr-.5);
    float phase=seconds*(5.7+.19*seed)+seed;
    float middle=tongue(s,-.002,.019,.072+.011*sin(phase)+.018*eddy.g,-.010,phase,eddy);
    float outer=tongue(s,.017,.012,.061+.013*sin(.81*phase+1.6),.012,phase+2.7,eddy);
    float inner=tongue(s,-.017,.011,.041+.010*cos(1.19*phase),-.006,phase-1.8,eddy);
    float body=max(middle,max(outer,inner));
    float density=112.*body*smoothstep(-.011,-.004,s.y);
    float heat=clamp(.22+.65*body-.43*max(s.y,0.)/.084+.40*eddy.g,0.,1.);
    return vec4(fireColour(heat)*density,density);
  }
  vec4 fireColumn(){
    // Cover thin flames even when a smoke slice is wider than a tongue.
    vec3 centre=vec3(0.,.279,-.050),extent=vec3(.094,.066,.043);
    if(any(greaterThan(abs(point-centre),extent+.5*abs(slabStep))))return vec4(0.);
    vec3 first=point-.5*slabStep;
    vec3 inv=mix(vec3(-1.),vec3(1.),greaterThanEqual(slabStep,vec3(0.)))/max(abs(slabStep),vec3(1e-7));
    vec3 a=(centre-extent-first)*inv,b=(centre+extent-first)*inv;
    vec3 lo=min(a,b),hi=max(a,b);
    float begin=max(0.,max(lo.x,max(lo.y,lo.z))),end=min(1.,min(hi.x,min(hi.y,hi.z)));
    if(end<=begin)return vec4(0.);
    float distance=(end-begin)*length(slabStep);
    int steps=int(clamp(ceil(distance/(fine?.004:.0055)),1.,10.));
    vec3 stepVector=slabStep*((end-begin)/float(steps));
    vec3 samplePoint=first+begin*slabStep+.5*stepVector;
    vec4 column=vec4(0.);
    for(int i=0;i<steps;i++){column+=fireAt(samplePoint);samplePoint+=stepVector;}
    return column*(distance/float(steps));
  }
  vec4 sootAt(){
    vec3 coord=(point-volumeCentre)/(2.*halfSize)+.5;
    if(texture(shape,coord).r<.15)return vec4(0.);
    vec3 flow=point*vec3(2.4,2.05,2.34)+vec3(.036,-.18,.055)*seconds;
    vec3 drift=texture(noiseField,flow).rgb-.5;
    vec3 curl=texture(noiseField,flow*2.23+1.32*drift+.36).gbr-.5;
    float restingArm=smoothstep(.22,.40,point.x)*smoothstep(-.16,-.07,point.y);
    vec3 q=point+(drift*.101+curl*.030)*mix(1.,.45,restingArm);
    vec4 form=texture(shape,(q-volumeCentre)/(2.*halfSize)+.5);
    float d=(form.r-.5)*.24;
    float fibre=curl.r+.66*drift.b;
    if(fine)fibre+=.39*(texture(noiseField,flow*5.18+.93*curl).b-.5);
    float core=smoothstep(-.012,mix(.051,.029,restingArm),d+.057*fibre);
    float shell=1.-smoothstep(.003,.029,abs(d+.013+.058*fibre));
    float ribbons=shell*smoothstep(-.19,.14,curl.b+.61*drift.r);
    float soot=core*(.42+.76*smoothstep(-.20,.15,fibre));
    float density=34.*soot+13.*ribbons;
    if(density<.025)return vec4(0.);
    vec3 normal=normalize(form.gba*2.-1.+.15*curl);
    vec3 toEye=normalize(eye-point);
    float rim=pow(1.-min(1.,abs(dot(normal,toEye))),1.55);
    float key=clamp(.38+dot(normal,normalize(vec3(-.48,.76,.41)))*.62,0.,1.);
    float silver=.027+.048*key+.27*rim*(.42+.58*key)+.078*ribbons;
    float grey=mix(.006+.032*key,silver,clamp(.68*ribbons+.41*rim,0.,1.));
    // A small amount of eye light scatters in the soot immediately around the sockets.
    vec3 socket=vec3(abs(point.x)-.046,point.y-.249,point.z+.058)*vec3(29.,34.,44.);
    float ember=exp(-dot(socket,socket))*(.83+.17*sin(seconds*(point.x<0.?6.03:6.74)+sign(point.x)*2.));
    return vec4((vec3(grey)+vec3(.86,.20,.018)*ember)*density,density);
  }
  void main(){
    if(any(greaterThan(abs(point-volumeCentre),halfSize)))discard;
    vec4 column=sootAt()*length(slabStep)+fireColumn();
    if(column.a<.00001)discard;
    float alpha=1.-exp(-column.a);
    mist=vec4(column.rgb*(alpha/column.a),alpha);
  }`;

function driverShape(){
  // Positive distance inside the seated figure, in metres. Sampling this once
  // lets the GPU spend its close-up budget on drifting soot and filaments.
  const legs=[
    {hip:-.081,kneeX:-.103,kneeZ:.292,ankleX:-.145,heelZ:.667,toeX:-.139,toeZ:.830},
    {hip:.082,kneeX:.145,kneeZ:.335,ankleX:.220,heelZ:.682,toeX:.244,toeZ:.817},
  ];
  const shapeAt=(x,y,z)=>{
    const ell=(cx,cy,cz,rx,ry,rz)=>
      (1-Math.hypot((x-cx)/rx,(y-cy)/ry,(z-cz)/rz))*Math.min(rx,ry,rz);
    const limb=(ax,ay,az,bx,by,bz,r0,r1)=>{
      const dx=bx-ax,dy=by-ay,dz=bz-az;
      const t=THREE.MathUtils.clamp(((x-ax)*dx+(y-ay)*dy+(z-az)*dz)/(dx*dx+dy*dy+dz*dz),0,1);
      return r0+(r1-r0)*t-Math.hypot(x-ax-t*dx,y-ay-t*dy,z-az-t*dz);
    };
    const side=Math.abs(x),handedness=Math.sign(x);
    let d=Math.max(ell(0,-.075,-.145,.163,.229,.107),ell(0,-.215,-.084,.129,.105,.123),
      ell(0,.050,-.155,.182,.075,.088),ell(0,.127,-.155,.064,.093,.071),
      ell(0,.238,-.158,.101,.115,.095),ell(0,.192,-.128,.079,.080,.070),
      ell(0,.199,-.067,.025,.041,.031),
      ell(Math.sign(x)*.061,.204,-.099,.041,.036,.041));
    if(y<-.12){
      // The right boot meets the narrow accelerator. The left rests on the
      // sloping footrest beside the clutch, with both heels on the carpet.
      for(const {hip,kneeX,kneeZ,ankleX,heelZ,toeX,toeZ} of legs){
        d=Math.max(d,ell(hip,-.327,-.104,.099,.137,.137),
          limb(hip,-.346,-.073,kneeX,-.293,kneeZ,.101,.071),
          ell(kneeX,-.276,kneeZ,.071,.074,.077),
          limb(kneeX,-.282,kneeZ,ankleX,-.532,heelZ,.063,.038),
          limb(ankleX,-.542,heelZ,toeX,-.454,toeZ-.012,.044,.041),
          ell(toeX,-.454,toeZ-.015,.048,.033,.056));
      }
    }
    d=Math.max(d,limb(-.136,.058,-.147,-.184,-.143,.038,.065,.047),
      limb(-.184,-.143,.038,-.140,-.003,.215,.049,.031),ell(-.14,-.003,.226,.037,.040,.040));
    if(x>.045 && y>-.17 && y<.28 && z<.18){
      // Right elbow on the belt moulding. The forearm rolls outward over
      // the sill and the relaxed hand hangs clear of the painted door skin.
      d=Math.max(d,ell(.159,.072,-.149,.073,.068,.072),
        limb(.148,.069,-.148,.391,.148,-.225,.065,.046),
        ell(.391,.145,-.225,.051,.046,.051),
        limb(.391,.148,-.225,.451,.131,-.136,.048,.044),
        limb(.451,.131,-.136,.505,.070,-.020,.044,.030),
        limb(.505,.070,-.020,.523,.006,.022,.030,.032),
        ell(.523,.016,.024,.025,.050,.042),
        limb(.512,.030,.049,.509,-.011,.079,.019,.011),
        limb(.524,-.008,.053,.525,-.056,.064,.013,.008),
        limb(.528,-.011,.031,.530,-.068,.036,.014,.008),
        limb(.531,-.008,.010,.531,-.061,.011,.012,.007),
        limb(.533,-.002,-.010,.529,-.044,-.014,.011,.006));
    }
    // A few narrow curls rise from shoulders and temples. Their ends taper away.
    const h=THREE.MathUtils.clamp((y-.062)/.269,0,1);
    const thread=.021*(1-h)+.007-Math.hypot(side-(.162-.049*h+.027*Math.sin(8.9*h+2.2*z)),
      z-(-.153+.042*Math.sin(7.1*h+2.8*handedness)));
    return Math.max(d,Math.min(thread,y-.060,.330-y));
  };
  const n=nx*ny*nz,field=new Float32Array(n),data=new Uint8Array(n*4);
  for(let z=0,i=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++,i++){
    field[i]=shapeAt(centre.x+half.x*(2*(x+.5)/nx-1),centre.y+half.y*(2*(y+.5)/ny-1),centre.z+half.z*(2*(z+.5)/nz-1));
  }
  const normal=new THREE.Vector3();
  for(let z=0,i=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++,i++){
    normal.set((field[i-(x>0?1:0)]-field[i+(x<nx-1?1:0)])*nx/half.x,
      (field[i-(y>0?nx:0)]-field[i+(y<ny-1?nx:0)])*ny/half.y,
      (field[i-(z>0?nx*ny:0)]-field[i+(z<nz-1?nx*ny:0)])*nz/half.z).normalize();
    data[i*4]=Math.round(255*THREE.MathUtils.clamp(.5+field[i]/.24,0,1));
    data[i*4+1]=Math.round((.5+.5*normal.x)*255);
    data[i*4+2]=Math.round((.5+.5*normal.y)*255);
    data[i*4+3]=Math.round((.5+.5*normal.z)*255);
  }
  const texture=new THREE.Data3DTexture(data,nx,ny,nz);
  texture.format=THREE.RGBAFormat;texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true;
  return texture;
}

function burningEyes(seconds,noiseField){
  const pos=[],uv=[],idx=[];
  for(const sign of [-1,1]){
    const base=pos.length/3;
    for(let j=0;j<=6;j++)for(let i=0;i<=24;i++){
      const x=i/12-1,y=j/3-1,curve=Math.max(0,1-x*x);
      pos.push(sign*.046+.028*x,.232+sign*.008*x+.010*y*curve,
        -.057-.009*x*x-.006*sign*x+.004*curve*(1-y*y));
      uv.push(x,y);
      if(j<6 && i<24){const k=base+j*25+i;idx.push(k,k+1,k+25,k+1,k+26,k+25);}
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(idx);
  const material=new THREE.ShaderMaterial({
    glslVersion:THREE.GLSL3,uniforms:{seconds,noiseField},
    vertexShader:`out vec2 st;flat out float side;
      void main(){st=uv;side=sign(position.x);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`uniform float seconds;uniform highp sampler3D noiseField;
      in vec2 st;flat in float side;out vec4 frag;
      ${firePalette}
      void main(){
        float seed=side<0.?1.73:5.48;
        vec2 n=texture(noiseField,vec3(.42*st.x*side+seed,.27*st.y-.64*seconds,.29*seed)).rg-.5;
        float seam=st.y+.19-.42*n.x-.12*sin(5.*st.x+seed-4.*seconds);
        float heat=.18+.79*exp(-4.2*seam*seam-1.4*st.x*st.x)+.77*n.y;
        frag=vec4(fireColour(heat),1.);
      }`,toneMapped:false,
  });
  const eyes=new THREE.Mesh(geometry,material);eyes.name='Ember eyes';return eyes;
}

export function createDriver(body){
  const figure=new THREE.Group();figure.name='Smoke driver';figure.position.set(.347,.805,-.012);figure.renderOrder=1;
  const quad=new THREE.PlaneGeometry(1,1),slices=new THREE.InstancedBufferGeometry();
  slices.setIndex(quad.index);slices.setAttribute('position',quad.attributes.position);
  slices.boundingSphere=new THREE.Sphere(centre.clone(),half.length());slices.instanceCount=32;
  const uniforms={shape:{value:driverShape()},noiseField:{value:turbulenceTexture()},halfSize:{value:half},volumeCentre:{value:centre},
    eye:{value:new THREE.Vector3()},fromView:{value:new THREE.Matrix4()},seconds:{value:0},
    nearPlane:{value:.13},layers:{value:32},fine:{value:false}};
  const eyes=burningEyes(uniforms.seconds,uniforms.noiseField);figure.add(eyes);
  // The glass samples Three's opaque pass. Custom premultiplied blending here
  // places the smoke behind the windows while depth-testing each individual slice.
  const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader,fragmentShader,uniforms,
    depthWrite:false,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor,toneMapped:false});
  const mist=new THREE.Mesh(slices,material);mist.name='Driver smoke';mist.renderOrder=2;
  const modelView=new THREE.Matrix4();
  mist.onBeforeRender=(renderer,_scene,view)=>{
    modelView.multiplyMatrices(view.matrixWorldInverse,mist.matrixWorld);
    const fromView=uniforms.fromView.value.copy(modelView).invert();
    uniforms.eye.value.setFromMatrixPosition(fromView);uniforms.nearPlane.value=view.near;
    const target=renderer.getRenderTarget(),hd=uniforms.fine.value;
    const m=modelView.elements,depth=-m[14]-m[2]*centre.x-m[6]*centre.y-m[10]*centre.z;
    const dx=Math.abs(m[2]),dy=Math.abs(m[6]),dz=Math.abs(m[10]);
    const extent=dx*half.x+dy*half.y+dz*half.z,upper=dx*upperHalf.x+dy*upperHalf.y+dz*upperHalf.z;
    const thickness=Math.max(0,Math.min(2*extent,depth+extent-view.near));
    const coverage=THREE.MathUtils.clamp((upperHalf.length()/Math.max(view.near,-m[14]))**2*
      view.projectionMatrix.elements[0]*view.projectionMatrix.elements[5],0,1);
    const pixels=target?target.width*target.height:renderer.domElement.width*renderer.domElement.height;
    const close=THREE.MathUtils.smoothstep(coverage*pixels,230000,1800000);
    const layers=THREE.MathUtils.lerp(hd?52:32,hd?32:24,close);
    slices.instanceCount=uniforms.layers.value=Math.max(1,Math.ceil(layers*thickness/(2*upper)));
  };
  figure.add(mist);body.add(figure);
  return {
    setHD(hd){uniforms.fine.value=hd;slices.instanceCount=uniforms.layers.value=hd?52:32;},
    update(time){uniforms.seconds.value=time;}
  };
}
