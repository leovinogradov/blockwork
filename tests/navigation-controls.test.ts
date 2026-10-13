import test from 'node:test';
import assert from 'node:assert/strict';
import { MOUSE, OrthographicCamera, PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { MIN_ZOOM_STEP_FRACTION, NavigationControls } from '../src/navigation-controls';

// Exercise the actual OrbitControls input handlers and camera projection.
class Surface extends EventTarget {
  clientWidth = 600;
  clientHeight = 400;
  style = { touchAction: '' };
  getRootNode() { return this; }
  getBoundingClientRect() { return { left: 50, top: 25, width: 600, height: 400 }; }
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() { return false; }
  send(type: string, fields: Record<string, number | string | boolean> = {}) {
    this.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), {
      pointerId: 1, pointerType: 'mouse', button: 2, clientX: 350, clientY: 225,
      deltaMode: 0, deltaX: 0, deltaY: 0, ...fields,
    }));
  }
}

for (const projection of ['perspective', 'orthographic'] as const) {
  test(`${projection}: trackpad slides pan at picked depth, including horizontal-only input`, () => {
    const current = setup(projection);
    current.controls.inputDevice = 'trackpad';
    const anchor = current.pickAt(470, 140);
    const orientation = current.camera.quaternion.clone();
    current.surface.send('wheel', { clientX: 470, clientY: 140, deltaX: 25, deltaY: 15 });
    let projected = current.screenPoint(anchor);
    closeTo(projected.x, 445); closeTo(projected.y, 125);
    current.surface.send('wheel', { clientX: 445, clientY: 125, deltaX: -12 });
    projected = current.screenPoint(anchor);
    closeTo(projected.x, 457); closeTo(projected.y, 125);
    assert.ok(current.camera.quaternion.angleTo(orientation) < 1e-7);
    assert.equal(current.camera.zoom, 1);
    current.controls.dispose();
  });

  test(`${projection}: Shift-slide orbits, while pinch zoom keeps its cursor anchor`, () => {
    const current = setup(projection, 100, 100);
    current.controls.inputDevice = 'trackpad';
    const orientation = current.camera.quaternion.clone();
    const distance = current.controls.getDistance();
    current.surface.send('wheel', { deltaX: 25, deltaY: 15, shiftKey: true });
    assert.ok(current.camera.quaternion.angleTo(orientation) > 0.01);
    closeTo(current.controls.getDistance(), distance);
    const anchor = current.pickAt(470, 140);
    const pinchOrientation = current.camera.quaternion.clone();
    current.surface.send('wheel', { clientX: 470, clientY: 140, deltaY: -5, ctrlKey: true, shiftKey: true });
    const projected = current.screenPoint(anchor);
    closeTo(projected.x, 470); closeTo(projected.y, 140);
    assert.ok(current.camera.quaternion.angleTo(pinchOrientation) < 1e-7);
    assert.ok(current.controls.getDistance() < distance || current.camera.zoom > 1);
    current.controls.dispose();
  });

  test(`${projection}: sketches pan on Shift-slide and the input can switch back to wheel zoom`, () => {
    const current = setup(projection);
    current.controls.inputDevice = 'trackpad';
    current.controls.enableRotate = false;
    const anchor = current.pickAt(350, 225);
    current.surface.send('wheel', { deltaY: 15, shiftKey: true });
    closeTo(current.screenPoint(anchor).y, 210);
    const before = current.camera.position.clone();
    current.controls.inputDevice = 'mouse';
    current.surface.send('wheel', { deltaY: -100 });
    assert.ok(!current.camera.position.equals(before) || current.camera.zoom > 1);
    current.controls.dispose();
  });

  test(`${projection}: navigation buttons use one-finger drag and stop after release or cancellation`, () => {
    for (const tool of ['orbit', 'pan', 'zoom'] as const) {
      const current = setup(projection, 100, 100);
      current.controls.setNavigationTool(tool);
      const position = current.camera.position.clone(), zoom = current.camera.zoom;
      current.surface.send('pointerdown', { button: 0 });
      current.surface.send('pointermove', { button: 0, clientX: 380, clientY: 245 });
      assert.ok(!current.camera.position.equals(position) || current.camera.zoom !== zoom, `${tool} must move the view`);
      current.surface.send('pointerup', { button: 0, clientX: 380, clientY: 245 });
      const stopped = current.camera.position.clone(), stoppedZoom = current.camera.zoom;
      current.surface.send('pointermove', { button: 0, clientX: 450, clientY: 260 });
      assert.ok(current.camera.position.equals(stopped)); assert.equal(current.camera.zoom, stoppedZoom);
      current.surface.send('pointerdown', { button: 0 });
      current.surface.send('pointercancel', { button: 0 });
      current.surface.send('pointermove', { button: 0, clientX: 450, clientY: 260 });
      assert.ok(current.camera.position.equals(stopped)); assert.equal(current.camera.zoom, stoppedZoom);
      current.surface.send('pointerdown', { button: 0 });
      current.controls.setNavigationTool('select');
      current.surface.send('pointermove', { button: 0, clientX: 450, clientY: 260 });
      assert.ok(current.camera.position.equals(stopped)); assert.equal(current.camera.zoom, stoppedZoom);
      current.controls.dispose();
    }
  });

  test(`${projection}: disabled controls and a disabled pan do not move on trackpad slides`, () => {
    const current = setup(projection);
    current.controls.inputDevice = 'trackpad';
    const position = current.camera.position.clone();
    current.controls.enabled = false;
    current.surface.send('wheel', { deltaY: 15 });
    current.controls.enabled = true; current.controls.enablePan = false;
    current.surface.send('wheel', { deltaY: 15 });
    assert.ok(current.camera.position.equals(position));
    current.controls.dispose();
  });
}

