import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bays, covered, frameAt, length, span, terrainHeight, wrap } from './route.js';

const unit = new THREE.Vector3(1, 1, 1);

function buffer(positions, uv, indices, colors, normals) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (colors?.length) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  if (normals) g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  else g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function mesh(group, geometry, material, casts = false) {
  const m = new THREE.Mesh(geometry, material);
  m.name = material.name;
  m.castShadow = casts;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

// Profiles follow the bank and grade of the road. Each band has metre-based
// UVs, including the curved asphalt, the formed curb and the W-beam barrier.
function ribbon(group, material, from, to, steps, profile, mapping, casts = false) {
  const positions = [], uv = [], colors = [], indices = [];
  for (let row = 0; row <= steps; row++) {
    const s = THREE.MathUtils.lerp(from, to, row / steps), frame = frameAt(s);
    const points = typeof profile === 'function' ? profile(s) : profile;
    let profileDistance = 0;
    points.forEach(([x, y, shade = 1], column) => {
      positions.push(...frame.point(x, y).toArray());
      if (column) profileDistance += Math.hypot(x - points[column-1][0], y - points[column-1][1]);
      if (mapping === 'road') uv.push(x, s);
      else if (mapping === 'ground') uv.push(x / 7.1, s / 7.1);
      else uv.push(s / 3.1, profileDistance / 2.25);
      colors.push(shade, shade, shade);
      if (row < steps && column < points.length - 1) {
        const a = row * points.length + column, b = a + points.length;
        indices.push(a, b, a+1, b, b+1, a+1);
      }
    });
  }
  return mesh(group, buffer(positions, uv, indices, colors), material, casts);
}

function random(seed) {
  return () => ((seed = (Math.imul(1664525, seed) + 1013904223) | 0) >>> 0) / 4294967296;
}

function spruceSlope(group, from, to, material, seed) {
  const rng = random(seed), p = [], uv = [], color = [], normals = [], idx = [];
  for (let i = 0; i < 108; i++) {
    const s = from + (to - from) * rng(), side = rng() < .42 ? -1 : 1;
    const across = side * (11 + Math.pow(rng(), .83) * 61);
    const f = frameAt(s), root = f.point(across, terrainHeight(s, across) - .35);
    const height = (4.6 + rng() * 8.5) * (side < 0 ? .81 : 1);
    const width = height * (.42 + rng() * .09), angle = rng() * Math.PI;
    const variant = Math.floor(rng() * 4), tint = .76 + rng() * .23;
    const x0 = variant * .25 + .001, x1 = (variant+1) * .25 - .001;
    for (let card = 0; card < 2; card++) {
      const a = angle + card * Math.PI / 2, dx = Math.cos(a) * width * .5, dz = Math.sin(a) * width * .5;
      const base = p.length / 3;
      p.push(root.x-dx,root.y,root.z-dz, root.x+dx,root.y,root.z+dz,
        root.x-dx,root.y+height,root.z-dz, root.x+dx,root.y+height,root.z+dz);
      uv.push(x0,0,x1,0,x0,1,x1,1);
      for (let n=0; n<4; n++) {
        const brightness = tint * (n < 2 ? .70 : 1);
        color.push(brightness, brightness, brightness);
        normals.push(Math.cos(a)*(n%2 ? .32 : -.32), .946, Math.sin(a)*(n%2 ? .32 : -.32));
      }
      idx.push(base,base+1,base+2,base+2,base+1,base+3);
    }
  }
  mesh(group,buffer(p,uv,idx,color,normals),material,true);
}

function concreteBlock(w, h, d, bevel = 0) {
  const g = bevel ? new RoundedBoxGeometry(w,h,d,1,bevel) : new THREE.BoxGeometry(w,h,d);
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i=0; i<p.count; i++) {
    const nx=Math.abs(n.getX(i)),ny=Math.abs(n.getY(i)),nz=Math.abs(n.getZ(i));
    if (ny >= nx && ny >= nz) uv.setXY(i,p.getX(i)/2.2,p.getZ(i)/2.2);
    else if (nx >= nz) uv.setXY(i,p.getZ(i)/2.2,p.getY(i)/2.2);
    else uv.setXY(i,p.getX(i)/2.2,p.getY(i)/2.2);
  }
  return g;
}

