import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateGroupBranch, duplicateTreeSelection, effectiveHiddenIds, removeTreeSelection, treeSelectionRoots } from '../src/group-actions';
import { createBlankDocument, restoreWorkspace, resolveSnapshot, serializeWorkspace } from '../src/documents';
import { worldPosition, type GroupSpec } from '../src/groups';
import { resolveMeasurement, type Measurement } from '../src/measurements';
import { generateSource, resolveModel, type BoxSpec } from '../src/model';
import type { ModelSketch } from '../src/model-sketch';
import { generateSketchSource, validateSketchShapes, type SketchShape } from '../src/sketch';

const groups: GroupSpec[] = [
  { id: 'parent', name: 'Parent', position: [5, 6, 0] },
  { id: 'root', name: 'Assembly', parentId: 'parent', position: [10, 20, 0] },
  { id: 'inner', name: 'Detail', parentId: 'root', position: [2, 3, 0] },
];
const boxes: BoxSpec[] = [
  { id: 'base', name: 'Base', groupId: 'root', position: [1, 2, 3], size: [4, 5, 6], color: '#ffffff', expressions: { 'size.0': 'var(width)' } },
  { id: 'top', name: 'Top', groupId: 'inner', position: [0, 0, 0], size: [4, 5, 1], color: '#ffffff', relative: { boxId: 'base', face: 'top', offset: 0.5, u: { side: 'left', offset: 0 }, v: { side: 'bottom', offset: 0 } } },
  { id: 'external', name: 'External', position: [30, 40, 0], size: [2, 3, 4], color: '#ffffff' },
  { id: 'attached', name: 'Attached', groupId: 'inner', position: [0, 0, 0], size: [2, 3, 1], color: '#ffffff', relative: { boxId: 'external', face: 'top', offset: 0 } },
];
const sketches: ModelSketch[] = [
  { id: 'drawing', name: 'Drawing', groupId: 'inner', position: [0, 0, 10], size: [8, 6], axis: 'z', color: '#ffffff', shapes: [{ id: 'outline', name: 'Outline', position: [0, 0], size: [8, 6], color: '#ffffff' }] },
];
const measurements: Measurement[] = [
  { id: 'height', groupId: 'root', start: { objectId: 'base', coordinates: [0, 0, 0] }, end: { objectId: 'top', coordinates: [0, 0, 1] } },
  { id: 'drawing-width', groupId: 'inner', start: { objectId: 'drawing', shapeId: 'outline', coordinates: [0, 0] }, end: { objectId: 'drawing', shapeId: 'outline', coordinates: [1, 0] } },
  { id: 'outside-distance', groupId: 'root', start: { objectId: 'base', coordinates: [0, 0, 0] }, end: { objectId: 'external', coordinates: [0, 0, 0] } },
];
const variables = [{ name: 'width', value: 4 }];
function ids() { let i = 0; return () => `copy-${++i}`; }

let receive: (event: { data: { source: string; kind: 'model' | 'sketch' } }) => void;
let compiled: any;
(globalThis as any).self = { addEventListener: (_: string, fn: typeof receive) => { receive = fn; }, postMessage: (value: unknown) => { compiled = value; } };
await import('../src/compiler.worker');

test('mixed selection duplicates branches once and remaps references across selected branches', () => {
  const scene = { groups, boxes, sketches, measurements, rectangles: [] };
  const before = structuredClone(scene);
  const selected = new Set(['root', 'inner', 'base', 'external', 'height']);
  assert.deepEqual(treeSelectionRoots(scene, [...boxes, ...sketches, ...measurements], selected), ['root', 'external']);
  const copy = duplicateTreeSelection(scene, selected, [], ids());
  assert.equal(copy.boxes.length, 4);
  assert.equal(copy.groups.length, 2);
  assert.equal(copy.rootIds.length, 2);
  assert.deepEqual(copy.groups[0].position, [11, 21, 0]);
  assert.deepEqual(copy.groups[1].position, groups[2].position);
  assert.deepEqual(copy.boxes.find((box) => box.id === copy.ids.get('external'))!.position, [31, 41, 0]);
  assert.equal(copy.boxes.find((box) => box.id === copy.ids.get('attached'))!.relative!.boxId, copy.ids.get('external'));
  assert.equal(copy.measurements.find((m) => m.id === copy.ids.get('outside-distance'))!.end.objectId, copy.ids.get('external'));
  const allGroups = [...groups, ...copy.groups];
  const combined = resolveModel([...boxes, ...copy.boxes], variables, allGroups, [...sketches, ...copy.sketches], [...measurements, ...copy.measurements]);
  receive({ data: { source: generateSource(combined.boxes, variables, allGroups, copy.treeOrder, combined.sketches, combined.measurements), kind: 'model' } });
  assert.equal(compiled.error, undefined);
  assert.equal(compiled.groups.length, 5);
  assert.equal(compiled.boxes.length, 8);
  assert.deepEqual(scene, before);
});

