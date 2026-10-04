import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankDocument, createDocument, restoreWorkspace, serializeWorkspace } from '../src/documents';
import { parseInches } from '../src/model';
import { generateSketchSource, lineDisplacement, lineFromPoints, lineMeasurements, parseLineAngle, rectangleFromCorners, snapToRectangleEdges, validateRectangles, type RectangleSpec } from '../src/sketch';

const rectangle: RectangleSpec = { id: 'r1', name: 'Panel outline', size: [12, 8], position: [1, 2], color: '#d9a76e' };

test('line angles are positive clockwise and negative counterclockwise in every quadrant', () => {
  for (const [delta, angle] of [[[5, 0], 0], [[0, -5], 90], [[-5, 0], 180], [[0, 5], -90]] as [[number, number], number][]) {
    assert.deepEqual(lineMeasurements(delta), { length: 5, angle });
    assert.deepEqual(lineDisplacement(5, angle), delta);
  }
  for (const delta of [[3, 4], [-3, 4], [-3, -4], [3, -4]] as [number, number][]) {
    const { length, angle } = lineMeasurements(delta);
    assert.equal(length, 5);
    assert.ok(angle >= -180 && angle <= 180);
    assert.equal(Math.sign(angle), -Math.sign(delta[1]));
    assert.equal(Math.abs(angle) > 90, delta[0] < 0);
    const reconstructed = lineDisplacement(length, angle);
    assert.ok(reconstructed.every((v, i) => Math.abs(v - delta[i]) < 1e-10));
  }
  assert.deepEqual(lineDisplacement(5, -90), [0, 5]);
  assert.deepEqual(lineDisplacement(5, 450), [0, -5]);
  assert.deepEqual(lineMeasurements([0, 0]), { length: 0, angle: 0 });
  assert.ok(lineMeasurements([-5, 0.001]).angle < -179);
  assert.ok(lineMeasurements([-5, -0.001]).angle > 179);
  assert.throws(() => lineDisplacement(-1, 45), /length/);
  assert.throws(() => lineDisplacement(1, Infinity), /angle/);
});

test('angle input accepts signed decimal degrees and rejects invalid or empty input', () => {
  assert.equal(parseLineAngle('90°'), 90);
  assert.equal(parseLineAngle('-30.5 degrees'), -30.5);
  for (const [input, expected] of [['270', -90], ['450', 90], ['-270', 90], ['180', 180], ['-180', -180], ['360', 0]] as [string, number][]) {
    assert.equal(parseLineAngle(input), expected);
  }
  for (const value of ['', 'bad', 'Infinity', '90oops']) assert.throws(() => parseLineAngle(value), /angle/);
});

test('sketch rectangles stay on one plane and have two dimensions', () => {
  assert.deepEqual(validateRectangles([{ ...rectangle, size: ['12 1/2', 8], position: [1, '-1/4'] }])[0], { ...rectangle, size: [12.5, 8], position: [1, -0.25] });
  assert.throws(() => validateRectangles([{ ...rectangle, size: [1, 2, 3] }]), /two values/);
  assert.throws(() => validateRectangles([{ ...rectangle, size: [0, 2] }]), /positive/);
  assert.throws(() => validateRectangles([rectangle, rectangle]), /Duplicate/);
});

test('drawing from either corner produces the same X/Y rectangle', () => {
  const forward = rectangleFromCorners([1, 2], [5, 6], 'r', 'Rectangle', '#fff');
  const reverse = rectangleFromCorners([5, 6], [1, 2], 'r', 'Rectangle', '#fff');
  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward.position, [1, 2]);
  assert.deepEqual(forward.size, [4, 4]);
  assert.throws(() => rectangleFromCorners([0, 0], [0, 2], 'r', 'Rectangle', '#fff'), /different corners/);
});

test('sketch clicks snap to rectangle corners and anywhere along an existing edge', () => {
  assert.deepEqual(snapToRectangleEdges([1.06, 2.04], [rectangle], 0.2), { point: [1, 2], kind: 'corner' });
  assert.deepEqual(snapToRectangleEdges([5.503, 2.08], [rectangle], 0.2), { point: [5.5, 2], kind: 'edge' });
  assert.deepEqual(snapToRectangleEdges([13.08, 6.123], [rectangle], 0.2), { point: [13, 6.125], kind: 'edge' });
  assert.deepEqual(snapToRectangleEdges([20.002, 20], [rectangle], 0.2), { point: [20, 20], kind: null });
  assert.deepEqual(snapToRectangleEdges([1.06, 2.04], [], 0.2), { point: [1.0625, 2.046875], kind: null });
});

