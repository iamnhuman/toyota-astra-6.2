import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

export const sunDirection = new THREE.Vector3(.599416, .669852, .438176).normalize();

export async function loadLocation(renderer, manager) {
  const loader = new THREE.TextureLoader(manager);
  const maxAnisotropy = Math.min(12, renderer.capabilities.getMaxAnisotropy());
  async function texture(file, color, repeat) {
    const map = await loader.loadAsync('/' + file);
    map.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    map.anisotropy = maxAnisotropy;
    if (repeat) {
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.setScalar(repeat);
    }
    return map;
  }
  const [roadColor, roadNormal, roadARM, concreteColor, concreteNormal, hillside, pine, sky, radiance] =
    await Promise.all([
      texture('road/asphalt.webp', true, .25), texture('road/asphalt-normal.webp', false, .25),
      texture('road/asphalt-arm.webp', false, .25), texture('road/concrete.webp', true, 1),
      texture('road/concrete-normal.webp', false, 1), texture('road/hillside.webp', true, 1),
      texture('road/spruce.webp', true, 0), texture('light/alps-log.webp', false, 0),
      new HDRLoader(manager).loadAsync('/light/alps-ibl.hdr'),
    ]);
  const road = new THREE.MeshStandardMaterial({
    map: roadColor, color: 0xbdbbb8, roughnessMap: roadARM, roughness: .98,
    normalMap: roadNormal, normalScale: new THREE.Vector2(.38, .38),
  });
  road.name = 'Weathered asphalt';
  road.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec2 roadMetres;\n' + shader.vertexShader.replace(
      '#include <uv_vertex>', '#include <uv_vertex>\nroadMetres = uv;',
    );
    shader.fragmentShader = 'varying vec2 roadMetres;\n' + shader.fragmentShader.replace(
      '#include <map_fragment>', `#include <map_fragment>
       float crossroad = abs(roadMetres.x);
       float along = roadMetres.y;
       float aa = max(.003, fwidth(roadMetres.x) * .7);
       float edge = 1. - smoothstep(.055-aa, .055+aa, abs(crossroad-4.08));
       float dash = 1. - smoothstep(.063-aa, .063+aa, crossroad);
       float phase = abs(mod(along + .75, 10.6) - 2.1);
       float dashAA = max(.02, fwidth(along)*.8);
       dash *= 1. - smoothstep(1.95-dashAA, 1.95+dashAA, phase);
       float detail = dot(texture2D(map, vMapUv*3.19 + .34).rgb, vec3(.3,.52,.18));
       float macro = texture2D(map, roadMetres.yx * vec2(.014,.067) + .16).g;
       float tracks = exp(-7.0*pow(crossroad-1.20, 2.)) + exp(-7.0*pow(crossroad-2.72,2.));
       diffuseColor.rgb *= (.84 + .52*macro) * (1.0-.18*tracks);
       float pigment = max(edge,dash) * (.42+.49*smoothstep(.052,.31,detail));
       diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.64,.637,.56), pigment);
      `,
    );
  };
  const concrete = new THREE.MeshStandardMaterial({
    name: 'Board-formed concrete', map: concreteColor, normalMap: concreteNormal,
    normalScale: new THREE.Vector2(.31,.31), roughness: .90, vertexColors: true,
    side: THREE.DoubleSide,
  });
  const castConcrete = concrete.clone();
  castConcrete.name = 'Cast structural concrete';
  castConcrete.vertexColors = false;
  const darkConcrete = castConcrete.clone();
  darkConcrete.name = 'Canopy underside';
  darkConcrete.color.set(0xa1a39c);
  const earth = new THREE.MeshStandardMaterial({
    name: 'Rock and grass', map: hillside, roughness: .97, vertexColors: true,
    side: THREE.DoubleSide,
  });
  const steel = new THREE.MeshStandardMaterial({
    name: 'Galvanised steel', color: 0xa1a7a6, metalness: .73, roughness: .38, side: THREE.DoubleSide,
  });
  const darkMetal = new THREE.MeshStandardMaterial({
    name: 'Oxidised fittings', color: 0x444949, metalness: .66, roughness: .57,
  });
  const enamel = new THREE.MeshStandardMaterial({ name:'Guide post', color:0xe0dfd3, roughness:.53 });
  const amber = new THREE.MeshStandardMaterial({
    name: 'Road reflector', color: 0xd48a35, emissive: 0x492008, emissiveIntensity: .25, roughness: .24,
  });
  const lamp = new THREE.MeshStandardMaterial({
    name: 'Gallery lamps', color: 0xe6dac3, emissive: 0xffe6bf, emissiveIntensity: 2.2, roughness: .2,
  });
  const foliage = new THREE.MeshStandardMaterial({
    name: 'Alpine spruce', map: pine, alphaTest: .38, side: THREE.DoubleSide,
    roughness: 1, color: 0xa2aea1, vertexColors: true,
  });
  foliage.shadowSide = THREE.DoubleSide;
  radiance.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(radiance);
  pmrem.dispose();
  radiance.dispose();
  return { materials: { road, concrete, castConcrete, darkConcrete, earth, steel, darkMetal, enamel, amber, lamp, foliage },
    sky, environment: env };
}

// The sphere follows the viewing direction only. The main camera and the
// vehicle's reflection probe see the same registered HDR panorama.
export function skyDome(map) {
  const material = new THREE.ShaderMaterial({
    uniforms: { panorama: { value: map } },
    side: THREE.BackSide, depthWrite: false,
    vertexShader: `
      varying vec3 ray;
      void main() {
        ray = position;
        vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.);
        gl_Position = clip.xyww;
      }`,
    fragmentShader: `
      uniform sampler2D panorama;
      varying vec3 ray;
      void main() {
        vec3 d = normalize(ray);
        vec2 uv = vec2(atan(d.z,d.x) * .159154943 + .5, asin(clamp(d.y,-1.,1.)) * .318309886 + .5);
        vec3 hdr = (exp2(texture2D(panorama,uv).rgb * 8.) - 1.) / 16.;
        gl_FragColor = vec4(hdr,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 64, 36), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return mesh;
}
