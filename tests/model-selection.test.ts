import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Mesh, OrthographicCamera, PerspectiveCamera, PlaneGeometry } from 'three';
import { modelObjectsInBox } from '../src/model-selection';

const bounds = { left: 50, top: 25, width: 600, height: 400 };
const box = (id: string, x = 0, y = 0, z = 0) => {
  const mesh = new Mesh(new BoxGeometry(2, 2, 2));
  mesh.position.set(x, y, z);
  return { id, mesh };
};

for (const projection of ['perspective', 'orthographic'] as const) {
  const camera = projection === 'perspective'
    ? new PerspectiveCamera(60, 1.5, 0.1, 100)
    : new OrthographicCamera(-15, 15, 10, -10, 0.1, 100);
  camera.position.z = 10;
  test(`${projection}: marquee selects multiple intersecting boxes in both directions`, () => {
    const objects = [box('left', -3), box('right', 3), box('outside', 40)];
    assert.deepEqual(modelObjectsInBox(objects, camera, [150, 125], [550, 325], bounds, new Set()), ['left', 'right']);
    assert.deepEqual(modelObjectsInBox(objects, camera, [550, 325], [150, 125], bounds, new Set(['left'])), ['right']);
    objects[1].mesh.visible = false;
    assert.deepEqual(modelObjectsInBox(objects, camera, [150, 125], [550, 325], bounds, new Set()), ['left']);
  });
  test(`${projection}: empty space and geometry behind the camera cannot be selected`, () => {
    assert.deepEqual(modelObjectsInBox([box('center')], camera, [55, 30], [65, 40], bounds, new Set()), []);
    assert.deepEqual(modelObjectsInBox([box('behind', 0, 0, 20), box('far', 0, 0, -200)], camera, [50, 25], [650, 425], bounds, new Set()), []);
  });
}

test('marquee intersects actual projected faces, excluding empty corners of their bounding box', () => {
  const camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.z = 10;
  const mesh = new Mesh(new PlaneGeometry(8, 1));
  mesh.rotation.z = Math.PI / 4;
  assert.deepEqual(modelObjectsInBox([{ id: 'sketch', mesh }], camera, [400, 260], [420, 280], bounds, new Set()), []);
  assert.deepEqual(modelObjectsInBox([{ id: 'sketch', mesh }], camera, [345, 220], [355, 230], bounds, new Set()), ['sketch']);
});

test('a box crossing the perspective near plane remains selectable on its visible portion', () => {
  const camera = new PerspectiveCamera(60, 1.5, 0.1, 100);
  camera.position.z = 1;
  assert.deepEqual(modelObjectsInBox([box('near')], camera, [345, 220], [355, 230], bounds, new Set()), ['near']);
});
