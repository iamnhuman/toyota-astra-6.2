import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Cross-sections are drawn in the width/depth plane of the bar. +Z faces the car.
function extrusion(profile, length) {
  const shape = new THREE.Shape(profile.map(([y, z]) => new THREE.Vector2(-z, y)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false });
  return geometry.rotateY(Math.PI / 2).translate(-length / 2, 0, 0);
}

function chassis(length, width, material) {
  const pieces = [];
  function add(geometry, hex, x = 0, y = 0, z = 0) {
    const part = geometry.index ? geometry.toNonIndexed() : geometry;
    part.translate(x, y, z);
    part.deleteAttribute('uv');
    const colour = new THREE.Color(hex);
    const colours = new Float32Array(3 * part.attributes.position.count);
    for (let i = 0; i < colours.length; i += 3) colour.toArray(colours, i);
    part.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    pieces.push(part);
  }

  const half = width / 2, outer = half + .021;
  const side = [[half, .012], [half, .040], [half + .005, .046], [outer - .004, .046],
    [outer, .040], [outer, .014], [outer - .003, .011], [outer - .003, .004],
    [outer, .001], [outer, -.024], [outer - .008, -.034]];
  const profile = [...side];
  const fins = width >= .15 ? 5 : 3;
  const finPitch = (width + .012) / fins;
  for (let i = 0; i < fins; i++) {
    const y = (.5 * (fins - 1) - i) * finPitch;
    profile.push([y + .006, -.034], [y + .0036, -.062], [y - .0036, -.062], [y - .006, -.034]);
  }
  profile.push(...side.slice().reverse().map(([y, z]) => [-y, z]));
  add(extrusion(profile, length), 0x48505a);
  for (const sign of [-1, 1]) {
    // Machined bevel beside the opal cover.
    const lip = [[half, .039], [half + .005, .0464], [half + .009, .0464], [half + .005, .042]];
    add(extrusion(lip.map(([y, z]) => [y * sign, z]), length), 0xabb5be);
    const x = sign * (length / 2 + .022);
    add(new RoundedBoxGeometry(.052, 2 * outer + .007, .110, 2, .009), 0x343b45, x, 0, -.006);
    for (const y of [-outer + .017, outer - .017]) {
      add(new THREE.CylinderGeometry(.008, .008, .0026, 12).rotateX(Math.PI / 2), 0xb1b8bf, x, y, .050);
      add(new THREE.CylinderGeometry(.0035, .0035, .001, 6).rotateX(Math.PI / 2), 0x20242b, x, y, .0516);
    }
  }

  // Open-backed mounting saddles leave a visible gap behind the cooling fins.
  const edge = outer + .007;
  const saddle = [[edge - .007, -.012], [edge, -.012], [edge, -.105], [edge - .011, -.117],
    [-edge + .011, -.117], [-edge, -.105], [-edge, -.012], [-edge + .007, -.012],
    [-edge + .007, -.101], [-edge + .015, -.110], [edge - .015, -.110], [edge - .007, -.101]];
  for (const x of [-.32 * length, .32 * length]) {
    add(extrusion(saddle, .075), 0x68717b, x);
    for (const sign of [-1, 1]) {
      add(new THREE.CylinderGeometry(.012, .012, .007, 6), 0x919aa3, x, sign * (edge + .002), -.023);
    }
  }
  const housing = new THREE.Mesh(mergeGeometries(pieces), material);
  housing.name = 'Anodised LED channel';
  return housing;
}

// The opal face runs between both end caps. Light rolls off across its curved
// shoulders while the full central span emits uniformly.
function diffuserGeometry(length, width) {
  const halfLength = length / 2 - .006, halfWidth = width / 2 - .002;
  const radius = .014, rows = 24;
  const geometry = new THREE.PlaneGeometry(1, 1, 3, rows);
  const positions = geometry.getAttribute('position');
  const colours = new THREE.BufferAttribute(new Float32Array(positions.count * 3), 3);
  for (let row = 0; row <= rows; row++) {
    const across = 1 - 2 * row / rows;
    const y = across * halfWidth;
    const corner = Math.max(0, Math.abs(y) - (halfWidth - radius));
    const end = halfLength - radius + Math.sqrt(Math.max(0, radius * radius - corner * corner));
    const z = .013 - .017 * across * across;
    const shoulder = THREE.MathUtils.smoothstep(Math.abs(across), .48, 1);
    const transmission = THREE.MathUtils.lerp(.40, .035, shoulder);
    const span = [-end, -end + .026, end - .026, end];
    for (const [column, x] of span.entries()) {
      const vertex = row * span.length + column;
      positions.setXYZ(vertex, x, y, z);
      const light = transmission * (column === 0 || column === span.length - 1 ? .78 : 1);
      colours.setXYZ(vertex, light, light, light);
    }
  }
  geometry.setAttribute('color', colours);
  geometry.computeVertexNormals();
  return geometry;
}

export function createLEDFixture(length, width, tint, intensity, metal) {
  const housing = chassis(length, width, metal);
  const optics = new THREE.Mesh(diffuserGeometry(length, width), new THREE.MeshBasicMaterial({
    name: 'Opal LED diffuser', color: new THREE.Color(tint).multiplyScalar(intensity),
    vertexColors: true, toneMapped: false,
  }));
  optics.name = 'LED diffuser';
  optics.position.z = .030;
  optics.layers.enable(1);
  return { housing, optics };
}
