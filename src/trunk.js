import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function installTrunkAudio(body){
  const rack=new THREE.Group();
  rack.name='Hatch audio system';
  rack.position.set(0,.834,-1.385);
  rack.rotation.x=.12;
  body.add(rack);

  function finish(name,color,roughness,metalness){
    return new THREE.MeshStandardMaterial({name,color,roughness,metalness,emissive:color,emissiveIntensity:.075});
  }
  const carpet=finish('Anthracite carpet',0x454649,.96,0);
  const basket=finish('Cast speaker frames',0x393e40,.42,.52);
  const rubber=finish('Rubber roll surrounds',0x232628,.59,.03);
  const cone=finish('Graphite diaphragms',0x54575b,.45,.18);
  const alloy=finish('Brushed amplifier alloy',0x949a9d,.36,.72);
  const copper=finish('Copper connections',0xa66d3b,.42,.64);
  const led=new THREE.MeshBasicMaterial({name:'Amplifier power LED',color:0xffad4a});
  const batches=new Map();
  function part(material,geometry,x=0,y=0,z=0){
    geometry.translate(x,y,z);
    if(!batches.has(material))batches.set(material,[]);
    batches.get(material).push(geometry.index?geometry.toNonIndexed():geometry);
  }

  // The baffle sits below the hatch glazing. Real cut-outs allow the cones
  // to recess into the box, including when viewed obliquely from the cabin.
  const outline=new THREE.Shape(),w=.463,h=.222,r=.03;
  outline.moveTo(-w+r,-h);outline.lineTo(w-r,-h);outline.quadraticCurveTo(w,-h,w,-h+r);
  outline.lineTo(w,h-r);outline.quadraticCurveTo(w,h,w-r,h);outline.lineTo(-w+r,h);
  outline.quadraticCurveTo(-w,h,-w,h-r);outline.lineTo(-w,-h+r);outline.quadraticCurveTo(-w,-h,-w+r,-h);
  const centres=[-.271,.271];
  for(const x of centres){
    const cut=new THREE.Path();cut.absarc(x,0,.142,0,Math.PI*2,true);outline.holes.push(cut);
  }
  const shell=new THREE.ExtrudeGeometry(outline,{depth:.138,curveSegments:36,bevelEnabled:true,bevelThickness:.002,bevelSize:.002,bevelSegments:2});
  shell.rotateX(-Math.PI/2);shell.translate(0,-.138,0);
  // The baffle is raked toward the front seats, the underside follows the flat boot floor.
  const points=shell.attributes.position;
  for(let i=0;i<points.count;i++)if(points.getY(i)<-.1)points.setY(i,points.getY(i)+Math.tan(rack.rotation.x)*points.getZ(i)-.009);
  shell.computeVertexNormals();
  part(carpet,shell);

  for(const x of centres){
    const turn=(material,profile)=>part(material,new THREE.LatheGeometry(profile.map(([r,y])=>new THREE.Vector2(r,y)),96),x);
    turn(basket,[[.157,-.003],[.158,.004],[.155,.010],[.149,.014],[.135,.014],[.128,.006],[.129,-.01]]);
    turn(alloy,[[.155,.009],[.1535,.0125],[.1515,.0133],[.1505,.0125]]);
    turn(rubber,[[.138,.010],[.134,.015],[.130,.021],[.124,.024],[.118,.022],[.114,.016],[.111,.009]]);
    turn(cone,[[.114,.011],[.107,.007],[.099,.004],[.095,.003],[.094,.005],[.092,.004],
      [.089,.001],[.080,-.004],[.077,-.005],[.075,-.0035],[.073,-.006],[.057,-.019],[.045,-.028],[.034,-.035],[0,-.035]]);
    turn(basket,[[.046,-.025],[.044,-.020],[.038,-.015],[.029,-.010],[.016,-.006],[0,-.005]]);
    for(let i=0;i<8;i++){
      const phi=2*Math.PI*(i+.5)/8;
      const bx=x+.144*Math.sin(phi),bz=.144*Math.cos(phi);
      part(alloy,new THREE.CylinderGeometry(.0045,.0045,.002,6),bx,.014,bz);
      part(rubber,new THREE.CylinderGeometry(.0022,.0022,.0007,6),bx,.0152,bz);
    }
  }

  part(basket,new RoundedBoxGeometry(.188,.033,.297,2,.009),0,.021,-.004);
  for(let i=-5;i<=5;i++){
    part(alloy,new RoundedBoxGeometry(.006,.018,.248,2,.002),i*.014,.043,-.012);
  }
  part(basket,new RoundedBoxGeometry(.126,.006,.050,2,.002),0,.054,-.033);
  part(alloy,new THREE.BoxGeometry(.082,.0015,.0025),0,.0575,-.039);
  part(led,new THREE.CylinderGeometry(.003,.003,.002,12),.045,.058,-.026);
  for(const side of [-1,1]){
    const x=side*.056;
    part(copper,new THREE.BoxGeometry(.022,.016,.023),x,.023,.145);
    const cable=new THREE.CatmullRomCurve3([
      new THREE.Vector3(x,.023,.150),new THREE.Vector3(x+side*.010,.021,.175),
      new THREE.Vector3(x+side*.053,.009,.190),new THREE.Vector3(x+side*.093,.003,.183),
      new THREE.Vector3(x+side*.108,-.001,.168),
    ]);
    part(rubber,new THREE.TubeGeometry(cable,18,.0045,8,false));
  }

  for(const [material,pieces] of batches){
    const mesh=new THREE.Mesh(mergeGeometries(pieces),material);
    mesh.name=material.name;mesh.receiveShadow=true;
    rack.add(mesh);
  }
}
