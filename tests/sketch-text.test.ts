import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankDocument, restoreWorkspace, serializeWorkspace, resolveSnapshot } from '../src/documents';
import { generateSketchSource, sketchShapeOrigin, snapToSketchEdges, trimSketchText, validateSketchShapes, type SketchShape } from '../src/sketch';
import { textRasterSize } from '../src/sketch-text';
import { sketchShapesInBox } from '../src/sketch-selection';
import { generateSource, type ModelSpec } from '../src/model';
import { sketchReference, sketchReferenceOrigin } from '../src/model-sketch';
import { resolveMeasurementAnchor } from '../src/measurements';

let receive: (event: { data: { source: string; kind: 'model' | 'sketch' } }) => void;
let response: ModelSpec & { rectangles: SketchShape[]; error?: string };
(globalThis as any).self = {
  addEventListener: (_: string, listener: typeof receive) => { receive = listener; },
  postMessage: (result: typeof response) => { response = result; },
};
await import('../src/compiler.worker');
const compile = (source: string, kind: 'model' | 'sketch' = 'sketch') => {
  receive({ data: { source, kind } });
  assert.equal(response.error, undefined);
  return response;
};
const shape: SketchShape = { id: 'note', name: 'Panel note', kind: 'text', text: 'Top "A"\n1/2 inch — ↑', size: [6, 3], position: [-2, 4], color: '#ffffff' };

test('three inch text has higher pixel density and more raster pixels than one inch text', () => {
  const small = textRasterSize([2, 1]), large = textRasterSize([6, 3]);
  assert.ok(small[1] >= 384);
  assert.ok(large[1] / 3 > small[1]);
  assert.ok(large[0] > small[0] * 3);
  assert.ok(Math.abs(large[0] / large[1] - 2) < 0.01);
  // A typical short caption has a much wider aspect ratio than a two-letter sample.
  assert.ok(textRasterSize([15, 3])[1] / 3 > textRasterSize([5, 1])[1]);
  for (const size of [[1000, 300], [0.015625, 2000], [2000, 0.015625]] as [number, number][]) {
    const [width, height] = textRasterSize(size, 2048);
    assert.ok(width >= 1 && height >= 1 && width <= 2048 && height <= 2048);
    assert.ok(width * height <= 16 * 1024 * 1024);
  }
  assert.throws(() => textRasterSize([0, 1]), /positive/);
  assert.throws(() => textRasterSize([1, Infinity]), /finite/);
});

test('text content, bounds and group membership survive source compilation in sketches and models', () => {
  const groups = [{ id: 'g', name: 'Notes', position: [2, 3, 0] as [number, number, number] }];
  const grouped = { ...shape, groupId: 'g' };
  const source = generateSketchSource([grouped], groups);
  assert.match(source, /text\(\{/);
  assert.deepEqual(compile(source).rectangles, [grouped]);
  const model = compile(`sketch({id:'drawing'}, [text({id:'note', text:'Mount me', size:[6,3]})]);`, 'model');
  assert.equal(model.sketches![0].shapes[0].text, 'Mount me');
  assert.deepEqual(compile(generateSource([], [], [], [], model.sketches), 'model'), model);
});

test('invalid text is rejected without silently losing content', () => {
  for (const text of ['', '   ', null, 123, 'a'.repeat(4001)]) assert.throws(() => validateSketchShapes([{ ...shape, text }]), /Text/);
  assert.throws(() => validateSketchShapes([{ ...shape, size: [2, 0] }]), /positive/);
  assert.equal(validateSketchShapes([{ ...shape, text: 'A\r\nB\rC' }])[0].text, 'A\nB\nC');
});

test('letter height and a top-left anchor persist independently of text bounds', () => {
  const anchored = { ...shape, textHeight: 1 };
  assert.deepEqual(sketchShapeOrigin(anchored), [-2, 1]);
  assert.deepEqual(sketchShapeOrigin(shape), [-2, 4]); // Earlier saved text retains its position.
  assert.deepEqual(compile(generateSketchSource([anchored])).rectangles, [anchored]);
  assert.deepEqual(resolveMeasurementAnchor({ objectId: 'note', coordinates: [0, 1] }, { rectangles: [anchored] }), [-2, 4, 0]);
  assert.deepEqual(sketchReferenceOrigin([anchored]), [-2, 1]);
  const ref = sketchReference([anchored]);
  assert.deepEqual(ref.size, [6, 3]);
  assert.deepEqual(ref.shapes[0].position, [0, 3]);
  assert.deepEqual(snapToSketchEdges([-1.98, 1.03], [anchored], 0.2).point, [-2, 1]);
  assert.deepEqual(sketchShapesInBox([anchored], [-3, 0], [5, 3], (point) => point, new Set()), ['note']);
  assert.deepEqual(sketchShapesInBox([anchored], [-3, 5], [5, 8], (point) => point, new Set()), []);
  for (const textHeight of [0, -1, Infinity, 'bad']) assert.throws(() => validateSketchShapes([{ ...shape, textHeight }]));
});

test('trailing empty lines are trimmed while leading and interior empty lines remain', () => {
  assert.equal(trimSketchText('\nA\n\nB\n\n \t\n'), '\nA\n\nB');
  assert.equal(trimSketchText('A\r\nB\r\n\r\n'), 'A\nB');
  assert.equal(validateSketchShapes([{ ...shape, text: 'A\n\n' }])[0].text, 'A');
  const precise = { ...shape, textHeight: 1, size: [4.132, 2.358] as [number, number], position: [0, 2.358] as [number, number] };
  assert.deepEqual(compile(generateSketchSource([precise])).rectangles, [precise]);
});

test('text retains editable content in workspace recovery and undo snapshots and supports box selection', () => {
  const doc = createBlankDocument([], 'sketch');
  doc.rectangles = [shape]; doc.source = doc.appliedSource = generateSketchSource([shape]);
  doc.hiddenBoxIds = [shape.id];
  const restored = restoreWorkspace(serializeWorkspace([doc], doc.id)).documents[0];
  assert.deepEqual(restored.rectangles, [shape]);
  assert.deepEqual(restored.hiddenBoxIds, ['note']);
  assert.deepEqual(resolveSnapshot(restored.history[0], 'sketch').rectangles, [shape]);
  assert.deepEqual(sketchShapesInBox([shape], [-3, 3], [5, 8], (point) => point, new Set()), ['note']);
  assert.deepEqual(sketchShapesInBox([shape], [-3, 3], [5, 8], (point) => point, new Set(['note'])), []);
});
