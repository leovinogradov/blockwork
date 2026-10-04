import test from 'node:test';
import assert from 'node:assert/strict';
import { OrthographicCamera, PerspectiveCamera } from 'three';
import { GRID_LINE_OPACITY, gridAppearanceForCamera } from '../src/grid-scale';

const gridBlendForCamera = (...args: Parameters<typeof gridAppearanceForCamera>) => gridAppearanceForCamera(...args).inchBlend;

test('orthographic grid uses feet when zoomed out and inches when zoomed back in', () => {
  const camera = new OrthographicCamera(-20, 20, 20, -20);
  assert.equal(gridBlendForCamera(camera, 100, 400), 1);
  camera.zoom = 0.2;
  assert.equal(gridBlendForCamera(camera, 100, 400), 0);
  camera.zoom = 1;
  assert.equal(gridBlendForCamera(camera, 100, 400), 1);
  // Distance does not change an orthographic view's scale.
  assert.equal(gridBlendForCamera(camera, 5000, 400), 1);
});

test('background opacity matches averaged hidden line coverage and fades out on zoom in', () => {
  const camera = new OrthographicCamera(-50, 50, 50, -50);
  const far = gridAppearanceForCamera(camera, 100, 100);
  const feet = gridAppearanceForCamera(camera, 100, 200);
  const transitioning = gridAppearanceForCamera(camera, 100, 350);
  const inches = gridAppearanceForCamera(camera, 100, 500);
  assert.equal(far.fillOpacity, feet.fillOpacity);
  assert.equal(feet.fillOpacity, 1 - (1 - GRID_LINE_OPACITY / 2) ** 2);
  assert.equal(transitioning.fillOpacity, (1 - (1 - GRID_LINE_OPACITY / 3.5) ** 2) * 0.5);
  assert.equal(inches.fillOpacity, 0);
  assert.ok(feet.fillOpacity > transitioning.fillOpacity);
});

test('fill stops getting stronger after inch lines are fully hidden', () => {
  const camera = new OrthographicCamera(-50, 50, 50, -50);
  const cap = gridAppearanceForCamera(camera, 100, 200).fillOpacity;
  for (const zoom of [1, 0.5, 0.1, 0.01, 0.0001]) {
    camera.zoom = zoom;
    const appearance = gridAppearanceForCamera(camera, 100, 200);
    assert.equal(appearance.inchBlend, 0);
    assert.equal(appearance.fillOpacity, cap);
  }
});

test('perspective grid responds to distance, field of view, and camera zoom', () => {
  const camera = new PerspectiveCamera(90);
  assert.equal(gridBlendForCamera(camera, 40, 400), 1);
  assert.ok(gridBlendForCamera(camera, 100, 400) < 1e-10);
  camera.zoom = 3;
  assert.equal(gridBlendForCamera(camera, 100, 400), 1);
  camera.zoom = 1;
  camera.fov = 30;
  assert.equal(gridBlendForCamera(camera, 100, 400), 1);
});

test('grid fill morphs continuously into inch lines as their screen spacing grows', () => {
  const camera = new OrthographicCamera(-50, 50, 50, -50);
  assert.equal(gridBlendForCamera(camera, 100, 200), 0);
  assert.equal(gridBlendForCamera(camera, 100, 350), 0.5);
  assert.equal(gridBlendForCamera(camera, 100, 500), 1);
  let previous = 0;
  for (let height = 201; height <= 500; height++) {
    const blend = gridBlendForCamera(camera, 100, height);
    assert.ok(blend >= previous && blend - previous < 0.006);
    previous = blend;
  }
});
