import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { createCamera } from '../src/camera.js';
import { frameForCar, start } from '../src/route.js';

const still = { position: new Vector3(), rotation: new Quaternion(), up: new Vector3(0, 1, 0) };
const identity = new Matrix4();
const unitScale = new Vector3(1, 1, 1);

function newRig() {
  return createCamera({ addEventListener() {} }, () => {});
}

test('a cabin pass has the same pose and lens at different frame rates on a vibrating chassis', () => {
  const fixed = newRig(), moving = newRig();
  const rig = new Matrix4(), suspension = new Matrix4(), body = new Matrix4();
  const cameraInBody = new Matrix4(), vibration = new Vector3(), roll = new Quaternion();
  const forward = new Vector3(0, 0, 1);
  const referenceStep = 1 / 120;
  const frameSteps = [2, 4, 5, 3];
  const aspect = 16 / 9;
  for (const controller of [fixed, moving]) {
    controller.place(still, 0, 0, aspect, undefined, identity, identity);
    controller.toggleFlight();
  }

  let tick = 0, frame = 0, passages = 0, inside = false;
  while (tick * referenceStep < 135 && (passages < 4 || inside)) {
    const steps = frameSteps[frame++ % frameSteps.length];
    for (let i = 0; i < steps; i++) {
      tick++;
      fixed.place(still, tick * referenceStep, referenceStep, aspect, undefined, identity, identity);
    }
    const time = tick * referenceStep;
    const road = frameForCar(start + 21 * time, time);
    rig.compose(road.position, road.rotation, unitScale);
    vibration.set(0, -.043 + .009 * Math.sin(20 * time), 0);
    roll.setFromAxisAngle(forward, .035 * Math.sin(17 * time));
    body.multiplyMatrices(rig, suspension.compose(vibration, roll, unitScale));
    moving.place(road, time, steps * referenceStep, aspect, undefined, rig, body);

    const p = fixed.camera.position;
    const inCabin = Math.abs(p.x) < .65 && p.y > .85 && p.y < 1.16 && p.z > -.92 && p.z < .70;
    if (inCabin && !inside) passages++;
    inside = inCabin;
    if (!inCabin) continue;
    moving.camera.updateMatrixWorld();
    fixed.camera.updateMatrixWorld();
    cameraInBody.copy(body).invert().multiply(moving.camera.matrixWorld);
    for (let i = 0; i < 16; i++) {
      assert.ok(Math.abs(cameraInBody.elements[i] - fixed.camera.matrixWorld.elements[i]) < 1e-8);
    }
    assert.ok(Math.abs(moving.camera.fov - fixed.camera.fov) < 1e-8);
  }
  assert.equal(passages, 4);
});

test('switching from manual framing to the tour preserves the first frame', () => {
  for (const aspect of [2.62, 16 / 9, 9 / 19]) {
    const rig = newRig();
    rig.place(still, 0, 1, aspect, undefined, identity, identity);
    const before = rig.camera.clone();
    rig.toggleFlight();
    rig.place(still, 0, 0, aspect, undefined, identity, identity);
    assert.ok(before.position.distanceTo(rig.camera.position) < 1e-8);
    assert.ok(before.quaternion.angleTo(rig.camera.quaternion) < 1e-7);
    for (let i = 0; i < 16; i++) {
      assert.ok(Math.abs(before.projectionMatrix.elements[i] - rig.camera.projectionMatrix.elements[i]) < 1e-8);
    }
  }
});
