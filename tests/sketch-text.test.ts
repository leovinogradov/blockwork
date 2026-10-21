import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankDocument, restoreWorkspace, serializeWorkspace, resolveSnapshot } from '../src/documents';
import { generateSketchSource, sketchShapeOrigin, snapToSketchEdges, trimSketchText, validateSketchShapes, type SketchTextShape } from '../src/sketch';
import { textRasterSize, textRasterBudgets, TEXT_TEXTURE_PIXEL_BUDGET } from '../src/sketch-text';
import { sketchShapesInBox } from '../src/sketch-selection';
import { generateSource, type ModelSpec } from '../src/model';
import { sketchReference, sketchReferenceOrigin } from '../src/model-sketch';
import { resolveMeasurementAnchor } from '../src/measurements';

let receive: (event: { data: { source: string; kind: 'model' | 'sketch' } }) => void;
let response: ModelSpec & { rectangles: SketchTextShape[]; error?: string };
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
const shape: SketchTextShape = { id: 'note', name: 'Panel note', kind: 'text', textHeight: 1, text: 'Top "A"\n1/2 inch — ↑', size: [6, 3], position: [-2, 4], color: '#ffffff' };

test('label texture detail stays constant as inch dimensions grow', () => {
  const small = textRasterSize([2, 1], 1), large = textRasterSize([6, 3], 3);
  assert.deepEqual(small, [256, 128]);
  assert.deepEqual(large, small);
  assert.deepEqual(textRasterSize([15, 3], 3), textRasterSize([5, 1], 1));
  assert.deepEqual(textRasterSize([4, 3], 1), [512, 384]); // Multiline letters retain detail.
  for (const size of [[1000, 300], [0.015625, 2000], [2000, 0.015625]] as [number, number][]) {
    const [width, height] = textRasterSize(size, size[1], 512);
    assert.ok(width >= 1 && height >= 1 && width <= 512 && height <= 512);
    assert.ok(width * height <= 1024 * 1024);
  }
  assert.throws(() => textRasterSize([0, 1], 1), /positive/);
  assert.throws(() => textRasterSize([1, Infinity], 1), /finite/);
  assert.throws(() => textRasterSize([1, 1], 0), /positive/);
});

test('a large cutlist shares a bounded texture budget across labels', () => {
  const labels = Array.from({ length: 2000 }, (_, i) => ({ ...shape, id: String(i), size: [54, 3.6] as [number, number] }));
  const budgets = textRasterBudgets(labels);
  const pixels = labels.reduce((sum, label, i) => {
    const [w, h] = textRasterSize(label.size, label.textHeight, 8192, budgets[i]);
    return sum + w * h;
  }, 0);
  assert.ok(pixels <= TEXT_TEXTURE_PIXEL_BUDGET);
  assert.ok(budgets.every((budget) => budget > 0));
  assert.deepEqual(textRasterBudgets([]), []);
  assert.deepEqual(textRasterBudgets([shape]), [textRasterSize(shape.size, shape.textHeight).reduce((w, h) => w * h)]);
  const [w, h] = textRasterSize(shape.size, shape.textHeight, 8192, 4096);
  assert.ok(w * h <= 4096);
  assert.ok(Math.abs(w / h - shape.size[0] / shape.size[1]) < 0.05);
});

test('text content, bounds and group membership survive source compilation in sketches and models', () => {
  const groups = [{ id: 'g', name: 'Notes', position: [2, 3, 0] as [number, number, number] }];
  const grouped = { ...shape, groupId: 'g' };
  const source = generateSketchSource([grouped], groups);
  assert.match(source, /text\(\{/);
  assert.deepEqual(compile(source).rectangles, [grouped]);
  const model = compile(`sketch({id:'drawing'}, [text({id:'note', text:'Mount me', height:1, size:[6,3]})]);`, 'model');
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

test('missing letter height defaults to one inch with the current top-left anchor', () => {
  const { textHeight: _height, ...withoutHeight } = shape;
  const restored = validateSketchShapes([withoutHeight])[0];
  assert.deepEqual(restored, shape);
  assert.deepEqual(sketchShapeOrigin(restored), [-2, 1]);
  for (const kind of ['sketch', 'model'] as const) {
    const text = 'text({id:"label", text:"Label", size:[6,3], position:[2,4]})';
    const result = compile(kind === 'sketch' ? text : 'sketch({}, [' + text + ']);', kind);
    const label = kind === 'sketch' ? result.rectangles[0] : result.sketches![0].shapes[0];
    assert.equal(label.kind, 'text');
    assert.equal(label.textHeight, 1);
    assert.deepEqual(label.position, [2, 4]);
    assert.deepEqual(sketchShapeOrigin(label), [2, 1]);
    assert.match(generateSketchSource([label]), /height: inch\("1"\)/);
  }
  for (const height of [null, 0, -1, Infinity, 'bad', false]) {
    receive({ data: { source: 'text({text:"Label",height:' + JSON.stringify(height) + '})', kind: 'sketch' } });
    assert.ok(response.error, 'invalid explicit heights must not silently default');
  }
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