test('deleting multiple containers preserves unselected members and dissolves selected ancestors', () => {
  const resolved = resolveModel(boxes, variables, groups, sketches, measurements);
  const scene = { groups, boxes: resolved.boxes, sketches, measurements, rectangles: [] };
  const next = removeTreeSelection(scene, new Set(['root', 'inner', 'base', 'height']));
  assert.deepEqual(next.groups.map((group) => group.id), ['parent']);
  assert.deepEqual(next.boxes.map((box) => box.id), ['top', 'external', 'attached']);
  assert.equal(next.boxes[0].relative, undefined);
  assert.equal(next.boxes[0].groupId, 'parent');
  assert.deepEqual(worldPosition(next.boxes[0].position, next.groups, next.boxes[0].groupId), worldPosition(resolved.boxes[1].position, groups, 'inner'));
  assert.equal(next.sketches[0].groupId, 'parent');
  assert.equal(next.measurements.some((m) => m.id === 'height'), false);
  assert.equal(next.measurements[0].groupId, 'parent');
});



test('hidden groups mask all descendants while preserving independent hidden settings', () => {
  const items = [...boxes, ...sketches, ...measurements];
  const hidden = new Set(['root', 'top']);
  const actual = effectiveHiddenIds(groups.slice().reverse(), items, hidden);
  for (const id of ['root', 'inner', 'base', 'top', 'attached', 'drawing', 'height', 'drawing-width', 'outside-distance']) assert.ok(actual.has(id), id);
  assert.ok(!actual.has('external'));
  assert.ok(!actual.has('parent'));
  assert.deepEqual(hidden, new Set(['root', 'top']));
  hidden.delete('root');
  assert.deepEqual(effectiveHiddenIds(groups, items, hidden), new Set(['top']));
  assert.deepEqual(effectiveHiddenIds(groups, items, ['inner']), new Set(['inner', 'top', 'attached', 'drawing', 'drawing-width']));
});

test('hidden groups include newly added and reparented members and can be empty', () => {
  assert.ok(effectiveHiddenIds(groups, [{ id: 'new', groupId: 'inner' }], ['root']).has('new'));
  assert.ok(!effectiveHiddenIds(groups, [{ id: 'new' }], ['root']).has('new'));
  assert.deepEqual(effectiveHiddenIds([groups[0]], [], ['parent']), new Set(['parent']));
});

test('duplicating a model branch remaps internal references, retains external references and round-trips source', () => {
  const model = resolveModel(boxes, variables, groups, sketches, measurements);
  const scene = { groups, boxes: model.boxes, sketches, measurements, rectangles: [] };
  const before = structuredClone(scene);
  const order = ['parent', 'root', 'top', 'base', 'inner', 'drawing', 'height', 'attached', 'drawing-width', 'outside-distance', 'external'];
  const copy = duplicateGroupBranch(scene, 'root', order, ids());
  const id = (original: string) => copy.ids.get(original)!;
  assert.deepEqual(copy.groups.map((g) => g.id), [id('root'), id('inner')]);
  assert.equal(copy.groups[0].parentId, 'parent');
  assert.equal(copy.groups[0].name, 'Assembly copy');
  assert.equal(copy.groups[1].parentId, id('root'));
  assert.equal(copy.boxes.find((b) => b.id === id('top'))!.relative!.boxId, id('base'));
  assert.equal(copy.boxes.find((b) => b.id === id('attached'))!.relative!.boxId, 'external');
  assert.equal(copy.measurements[0].start.objectId, id('base'));
  assert.equal(copy.measurements[0].end.objectId, id('top'));
  assert.equal(copy.measurements[1].start.objectId, id('drawing'));
  assert.equal(copy.measurements[1].start.shapeId, 'outline');
  assert.equal(copy.measurements[2].end.objectId, 'external');
  assert.deepEqual(copy.treeOrder.filter((entry) => copy.ids.has(entry)), order.filter((entry) => copy.ids.has(entry)));
  assert.deepEqual(copy.treeOrder.filter((entry) => new Set(copy.ids.values()).has(entry)), order.filter((entry) => copy.ids.has(entry)).map(id));
  assert.equal(copy.treeOrder.indexOf(copy.rootId), copy.treeOrder.indexOf('root') + 1);
  const allGroups = [...groups, ...copy.groups];
  const combined = resolveModel([...model.boxes, ...copy.boxes], variables, allGroups, [...sketches, ...copy.sketches], [...measurements, ...copy.measurements]);
  for (const originalId of ['base', 'top']) {
    const original = model.boxes.find((b) => b.id === originalId)!;
    const duplicate = combined.boxes.find((b) => b.id === id(originalId))!;
    assert.deepEqual(worldPosition(duplicate.position, allGroups, duplicate.groupId), worldPosition(original.position, groups, original.groupId).map((n, i) => n + (i < 2 ? 1 : 0)));
  }
  const geometry = { ...combined, groups: allGroups };
  assert.equal(resolveMeasurement(copy.measurements[0], geometry)!.distance, resolveMeasurement(measurements[0], model)!.distance);
  receive({ data: { source: generateSource(combined.boxes, variables, allGroups, copy.treeOrder, combined.sketches, combined.measurements), kind: 'model' } });
  assert.equal(compiled.error, undefined);
  assert.equal(compiled.groups.length, 5);
  assert.equal(compiled.boxes.length, 7);
  assert.equal(compiled.measurements.length, 6);
  assert.deepEqual(scene, before);
  copy.sketches[0].shapes[0].position[0] = 99;
  copy.boxes[0].expressions!['size.0'] = '8';
  copy.measurements[0].start.coordinates[0] = 1;
  assert.deepEqual(scene, before);
});

