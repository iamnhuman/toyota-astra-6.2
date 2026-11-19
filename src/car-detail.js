import * as THREE from 'three';

const tau=2*Math.PI;
function circle(path,x,y,r,segments,winding=1){
  for(let i=0;i<segments;i++){
    const angle=winding*tau*i/segments,px=x+r*Math.cos(angle),py=y+r*Math.sin(angle);
    if(i===0)path.moveTo(px,py);else path.lineTo(px,py);
  }
  path.closePath();
}

// The original disc face sits 79.8 mm inboard of the wheel origin. Cut a new
// friction surface directly over it, with bevelled recesses behind the spokes.
function brakeRotor(){
  const face=new THREE.Shape(),centre=new THREE.Path();
  circle(face,0,0,.171,112,-1);circle(centre,0,0,.103,80);face.holes.push(centre);
  const bores=[],count=10,rim=.0034,inside=.00245;
  for(let spoke=0;spoke<15;spoke++)for(let row=0;row<3;row++){
    const angle=tau*spoke/15+row*.056,r=.116+.021*row;
    const x=r*Math.cos(angle),y=r*Math.sin(angle),hole=new THREE.Path();
    circle(hole,x,y,rim,count);face.holes.push(hole);bores.push([x,y]);
  }
  const geometry=new THREE.ShapeGeometry(face),pos=Array.from(geometry.attributes.position.array);
  const indices=Array.from(geometry.index.array),colour=[];
  for(let i=0;i<pos.length/3;i++)colour.push(.49,.49,.47);
  for(const [x,y] of bores){
    const start=pos.length/3;
    pos.push(x,y,-.0014);colour.push(.012,.013,.014);
    for(let i=0;i<count;i++){
      const a=tau*i/count,c=Math.cos(a),s=Math.sin(a);
      pos.push(x+rim*c,y+rim*s,0,x+inside*c,y+inside*s,-.0014);
      colour.push(.25,.25,.24,.022,.024,.026);
      const outer=start+1+2*i,next=start+1+2*((i+1)%count);
      indices.push(outer,next,outer+1,next,next+1,outer+1,start,outer+1,next+1);
    }
  }
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geometry.deleteAttribute('uv');geometry.deleteAttribute('normal');
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colour,3));
  geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
  return new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({name:'Machined rotor',vertexColors:true,metalness:.78,roughness:.38}));
}

const dialAngle=bar=>THREE.MathUtils.degToRad(220-(bar+1)*260/3);
function boostGauge(body){
  const pod=new THREE.Group();
  pod.name='Boost gauge';pod.position.set(.527,.959,.447);
  pod.lookAt(.347,1.023,-.177);body.add(pod);
  const casing=new THREE.MeshStandardMaterial({color:0x252627,roughness:.53,metalness:.38});
  const silver=new THREE.MeshStandardMaterial({color:0xa8acaa,roughness:.24,metalness:.91});
  const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.036,.031,.039,64),casing);
  barrel.rotation.x=Math.PI/2;barrel.position.z=-.0195;pod.add(barrel);
  const bezel=new THREE.Mesh(new THREE.TorusGeometry(.0327,.0023,12,72),silver);pod.add(bezel);

  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
  const ctx=canvas.getContext('2d'),cx=256;
  ctx.fillStyle='#17191b';ctx.fillRect(0,0,512,512);
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineCap='round';
  for(let i=0;i<=30;i++){
    const a=dialAngle(-1+i/10),major=i%5===0,red=i>=26;
    const x=Math.cos(a),y=-Math.sin(a),inner=major?178:195;
    ctx.strokeStyle=red?'#bf6958':'#d8d6c9';ctx.lineWidth=major?6:3;
    ctx.beginPath();ctx.moveTo(cx+inner*x,cx+inner*y);ctx.lineTo(cx+210*x,cx+210*y);ctx.stroke();
    if(major){
      ctx.fillStyle=red?'#bf6958':'#d8d6c9';ctx.font='bold 26px sans-serif';
      ctx.fillText(String(-1+i/10),cx+150*x,cx+150*y);
    }
  }
  ctx.fillStyle='#c9c8b8';ctx.font='bold 33px sans-serif';ctx.fillText('TURBO',cx,310);
  ctx.font='23px sans-serif';ctx.fillText('bar',cx,344);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const face=new THREE.Mesh(new THREE.CircleGeometry(.0316,64),new THREE.MeshStandardMaterial({
    map:texture,roughness:.68,emissiveMap:texture,emissive:0xffffff,emissiveIntensity:.36,
  }));
  face.position.z=.0005;pod.add(face);
  const needle=new THREE.Group(),pointer=new THREE.Shape();
  pointer.moveTo(-.005,-.0014);pointer.lineTo(.024,0);pointer.lineTo(-.005,.0014);pointer.closePath();
  needle.add(new THREE.Mesh(new THREE.ShapeGeometry(pointer),new THREE.MeshStandardMaterial({
    color:0xf38c59,emissive:0xa24527,emissiveIntensity:.24,roughness:.48,side:THREE.DoubleSide,
  })));
  needle.position.z=.0013;pod.add(needle);
  const pin=new THREE.Mesh(new THREE.CircleGeometry(.0030,28),casing);pin.position.z=.0020;pod.add(pin);
  return {pod,needle};
}

export function makeCarDetail(body,wheels){
  const {pod,needle}=boostGauge(body),template=brakeRotor(),parts=[pod];
  for(const {hub,spin,code} of wheels){
    const rotor=template.clone(),side=Math.sign(hub.position.x);
    rotor.name='Drilled brake rotor '+code;rotor.position.x=side*(-.0776);
    rotor.rotation.y=side*Math.PI/2;rotor.receiveShadow=true;spin.add(rotor);parts.push(rotor);
  }
  return {parts,
    update(speed,acceleration){
      needle.rotation.z=dialAngle(THREE.MathUtils.clamp(.20+.075*(speed-19.2)+.64*acceleration,-.75,1.48));
    },
  };
}