test('sketch source uses rectangle calls and round trips its geometry', () => {
  const source = generateSketchSource([rectangle]);
  assert.match(source, /rectangle\(\{ id: "r1"/);
  assert.doesNotMatch(source, /box\(/);
  const values: unknown[] = [];
  new Function('rectangle', 'inch', source)((value: unknown) => values.push(value), parseInches);
  assert.deepEqual(validateRectangles(values), [rectangle]);
});

test('lines allow horizontal, vertical and reversed endpoints but reject zero length', () => {
  for (const end of [[5, 2], [1, 6], [-3, -2]] as [number, number][]) {
    const line = lineFromPoints([1, 2], end, 'l1', 'Line', '#fff');
    assert.equal(line.kind, 'line');
    assert.deepEqual(line.position, [1, 2]);
    assert.deepEqual(line.size, [end[0] - 1, end[1] - 2]);
  }
  assert.throws(() => lineFromPoints([1, 2], [1, 2], 'l1', 'Line', '#fff'), /different points/);
});

test('line endpoints and diagonal segments participate in sketch snapping', () => {
  const line = lineFromPoints([0, 0], [8, 8], 'l1', 'Line', '#fff');
  assert.deepEqual(snapToRectangleEdges([8.04, 8.03], [line], 0.2), { point: [8, 8], kind: 'endpoint' });
  assert.deepEqual(snapToRectangleEdges([4.08, 3.92], [line], 0.2), { point: [4, 4], kind: 'edge' });
  assert.equal(snapToRectangleEdges([8, 0], [line], 0.2).kind, null);
});

test('mixed sketch source and local recovery retain line endpoints alongside rectangles', () => {
  const line = lineFromPoints([4, 6], [-2, 6], 'l1', 'Line', '#fff');
  const source = generateSketchSource([rectangle, line]);
  const values: unknown[] = [];
  new Function('rectangle', 'line', 'inch', source)(
    (value: unknown) => values.push(value),
    (value: { id: string; name: string; color: string; start: [number, number]; end: [number, number] }) => values.push(lineFromPoints(value.start, value.end, value.id, value.name, value.color)),
    parseInches,
  );
  assert.deepEqual(validateRectangles(values), [rectangle, line]);
  const sketch = createBlankDocument([], 'sketch');
  sketch.rectangles = [rectangle, line]; sketch.source = sketch.appliedSource = source;
  sketch.hiddenBoxIds = ['l1'];
  const recovered = restoreWorkspace(serializeWorkspace([sketch], sketch.id)).documents[0];
  assert.deepEqual(recovered.rectangles, [rectangle, line]);
  assert.deepEqual(recovered.hiddenBoxIds, ['l1']);
  assert.match(recovered.source, /line\(/);
});

test('sketch tabs keep their mode, rectangles, source draft, and flat view across reload', () => {
  const model = createDocument('model.js', 'box({})');
  const sketch = createBlankDocument([model], 'sketch');
  assert.equal(sketch.kind, 'sketch');
  assert.equal(sketch.viewMode, 'top');
  assert.equal(sketch.projectionMode, 'orthographic');
  sketch.rectangles = [rectangle];
  sketch.source = 'unfinished sketch draft';
  sketch.draftDirty = true;
  sketch.appliedSource = generateSketchSource([rectangle]);
  sketch.hiddenBoxIds = ['r1'];
  const restored = restoreWorkspace(serializeWorkspace([model, sketch], sketch.id));
  assert.equal(restored.activeId, sketch.id);
  assert.equal(restored.documents[0].kind, 'model');
  assert.equal(restored.documents[1].kind, 'sketch');
  assert.deepEqual(restored.documents[1].rectangles, [rectangle]);
  assert.equal(restored.documents[1].source, 'unfinished sketch draft');
  assert.equal(restored.documents[1].appliedSource, sketch.appliedSource);
  assert.deepEqual(restored.documents[1].hiddenBoxIds, ['r1']);
});