test('duplicating mixed sketch groups copies signed lines and measurements on the sketch plane', () => {
  const rectangles: SketchShape[] = [
    { id: 'rectangle', name: 'Rectangle', groupId: 'root', position: [1, 2], size: [4, 5], color: '#ffffff' },
    { id: 'line', name: 'Line', kind: 'line', groupId: 'inner', position: [7, 8], size: [-4, 3], color: '#ffffff' },
  ];
  const dimensions: Measurement[] = [{ id: 'length', groupId: 'inner', start: { objectId: 'line', coordinates: [0] }, end: { objectId: 'line', coordinates: [1] } }];
  const scene = { groups, boxes: [], sketches: [], rectangles, measurements: dimensions };
  const copy = duplicateGroupBranch(scene, 'root', ['parent', 'root', 'inner', 'line', 'rectangle', 'length'], ids());
  const allGroups = [...groups, ...copy.groups], allShapes = validateSketchShapes([...rectangles, ...copy.rectangles], allGroups);
  assert.deepEqual(copy.rectangles[1].size, [-4, 3]);
  for (let i = 0; i < rectangles.length; i++) assert.deepEqual(worldPosition(copy.rectangles[i].position, allGroups, copy.rectangles[i].groupId), worldPosition(rectangles[i].position, groups, rectangles[i].groupId).map((n, axis) => n + (axis < 2 ? 1 : 0)));
  receive({ data: { source: generateSketchSource(allShapes, allGroups, copy.treeOrder, [...dimensions, ...copy.measurements]), kind: 'sketch' } });
  assert.equal(compiled.error, undefined);
  assert.equal(compiled.rectangles.length, 4);
  assert.equal(compiled.measurements.length, 2);
});

test('empty groups duplicate as siblings and unknown groups are rejected', () => {
  const scene = { groups, boxes: [], sketches: [], rectangles: [], measurements: [] };
  const copy = duplicateGroupBranch(scene, 'inner', [], ids());
  assert.equal(copy.groups.length, 1);
  assert.equal(copy.groups[0].parentId, 'root');
  assert.deepEqual(copy.groups[0].position, [3, 4, 0]);
  assert.equal(copy.boxes.length, 0);
  assert.throws(() => duplicateGroupBranch(scene, 'missing', []), /Unknown group/);
});

test('workspace recovery and undo snapshots retain group visibility separately from member visibility', () => {
  for (const kind of ['model', 'sketch'] as const) {
    const doc = createBlankDocument([], kind);
    doc.groups = structuredClone(groups);
    if (kind === 'model') doc.boxes = structuredClone(boxes.filter((b) => b.id === 'external'));
    doc.hiddenBoxIds = ['root', 'inner', 'stale'];
    const recovered = restoreWorkspace(serializeWorkspace([doc], doc.id)).documents[0];
    assert.deepEqual(recovered.hiddenBoxIds, ['root', 'inner']);
    assert.deepEqual(recovered.history[0].hiddenIds, ['root', 'inner']);
    const snapshot = recovered.history[0], geometry = resolveSnapshot(snapshot, kind);
    assert.deepEqual(effectiveHiddenIds(geometry.groups, [...geometry.boxes, ...geometry.rectangles], snapshot.hiddenIds), new Set(['root', 'inner']));
  }
});
