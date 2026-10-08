import test from 'node:test';
import assert from 'node:assert/strict';
import { OrthographicCamera, PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { NavigationControls } from '../src/navigation-controls';

// Exercise OrbitControls' real input handlers without requiring WebGL.
class Surface extends EventTarget {
  clientWidth = 600;
  clientHeight = 400;
  style = { touchAction: '' };
  getRootNode() { return this; }
  setPointerCapture() {}
  releasePointerCapture() {}
  send(type: string, fields: Record<string, number | string> = {}) {
    this.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), {
      pointerId: 1, pointerType: 'mouse', button: 2, clientX: 100, clientY: 100,
      deltaMode: 0, ...fields,
    }));
  }
}

function setup(projection: 'perspective' | 'orthographic', scale: number, stock = false, reference = 6) {
  const surface = new Surface();
  const camera = projection === 'perspective'
    ? new PerspectiveCamera(42, 1.5)
    : new OrthographicCamera(-30, 30, 20, -20);
  camera.position.set(0, 0, projection === 'perspective' ? scale : 100);
  if (camera instanceof OrthographicCamera) camera.zoom = scale;
  camera.updateProjectionMatrix();
  const element = surface as unknown as HTMLElement;
  const controls = stock ? new OrbitControls(camera, element) : new NavigationControls(camera, element, reference);
  if (stock) { controls.panSpeed = 0.85; controls.zoomSpeed = 0.8; }
  controls.minDistance = 0.5;
  controls.maxDistance = 5000;
  controls.minZoom = 0.08;
  controls.maxZoom = 200;
  controls.screenSpacePanning = true;
  const viewHeight = () => camera instanceof OrthographicCamera
    ? 40 / camera.zoom
    : 2 * camera.position.distanceTo(controls.target) * Math.tan(21 * Math.PI / 180);
  const pan = () => {
    const before = controls.target.clone();
    surface.send('pointerdown');
    surface.send('pointermove', { clientX: 200 });
    surface.send('pointerup', { clientX: 200 });
    return controls.target.distanceTo(before);
  };
  return { surface, camera, controls, viewHeight, pan };
}

for (const projection of ['perspective', 'orthographic'] as const) {
  test(`${projection}: pan and wheel zoom match existing speeds at the reference scale`, () => {
    const scale = projection === 'perspective' ? 100 : 1;
    const reference = projection === 'perspective' ? 200 * Math.tan(21 * Math.PI / 180) : 40;
    for (const deltaY of [-100, 100]) {
      const current = setup(projection, scale, false, reference);
      const stock = setup(projection, scale, true);
      assert.equal(current.pan(), stock.pan());
      current.surface.send('wheel', { deltaY });
      stock.surface.send('wheel', { deltaY });
      assert.equal(current.viewHeight(), stock.viewHeight());
      current.controls.dispose(); stock.controls.dispose();
    }
  });

  test(`${projection}: 100x smaller view gives 10x smaller pan movement, with no floor`, () => {
    const distant = setup(projection, projection === 'perspective' ? 64 : 2);
    const close = setup(projection, projection === 'perspective' ? 0.64 : 200);
    const distantMovement = distant.pan();
    const closeMovement = close.pan();
    assert.ok(Math.abs(distantMovement / closeMovement - 10) < 1e-10);
    assert.ok(closeMovement > 0 && closeMovement < distantMovement);
    distant.controls.dispose(); close.controls.dispose();
  });

  test(`${projection}: wheel movement follows the power curve in both directions`, () => {
    for (const deltaY of [-0.01, 0.01]) {
      const movements = [];
      for (const scale of projection === 'perspective' ? [64, 0.64] : [2, 200]) {
        const current = setup(projection, scale);
        // Leave room for zoom-in rather than testing against a travel limit.
        current.controls.maxZoom = 1000;
        const before = current.viewHeight();
        current.surface.send('wheel', { deltaY });
        const movement = current.viewHeight() - before;
        assert.equal(Math.sign(movement), Math.sign(deltaY));
        movements.push(Math.abs(movement));
        current.controls.dispose();
      }
      assert.ok(Math.abs(movements[0] / movements[1] - 10) < 0.001);
    }
  });

  test(`${projection}: sensitivity is smooth across the reference scale`, () => {
    const movements = [];
    for (const height of [5.999, 6, 6.001]) {
      const scale = projection === 'perspective' ? height / (2 * Math.tan(21 * Math.PI / 180)) : 40 / height;
      const current = setup(projection, scale);
      movements.push(current.pan());
      current.controls.dispose();
    }
    const below = movements[1] - movements[0];
    const above = movements[2] - movements[1];
    assert.ok(below > 0 && above > 0);
    assert.ok(Math.abs(below / above - 1) < 0.001);
  });

  test(`${projection}: scene reference updates sensitivity without moving the camera`, () => {
    const current = setup(projection, projection === 'perspective' ? 1 : 100);
    const position = current.camera.position.clone();
    const originalSpeed = current.controls.panSpeed;
    assert.ok(current.controls instanceof NavigationControls);
    current.controls.setReferenceViewHeight(24);
    assert.equal(current.controls.panSpeed, originalSpeed * 2);
    assert.ok(current.camera.position.equals(position));
    current.controls.dispose();
  });

  test(`${projection}: zoom still respects travel limits and can zoom back out`, () => {
    const current = setup(projection, projection === 'perspective' ? 0.6 : 180);
    current.surface.send('wheel', { deltaY: -10000 });
    if (current.camera instanceof PerspectiveCamera) {
      assert.ok(Math.abs(current.camera.position.distanceTo(current.controls.target) - 0.5) < 1e-10);
    } else assert.equal(current.camera.zoom, 200);
    const closestHeight = current.viewHeight();
    current.surface.send('wheel', { deltaY: 10000 });
    assert.ok(current.viewHeight() > closestHeight);
    if (current.camera instanceof PerspectiveCamera) {
      assert.ok(current.camera.position.distanceTo(current.controls.target) <= 5000);
    } else assert.equal(current.camera.zoom, 0.08);
    assert.ok(current.controls.panSpeed < 0.85);
    assert.ok(current.controls.zoomSpeed < 0.8);
    current.controls.dispose();
  });
}
