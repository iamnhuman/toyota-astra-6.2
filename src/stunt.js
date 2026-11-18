import { covered, span } from './route.js';

const preload = .14, settle = .42;
const fullTurn = 2 * Math.PI;
const clamp01 = n => Math.min(1, Math.max(0, n));
export const idleMotion = Object.freeze({ lift:0, angle:0, spring:0, framing:0, tight:false, active:false });

// The open road allows an end-over-end flip. Under a gallery the same jump
// rolls diagonally, leaving clearance under the 4.48 m crossbeams.
function crossesGallery(distance, speed) {
  const from = distance - 2.7;
  const to = distance + (speed + 1.2) * (preload + 1.62) + 2.7;
  for (let bay = Math.floor(from / span); bay <= Math.floor(to / span); bay++) {
    if (covered(bay) || (covered(bay - 1) && bay * span + .42 >= from)) return true;
  }
  return false;
}

export function createStunt() {
  const motion = { ...idleMotion };
  let start = 0;
  return {
    start(time, distance, speed) {
      if (motion.active) return false;
      start = time;
      motion.active = true;
      motion.tight = crossesGallery(distance, speed);
      return true;
    },
    at(time) {
      if (!motion.active) return motion;
      const age = Math.max(0, time - start);
      const airtime = motion.tight ? 1.27 : 1.62;
      const phase = clamp01((age - preload) / airtime);
      const arc = 4 * phase * (1 - phase);
      motion.lift = arc * (motion.tight ? 1.77 : 3.09);
      motion.angle = phase === 1 ? 0 : -fullTurn * phase + .84 * Math.sin(fullTurn * phase);
      motion.framing = arc;
      if (age < preload) {
        motion.spring = -.043 * Math.sin(Math.PI * age / preload) ** 2;
      } else if (phase < 1) {
        motion.spring = .018 * arc;
      } else {
        const t = clamp01((age - preload - airtime) / settle);
        motion.spring = -.111 * Math.sin(2.6 * Math.PI * t) * Math.exp(-4.1 * t) * (1 - t);
        motion.active = t < 1;
      }
      return motion;
    },
  };
}
