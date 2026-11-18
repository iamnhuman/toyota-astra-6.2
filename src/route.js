import { Curve, Matrix4, Quaternion, Vector3 } from 'three';

const tau = Math.PI * 2;
const vertical = new Vector3(0, 1, 0);
const basis = new Matrix4();

class AlpineRoad extends Curve {
  getPoint(t, out = new Vector3()) {
    const a = t * tau;
    return out.set(
      325 * (1 - Math.cos(a)) + 28 * (1 - Math.cos(2 * a)),
      3.7 * Math.sin(2 * a) + 1.8 * Math.sin(a) + 0.54 * Math.sin(5 * a),
      325 * Math.sin(a) + 22 * Math.sin(2 * a) - 7 * Math.sin(3 * a),
    );
  }
}

const curve = new AlpineRoad();
curve.arcLengthDivisions = 3000;
export const length = curve.getLength();
export const bays = 256;
export const span = length / bays;
export const start = span * 9 + 1.8;
export const lane = 1.95;
const canopyLengths = [9, 14, 11, 16, 8, 12, 9, 13];
export const wrap = (s) => ((s % length) + length) % length;

export function covered(bay) {
  const i = ((bay % bays) + bays) % bays;
  return i % 32 < canopyLengths[Math.floor(i / 32)];
}

export function frameAt(s) {
  const fraction = wrap(s) / length;
  const center = curve.getPointAt(fraction);
  const forward = curve.getTangentAt(fraction).normalize();
  const lateral = new Vector3().crossVectors(vertical, forward).normalize();
  const bank = -0.012 + 0.015 * Math.sin(fraction * tau * 3);
  lateral.applyAxisAngle(forward, bank);
  const up = new Vector3().crossVectors(forward, lateral).normalize();
  const rotation = new Quaternion().setFromRotationMatrix(basis.makeBasis(lateral, up, forward));
  return {
    center, forward, lateral, up, rotation,
    point(x, y = 0, z = 0) {
      return center.clone().addScaledVector(lateral, x).addScaledVector(up, y).addScaledVector(forward, z);
    },
  };
}

export function terrainHeight(s, x) {
  const a = wrap(s) / length * tau;
  const d = Math.max(0, Math.abs(x) - 5.0);
  const relief = Math.min(1, d / 15) *
    (1.6 * Math.sin(15 * a + x * .11) + .83 * Math.sin(31 * a - x * .22) + .42 * Math.cos(72 * a + x * .4));
  if (x < 0) {
    return -.25 + Math.min(31, d * (.40 + .17 * Math.sin(a * 4))) + relief;
  }
  return -.26 - Math.min(37, d * (.30 + .11 * Math.sin(a * 5))) + relief;
}

export function frameForCar(s, seconds) {
  const frame = frameAt(s);
  const wander = .095 * Math.sin(s * .020) + .033 * Math.sin(seconds * .71);
  const position = frame.point(lane + wander);
  return { ...frame, position };
}
