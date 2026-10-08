import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { measurementLabelProjection } from '../src/measurement-label-projection';
import type { Vector3 } from '../src/groups';

const size: [number, number] = [1000, 700];
const labelSize: [number, number] = [3, 1.2];
const u: Vector3 = [1, 0, 0], v: Vector3 = [0, 1, 0];
function perspective() {
  const camera = new THREE.PerspectiveCamera(42, size[0] / size[1], .01, 100);
  camera.updateMatrixWorld();
  return camera;
}

test('zoomed-in offscreen labels cannot send an oversized affine transform to SVG', () => {
  const camera = perspective(), p: Vector3 = [5, 0, -.011];
  const projected = new THREE.Vector3(...p).project(camera);
  assert.ok(projected.x > 800 && Math.abs(projected.z) < 1, 'center passes the former depth-only guard');
  assert.equal(measurementLabelProjection(p, u, [0, Math.sqrt(3) / 2, -.5], labelSize, camera, size), null);
});

test('labels crossing either clipping plane are hidden even when their center is visible', () => {
  const camera = perspective();
  for (const z of [-.2, -99.8]) {
    const p: Vector3 = [0, 0, z];
    assert.ok(Math.abs(new THREE.Vector3(...p).project(camera).z) < 1);
    assert.equal(measurementLabelProjection(p, u, [0, Math.sqrt(3) / 2, -.5], labelSize, camera, size), null);
  }
});

test('labels completely outside every side of the view, behind the camera or beyond depth range are hidden', () => {
  const camera = perspective();
  for (const p of [[100, 0, -10], [-100, 0, -10], [0, 100, -10], [0, -100, -10], [100, 100, -10], [0, 0, 10], [0, 0, -200], [0, 0, -.005]] as Vector3[]) {
    assert.equal(measurementLabelProjection(p, u, v, labelSize, camera, size), null, String(p));
  }
});

test('partially visible labels remain visible when their center is outside the view', () => {
  const camera = perspective();
  const halfHeight = 10 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  for (const p of [[halfHeight * camera.aspect + .1, 0, -10], [-halfHeight * camera.aspect - .1, 0, -10], [0, halfHeight + .1, -10], [0, -halfHeight - .1, -10]] as Vector3[]) {
    assert.ok(measurementLabelProjection(p, u, v, labelSize, camera, size), String(p));
  }
});

test('a diagonal offscreen quad is culled even when its axis-aligned bounds overlap the viewport', () => {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 100);
  camera.updateMatrixWorld();
  const diagonal = Math.SQRT1_2;
  assert.equal(measurementLabelProjection([1.5, 1.5, -10], [diagonal, -diagonal, 0], [diagonal, diagonal, 0], [2, .1], camera, size), null);
});

test('near-edge-on labels at a viewport corner are rejected using a relative determinant', () => {
  const camera = perspective();
  camera.up.set(0, 0, 1); camera.position.set(30, -30, 12); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  assert.ok(Math.abs(camera.getWorldDirection(new THREE.Vector3()).z) > .2, 'former facing check allows this label');
  assert.equal(measurementLabelProjection([10, 10, 11.999999], u, v, labelSize, camera, size), null);
  assert.ok(measurementLabelProjection([10, 10, 11.99], u, v, labelSize, camera, size), 'a safely projectable label remains visible');
});

test('visible perspective and orthographic labels keep finite, readable transforms at different zooms', () => {
  const cameras = [perspective(), new THREE.OrthographicCamera(-10, 10, 7, -7, .01, 100)];
  for (const camera of cameras) for (const zoom of [.25, 1, 10]) {
    camera.zoom = zoom; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    const matrix = measurementLabelProjection([0, 0, -10], u, v, labelSize, camera, size);
    assert.ok(matrix && matrix.every(Number.isFinite));
    assert.ok(matrix[0] * matrix[3] - matrix[1] * matrix[2] > 0);
    assert.equal(matrix[4], size[0] / 2); assert.equal(matrix[5], size[1] / 2);
  }
});

test('vertical labels read bottom-to-top throughout an orbit, independent of zoom and endpoint direction', () => {
  const cameras = [perspective(), new THREE.OrthographicCamera(-20, 20, 14, -14, .01, 100)];
  for (const camera of cameras) {
    camera.up.set(0, 0, 1);
    for (const zoom of [.25, 1, 4]) for (const angle of [.1, .2, .3, .4, .5, 1, 2, 3, 4, 5, 6]) {
      camera.zoom = zoom; camera.updateProjectionMatrix();
      camera.position.set(30 * Math.cos(angle), 30 * Math.sin(angle), 12);
      camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
      for (const sign of [-1, 1]) {
        const matrix = measurementLabelProjection([0, 0, 2], [0, 0, sign], [0, -sign, 0], labelSize, camera, size);
        assert.ok(matrix, `${camera.type}, zoom=${zoom}, angle=${angle}`);
        assert.ok(matrix[1] < 0, 'vertical text must keep reading bottom-to-top');
        assert.ok(matrix[0] * matrix[3] - matrix[1] * matrix[2] > 0, 'text must not be mirrored');
      }
    }
  }
});

test('nearly vertical labels ignore rounding-sized horizontal changes but other labels still read left-to-right', () => {
  const cameras = [perspective(), new THREE.OrthographicCamera(-10, 10, 7, -7, .01, 100)];
  for (const camera of cameras) {
    camera.updateMatrixWorld();
    for (const tilt of [-1e-8, 0, 1e-8, -.1, .1, -1, 1]) {
      const length = Math.hypot(tilt, 1);
      const direction: Vector3 = [tilt / length, 1 / length, 0];
      const perpendicular: Vector3 = [-1 / length, tilt / length, 0];
      const matrix = measurementLabelProjection([0, 0, -10], direction, perpendicular, labelSize, camera, size);
      assert.ok(matrix);
      if (Math.abs(tilt) <= 1e-8) assert.ok(matrix[1] < 0, 'rounding must not flip a vertical label');
      else assert.ok(matrix[0] > 0, 'nonvertical labels read left-to-right');
      assert.ok(matrix[0] * matrix[3] - matrix[1] * matrix[2] > 0, 'text must not be mirrored');
    }
  }
});

test('invalid sizes, geometry and camera matrices cannot reach SVG', () => {
  const camera = perspective();
  assert.equal(measurementLabelProjection([NaN, 0, -10], u, v, labelSize, camera, size), null);
  assert.equal(measurementLabelProjection([0, 0, -10], u, v, labelSize, camera, [0, 700]), null);
  assert.equal(measurementLabelProjection([0, 0, -10], u, v, [Infinity, 1], camera, size), null);
  camera.projectionMatrix.elements[0] = NaN;
  assert.equal(measurementLabelProjection([0, 0, -10], u, v, labelSize, camera, size), null);
});