function setup(projection: 'perspective' | 'orthographic', distance = 100, targetDistance = 0.5, zoom = 1, modelScale = 0) {
  const surface = new Surface();
  const camera = projection === 'perspective'
    ? new PerspectiveCamera(42, 1.5)
    : new OrthographicCamera(-30, 30, 20, -20);
  camera.position.set(0, 0, distance);
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
  const plane = new Plane(new Vector3(0, 0, 1), 0);
  const raycaster = new Raycaster();
  const pointAt = (pointer: Vector2) => {
    camera.updateMatrixWorld();
    raycaster.setFromCamera(pointer, camera);
    return raycaster.ray.intersectPlane(plane, new Vector3());
  };
  let pickCount = 0;
  let hasGeometry = true;
  const controls = new NavigationControls(camera, surface as unknown as HTMLElement, (pointer) => {
    pickCount++;
    return hasGeometry ? pointAt(pointer) : null;
  }, () => modelScale);
  controls.minDistance = 0.5;
  controls.maxDistance = 5000;
  controls.minZoom = 0.08;
  controls.maxZoom = 200;
  controls.target.set(0, 0, distance - targetDistance);
  controls.update();
  const screenPoint = (point: Vector3) => {
    camera.updateMatrixWorld();
    const ndc = point.clone().project(camera);
    return new Vector2(50 + (ndc.x + 1) * 300, 25 + (1 - ndc.y) * 200);
  };
  const pickAt = (x: number, y: number) => pointAt(new Vector2((x - 50) / 300 - 1, 1 - (y - 25) / 200))!;
  return {
    surface, camera, controls, screenPoint, pickAt, picks: () => pickCount,
    hideGeometry: () => { hasGeometry = false; },
    setModelScale: (size: number) => { modelScale = size; },
  };
}