export function buildRoad(materials) {
  const world = new THREE.Group(), sectors = [];
  const shapes = {
    pillar:[concreteBlock(.76,4.56,.76,.055), materials.castConcrete, true],
    foot:[concreteBlock(1.05,.40,1.12,.035), materials.castConcrete, true],
    crossbeam:[concreteBlock(12.04,.40,.48,.035), materials.darkConcrete, true],
    wallJoint:[new THREE.BoxGeometry(.025,2.60,.030), materials.darkMetal],
    pipe:[new THREE.CylinderGeometry(.075,.075,4.30,12), materials.darkMetal],
    bracket:[new THREE.BoxGeometry(.115,.034,.24), materials.steel],
    railPost:[new THREE.BoxGeometry(.091,.78,.145), materials.steel, true],
    reflector:[new THREE.BoxGeometry(.15,.062,.045), materials.amber],
    stud:[new THREE.SphereGeometry(.030,8,5), materials.steel],
    bollard:[concreteBlock(.137,.76,.116,.017), materials.enamel, true],
    collar:[new THREE.BoxGeometry(.141,.125,.12), materials.darkMetal],
    housing:[concreteBlock(.38,.12,1.55,.035), materials.darkMetal],
    tube:[concreteBlock(.17,.034,1.31,.015), materials.lamp],
    grate:[new THREE.BoxGeometry(.32,.022,.56), materials.darkMetal],
    grateBar:[new THREE.BoxGeometry(.30,.02,.018), materials.steel],
  };
  const reliefX = [-115,-80,-56,-40,-30,-21,-15,-11,-8.0,-6.5,-5.18];
  const valleyX = [4.79,5.5,7.2,9.7,13,18,24,32,43,58,79,112];
  const terrain = xs => s => xs.map(x => [x,terrainHeight(s,x), .80 + .12*Math.sin(.13*x + .036*s) + .07*Math.cos(.078*s - .27*x)]);
  for (let sector=0; sector<bays/8; sector++) {
    const group = new THREE.Group(), first = sector*8, from=first*span, to=(first+8)*span;
    const transforms = new Map();
    function place(name, frame, x, y, z=0, rotation=null) {
      const q = rotation ? frame.rotation.clone().multiply(rotation) : frame.rotation;
      const matrix = new THREE.Matrix4().compose(frame.point(x,y,z), q, unit);
      if (!transforms.has(name)) transforms.set(name, []);
      transforms.get(name).push(matrix);
    }
    ribbon(group,materials.road,from,to,32,[[-5.24,-.015],[-4.4,0],[0,.012],[4.4,0],[4.93,-.016]],'road');
    ribbon(group,materials.earth,from,to,32,terrain(reliefX),'ground');
    ribbon(group,materials.earth,from,to,32,terrain(valleyX),'ground');
    ribbon(group,materials.concrete,from,to,25,[[-5.65,.19,.87],[-5.19,.19,1],[-5.13,.15,.95],[-5.13,-.02,.48]],'structure');
    ribbon(group,materials.concrete,from,to,25,[[4.48,-.02,.50],[4.48,.105,.79],[4.52,.15,1],[5.34,.15,.96],[5.37,-.36,.64]],'structure');
    const rail = [[4.89,.44],[4.82,.49],[4.84,.53],[4.93,.60],[4.84,.67],[4.82,.72],[4.91,.77]];
    ribbon(group,materials.steel,from,to,32,rail,'structure',true);
    for (let bay=first; bay<first+8; bay++) {
      const s=bay*span, end=s+span, f=frameAt(s+.12);
      const roof=covered(bay), previous=covered(bay-1);
      const wallHeight=roof ? 4.93 : 2.65;
      ribbon(group,materials.concrete,s,end,3,[[-6.33,-.10,.42],[-6.33,wallHeight-.10,.97],[-6.42,wallHeight,1],[-6.90,wallHeight,.93]],'structure',true);
      place('wallJoint',f,-6.305,1.45);
      if(roof) {
        ribbon(group,materials.concrete,s,end,3,[[-6.9,5.42,1],[5.83,5.42,1],[5.89,5.36,1],[5.89,4.92,.71],[5.77,4.86,.67],[-6.72,4.86,.57]],'structure',true);
        place('crossbeam',f,-.34,4.68);
        place('pillar',f,5.39,2.49);
        place('foot',f,5.39,.27);
        if(bay%3===1) {
          place('housing',f,-1.15,4.78,span*.46);
          place('tube',f,-1.15,4.70,span*.46);
          place('pipe',f,-6.15,2.36,1.60);
          for(const y of [.74,2.35,3.95]) place('bracket',f,-6.21,y,1.60);
        }
      } else if(previous) {
        place('pillar',f,5.39,2.49);place('foot',f,5.39,.27);place('crossbeam',f,-.34,4.68);
      }
      for(let j=0;j<3;j++){
        const post=frameAt(s+j*span/3);
        place('railPost',post,5.02,.45);place('stud',post,4.815,.53);
      }
      if(bay%2===0) {
        place('bollard',f,5.17,.51,2.4);place('collar',f,5.17,.76,2.4);
        place('reflector',f,4.81,.67,1.75);
      }
      if(bay%3===0) {
        place('grate',f,-4.96,.008,2);
        for(let j=0;j<8;j++)place('grateBar',f,-4.96,.020,1.78+j*.058);
      }
    }
    for(const [name,list] of transforms) {
      const [geometry,material,casts=false]=shapes[name];
      const instances=new THREE.InstancedMesh(geometry,material,list.length);
      list.forEach((matrix,i)=>instances.setMatrixAt(i,matrix));
      instances.name=name;instances.computeBoundingSphere();
      instances.receiveShadow=true;instances.castShadow=casts;group.add(instances);
    }
    const structuralBands=group.children.filter(o=>!o.isInstancedMesh && o.material===materials.concrete && o.castShadow);
    if(structuralBands.length>1){
      const combined=mergeGeometries(structuralBands.map(o=>o.geometry));
      for(const o of structuralBands){group.remove(o);o.geometry.dispose();}
      mesh(group,combined,materials.concrete,true);
    }
    spruceSlope(group,from,to,materials.foliage,237+sector*1647);
    sectors.push({group,mid:(from+to)*.5});world.add(group);
  }
  return {
    world,
    update(s, reach=270) {
      const station=wrap(s);
      for (const {group,mid} of sectors) {
        const d=Math.abs(mid-station);
        group.visible=Math.min(d,length-d)<reach+span*4;
      }
    },
  };
}
