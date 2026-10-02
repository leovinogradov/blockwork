import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankDocument, createDocument, restoreWorkspace, serializeWorkspace } from '../src/documents';
import { parseInches } from '../src/model';
import { generateSketchSource, rectangleFromCorners, validateRectangles, type RectangleSpec } from '../src/sketch';

const rectangle: RectangleSpec = { id: 'r1', name: 'Panel outline', size: [12, 8], position: [1, 2], color: '#d9a76e' };

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

test('sketch source uses rectangle calls and round trips its geometry', () => {
  const source = generateSketchSource([rectangle]);
  assert.match(source, /rectangle\(\{ id: "r1"/);
  assert.doesNotMatch(source, /box\(/);
  const values: unknown[] = [];
  new Function('rectangle', 'inch', source)((value: unknown) => values.push(value), parseInches);
  assert.deepEqual(validateRectangles(values), [rectangle]);
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