function closeTo(actual: number, expected: number, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should equal ${expected}`);
}

for (const projection of ['perspective', 'orthographic'] as const) {
  test(`${projection}: the picked point tracks the full mouse drag and stops immediately`, () => {
    for (const distance of [1, 100]) {
      const current = setup(projection, distance);
      const anchor = current.pickAt(300, 180);
      const position = current.camera.position.clone();
      const quaternion = current.camera.quaternion.clone();
      current.surface.send('pointerdown', { clientX: 300, clientY: 180 });
      assert.ok(current.camera.position.equals(position));
      assert.ok(current.camera.quaternion.equals(quaternion));
      current.surface.send('pointermove', { clientX: 370, clientY: 220 });
      current.surface.send('pointermove', { clientX: 440, clientY: 260 });
      const projected = current.screenPoint(anchor);
      closeTo(projected.x, 440);
      closeTo(projected.y, 260);
      current.surface.send('pointerup', { clientX: 440, clientY: 260 });
      const stopped = current.camera.position.clone();
      for (let frame = 0; frame < 30; frame++) current.controls.update();
      assert.ok(current.camera.position.equals(stopped));
      assert.equal(current.controls.enableDamping, false);
      assert.equal(current.picks(), projection === 'perspective' ? 1 : 0);
      current.controls.dispose();
    }
  });

  test(`${projection}: wheel zoom preserves the off-center point under the cursor`, () => {
    for (const deltaY of [-100, 100]) {
      const current = setup(projection);
      const anchor = current.pickAt(470, 140);
      const quaternion = current.camera.quaternion.clone();
      current.surface.send('wheel', { clientX: 470, clientY: 140, deltaY });
      const projected = current.screenPoint(anchor);
      closeTo(projected.x, 470);
      closeTo(projected.y, 140);
      assert.ok(current.camera.quaternion.angleTo(quaternion) < 1e-7);
      if (projection === 'perspective') {
        const movement = current.camera.position.distanceTo(new Vector3(0, 0, 100));
        assert.ok(movement > 3, 'a stale target 0.5 inches away must not slow zoom at a 100-inch surface');
      } else assert.equal(Math.sign(current.camera.zoom - 1), -Math.sign(deltaY));
      current.controls.dispose();
    }
  });

  test(`${projection}: disabled controls and wheel during a drag do not rebase the view`, () => {
    const current = setup(projection);
    const target = current.controls.target.clone();
    const position = current.camera.position.clone();
    current.controls.enableZoom = false;
    current.surface.send('wheel', { deltaY: -100 });
    assert.ok(current.controls.target.equals(target));
    assert.ok(current.camera.position.equals(position));
    assert.equal(current.picks(), 0);
    current.controls.enableZoom = true;
    current.surface.send('pointerdown');
    const duringPan = current.camera.position.clone();
    const picks = current.picks();
    current.surface.send('wheel', { deltaY: -100 });
    assert.ok(current.camera.position.equals(duringPan));
    assert.equal(current.picks(), picks);
    current.surface.send('pointercancel');
    current.surface.send('wheel', { deltaY: -100 });
    assert.ok(!current.camera.position.equals(duringPan) || current.camera.zoom !== 1);
    current.controls.dispose();
  });

  test(`${projection}: empty space keeps navigation usable at the current depth`, () => {
    const current = setup(projection, 100, 100);
    current.hideGeometry();
    const anchor = current.pickAt(350, 225);
    current.surface.send('pointerdown');
    current.surface.send('pointermove', { clientX: 400 });
    current.surface.send('pointerup', { clientX: 400 });
    closeTo(current.screenPoint(anchor).x, 400);
    current.surface.send('wheel', { deltaY: -100 });
    assert.ok(Number.isFinite(current.camera.position.length()));
    assert.ok(Number.isFinite(current.camera.zoom));
    current.controls.dispose();
  });

  test(`${projection}: camera travel and zoom limits still apply`, () => {
    const current = setup(projection, 1, 1);
    current.surface.send('wheel', { deltaY: -100000 });
    if (current.camera instanceof PerspectiveCamera) {
      closeTo(current.camera.position.distanceTo(current.controls.target), 0.5);
    } else assert.equal(current.camera.zoom, 200);
    current.hideGeometry();
    current.surface.send('wheel', { deltaY: 100000 });
    if (current.camera instanceof PerspectiveCamera) {
      closeTo(current.camera.position.distanceTo(current.controls.target), 5000);
    } else assert.equal(current.camera.zoom, 0.08);
    current.controls.dispose();
  });

  test(`${projection}: disposing removes navigation listeners`, () => {
    const current = setup(projection);
    const position = current.camera.position.clone();
    current.controls.dispose();
    current.surface.send('pointerdown');
    current.surface.send('wheel', { deltaY: -100 });
    assert.equal(current.picks(), 0);
    assert.ok(current.camera.position.equals(position));
  });
}

test('perspective: Shift-middle pan uses picked depth and plain middle still orbits', () => {
  const current = setup('perspective');
  current.controls.mouseButtons.MIDDLE = MOUSE.ROTATE;
  const anchor = current.pickAt(350, 225);
  current.surface.send('pointerdown', { button: 1, shiftKey: true });
  current.surface.send('pointermove', { button: 1, shiftKey: true, clientX: 410 });
  current.surface.send('pointerup', { button: 1, shiftKey: true, clientX: 410 });
  closeTo(current.screenPoint(anchor).x, 410);
  const quaternion = current.camera.quaternion.clone();
  current.surface.send('pointerdown', { button: 1 });
  current.surface.send('pointermove', { button: 1, clientX: 410 });
  current.surface.send('pointerup', { button: 1, clientX: 410 });
  assert.ok(current.camera.quaternion.angleTo(quaternion) > 0.1);
  assert.equal(current.picks(), 1);
  current.controls.dispose();
});

test('perspective: zoom rebases to newly hovered geometry on every wheel event', () => {
  const current = setup('perspective', 100, 0.5);
  const firstPosition = current.camera.position.clone();
  current.surface.send('wheel', { deltaY: -100 });
  const firstMovement = firstPosition.distanceTo(current.camera.position);
  // Mimic moving inside an object: the old target is now nearly at the camera.
  current.controls.target.copy(current.camera.position).addScaledVector(current.camera.getWorldDirection(new Vector3()), 0.5);
  current.controls.update();
  const secondPosition = current.camera.position.clone();
  current.surface.send('wheel', { deltaY: -100 });
  assert.ok(secondPosition.distanceTo(current.camera.position) > firstMovement * 0.9);
  assert.equal(current.picks(), 2);
  current.controls.dispose();
});

test('perspective: surface pan stays accurate with camera zoom and Z-up oblique views', () => {
  const current = setup('perspective', 100, 0.5, 2);
  current.camera.up.set(0, 0, 1);
  current.camera.position.set(40, -60, 50);
  current.camera.lookAt(0, 0, 0);
  current.controls.target.copy(current.camera.position).addScaledVector(current.camera.getWorldDirection(new Vector3()), 0.5);
  current.controls.update();
  const anchor = current.pickAt(350, 225);
  current.surface.send('pointerdown');
  current.surface.send('pointermove', { clientX: 430, clientY: 265 });
  current.surface.send('pointerup', { clientX: 430, clientY: 265 });
  closeTo(current.screenPoint(anchor).x, 430);
  closeTo(current.screenPoint(anchor).y, 265);
  current.controls.dispose();
});

for (const projection of ['perspective', 'orthographic'] as const) {
  const extent = (current: ReturnType<typeof setup>) => current.camera instanceof OrthographicCamera
    ? (current.camera.top - current.camera.bottom) / current.camera.zoom
    : current.camera.position.z;

  test(`${projection}: close-up zoom steps use the configured model fraction and stay cursor anchored`, () => {
    for (const deltaY of [-100, 100]) {
      // Zoom in enough that the configured minimum exceeds normal wheel travel.
      const current = setup(projection, 1, 1, projection === 'orthographic' ? 100 : 1, 5);
      const before = extent(current);
      current.surface.send('wheel', { deltaY });
      closeTo(Math.abs(extent(current) - before), 5 * MIN_ZOOM_STEP_FRACTION);
      // Check off-center anchoring separately: perspective travels along a ray.
      const pointUnderCursor = current.pickAt(430, 180);
      current.surface.send('wheel', { clientX: 430, clientY: 180, deltaY });
      closeTo(current.screenPoint(pointUnderCursor).x, 430);
      closeTo(current.screenPoint(pointUnderCursor).y, 180);
      current.controls.dispose();
    }
  });

  test(`${projection}: tiny inputs scale the minimum proportionally and wheel units agree`, () => {
    for (const [deltaY, deltaMode, steps] of [[1, 0, 0.01], [100, 0, 1], [6.25, 1, 1], [1, 2, 1]]) {
      const current = setup(projection, 1, 1, projection === 'orthographic' ? 100 : 1, 5);
      const before = extent(current);
      current.surface.send('wheel', { deltaY, deltaMode });
      closeTo(extent(current) - before, 5 * MIN_ZOOM_STEP_FRACTION * steps);
      current.controls.dispose();
    }
  });

  test(`${projection}: the minimum follows model edits and disappears for an empty model`, () => {
    const current = setup(projection, 1, 1, projection === 'orthographic' ? 100 : 1, 5);
    const before = extent(current);
    current.surface.send('wheel', { deltaY: 100 });
    closeTo(extent(current) - before, 5 * MIN_ZOOM_STEP_FRACTION);
    current.setModelScale(10);
    const edited = extent(current);
    current.surface.send('wheel', { deltaY: 100 });
    closeTo(extent(current) - edited, 10 * MIN_ZOOM_STEP_FRACTION);
    current.setModelScale(0);
    current.surface.send('wheel', { deltaY: 100 });
    assert.equal(current.controls.zoomSpeed, 0.8);
    current.controls.dispose();
  });

  test(`${projection}: faster normal zoom is preserved and pan remains unchanged`, () => {
    const current = setup(projection, 100, 100, 1, 5);
    const original = setup(projection, 100, 100);
    for (const deltaY of [-100, 100]) {
      current.surface.send('wheel', { deltaY });
      original.surface.send('wheel', { deltaY });
      closeTo(extent(current), extent(original));
      assert.equal(current.controls.zoomSpeed, 0.8);
    }
    const anchor = current.pickAt(350, 225);
    current.surface.send('pointerdown');
    current.surface.send('pointermove', { clientX: 430 });
    current.surface.send('pointerup', { clientX: 430 });
    closeTo(current.screenPoint(anchor).x, 430);
    current.controls.dispose(); original.controls.dispose();
  });

  test(`${projection}: minimum zoom still stops at camera limits and allows zooming back out`, () => {
    // Force a minimum step larger than the remaining travel to either limit.
    const modelScale = 1 / MIN_ZOOM_STEP_FRACTION;
    const current = setup(projection, 1, 1, projection === 'orthographic' ? 100 : 1, modelScale);
    current.surface.send('wheel', { deltaY: -100 });
    if (current.camera instanceof PerspectiveCamera) {
      closeTo(current.camera.position.distanceTo(current.controls.target), 0.5);
    } else assert.equal(current.camera.zoom, 200);
    const before = extent(current);
    current.surface.send('wheel', { deltaY: 100 });
    closeTo(extent(current) - before, modelScale * MIN_ZOOM_STEP_FRACTION);
    current.controls.dispose();
  });
}
