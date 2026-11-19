import * as THREE from 'three';

// Four independent, seamless noise channels. The GPU samples this volume
// with trilinear filtering, including when the camera moves through a wisp.
function makeTurbulence(size = 48) {
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

let shared;
export function turbulenceTexture(){
  return shared ??= makeTurbulence();
}
