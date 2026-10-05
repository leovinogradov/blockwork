import test from 'node:test';
import assert from 'node:assert/strict';
import { autoMeasurementPlane, DEFAULT_MEASUREMENT_OFFSET, measurementAnnotationLayout, measurementPlaneLayout, measurementOffsetAtPointer, measurementSegments, pruneMeasurements, resolveMeasurement, resolveMeasurementAnchor, snapMeasurement, validateMeasurements, type Measurement } from '../src/measurements';
import { generateSource, reparentBox, resolveModel, type BoxSpec, type ModelSpec } from '../src/model';
import { generateSketchSource, type SketchShape } from '../src/sketch';
import { createDocument, resolveSnapshot, restoreWorkspace, serializeWorkspace } from '../src/documents';
import type { CompiledSketch } from '../src/compiler';
import { planTreeMove } from '../src/component-tree';
import type { ModelSketch } from '../src/model-sketch';

const box: BoxSpec = { id: 'box', name: 'Box', size: [12, 8, 6], position: [1, 2, 3], color: '#86a9a3' };
const rectangle: SketchShape = { id: 'rect', name: 'Rectangle', size: [12, 8], position: [1, 2], color: '#ffffff' };
const dimension: Measurement = { id: 'width', start: { objectId: 'box', coordinates: [0, 0, 1] }, end: { objectId: 'box', coordinates: [1, 0, 1] } };
const sketchDimension: Measurement = { id: 'sketch-width', start: { objectId: 'rect', coordinates: [0, 1] }, end: { objectId: 'rect', coordinates: [1, 1] } };

test('mouse placement stores a signed inch distance independent of endpoint order or the view', () => {
  const a: [number, number, number] = [0, 0, 0], b: [number, number, number] = [12, 0, 0];
  assert.equal(measurementOffsetAtPointer(a, b, [6, 2, 0]), 2);
  assert.equal(measurementOffsetAtPointer(b, a, [6, 2, 0]), 2);
  assert.equal(measurementOffsetAtPointer(a, b, [6, -1.5, 0]), -1.5);
  assert.equal(measurementOffsetAtPointer(a, b, [1000, 2, 0]), 2);
  assert.equal(measurementOffsetAtPointer(a, b, [6, 2, 20]), 2);
  assert.equal(measurementOffsetAtPointer(a, b, [6, 20, 2], 'xz'), 2);
  assert.equal(measurementOffsetAtPointer([0, 0, 0], [0, 12, 0], [-2, 6, 0]), 2);
});

test('annotation positions and label height use model units in the same schema for both views', () => {
  const a: [number, number, number] = [0, 0, 3], b: [number, number, number] = [12, 0, 3];
  const model = measurementAnnotationLayout(a, b, { plane: 'xz', offset: 2, lineHeight: 4 });
  assert.deepEqual(model.dimensionStart, [0, 0, 5]);
  assert.deepEqual(model.dimensionEnd, [12, 0, 5]);
  assert.deepEqual(model.labelPosition, [6, 0, 5]);
  assert.equal(model.lineHeight, 4);
  const sketch = measurementAnnotationLayout(a, b, { plane: 'xz', offset: -1.5, lineHeight: 2 }, true);
  assert.deepEqual(sketch.labelPosition, [6, -1.5, 3]);
  assert.equal(sketch.plane, 'xy'); assert.equal(sketch.lineHeight, 2);
  const defaults = measurementAnnotationLayout(a, b, {});
  assert.equal(defaults.offset, DEFAULT_MEASUREMENT_OFFSET);
  assert.equal(defaults.lineHeight, 1);
});

test('corner and fractional edge anchors follow resizing and translation without freezing points', () => {
  const edge = { objectId: 'box', coordinates: [0.25, 0, 1] };
  assert.deepEqual(resolveMeasurementAnchor(edge, { boxes: [box] }), [4, 2, 9]);
  const edited = { ...box, size: [20, 10, 7] as [number, number, number], position: [10, 20, 30] as [number, number, number] };
  assert.deepEqual(resolveMeasurementAnchor(edge, { boxes: [edited] }), [15, 20, 37]);
  assert.equal(resolveMeasurement(dimension, { boxes: [edited] })!.distance, 20);
  assert.deepEqual(edge.coordinates, [0.25, 0, 1]);
});

test('sketch rectangle edges and signed line fractions follow edited geometry', () => {
  assert.deepEqual(resolveMeasurementAnchor({ objectId: 'rect', coordinates: [1, 0.5] }, { rectangles: [rectangle] }), [13, 6, 0]);
  const line: SketchShape = { ...rectangle, id: 'line', kind: 'line', position: [10, 4], size: [-8, 6] };
  const anchor = { objectId: 'line', coordinates: [0.25] };
  assert.deepEqual(resolveMeasurementAnchor(anchor, { rectangles: [line] }), [8, 5.5, 0]);
  assert.deepEqual(resolveMeasurementAnchor(anchor, { rectangles: [{ ...line, size: [-4, -8] }] }), [9, 2, 0]);
});

test('nested group movement and reparenting preserve measurement references', () => {
  const groups = [{ id: 'root', name: 'Root', position: [10, 20, 30] as [number, number, number] }, { id: 'inner', name: 'Inner', position: [1, 2, 3] as [number, number, number], parentId: 'root' }];
  const grouped = { ...box, groupId: 'inner' };
  assert.deepEqual(resolveMeasurementAnchor(dimension.start, { boxes: [grouped], groups }), [12, 24, 42]);
  const detached = reparentBox(grouped, groups);
  assert.deepEqual(resolveMeasurement(dimension, { boxes: [detached], groups }), resolveMeasurement(dimension, { boxes: [grouped], groups }));
  groups[0].position[0] += 5;
  assert.deepEqual(resolveMeasurementAnchor(dimension.start, { boxes: [grouped], groups }), [17, 24, 42]);
});

test('measurements between boxes follow resolved variables and face-linked placements', () => {
  const child = { ...box, id: 'child', size: [2, 2, 2], relative: { boxId: 'box', face: 'right', offset: 'var(gap)' } };
  const measure: Measurement = { id: 'gap', start: { objectId: 'box', coordinates: [1, 0, 0] }, end: { objectId: 'child', coordinates: [0, 0, 0] } };
  const model = (gap: number) => resolveModel([box, child], [{ name: 'gap', value: gap }], [], [], [measure]);
  assert.equal(resolveMeasurement(measure, model(3))!.distance, 3);
  assert.equal(resolveMeasurement(measure, model(5))!.distance, 5);
});

test('mounted sketch frame and shape edges resolve on every normal axis with group transforms', () => {
  for (const axis of ['x', 'y', 'z'] as const) {
    const sketch: ModelSketch = { id: 'plane', name: 'Plane', axis, position: [10, 20, 30], size: [12, 8], color: '#ffffff', shapes: [rectangle], groupId: 'g' };
    const groups = [{ id: 'g', name: 'Group', position: [3, 4, 5] as [number, number, number] }];
    const anchor = { objectId: 'plane', shapeId: 'rect', coordinates: [1, 1] };
    const expected = axis === 'x' ? [13, 37, 45] : axis === 'y' ? [26, 24, 45] : [26, 34, 35];
    assert.deepEqual(resolveMeasurementAnchor(anchor, { sketches: [sketch], groups }), expected);
  }
});

test('validation rejects missing references, face interiors, malformed coordinates, and invalid offsets', () => {
  for (const coordinates of [[0.5, 0.5, 1], [0.5, 0.5, 0.5], [2, 0, 1], [NaN, 0, 1], [0, 1], [0, 0, Infinity]]) {
    assert.throws(() => validateMeasurements([{ ...dimension, start: { objectId: 'box', coordinates } }], { boxes: [box] }), /corner or edge/);
  }
  assert.throws(() => validateMeasurements([dimension], { boxes: [] }), /missing geometry/);
  assert.throws(() => validateMeasurements([dimension, dimension], { boxes: [box] }), /unique ID/);
  assert.throws(() => validateMeasurements([{ ...dimension, offset: Infinity }], { boxes: [box] }), /offset/);
  assert.equal(validateMeasurements([{ ...dimension, offset: -1.5, lineHeight: .25 }], { boxes: [box] })[0].offset, -1.5);
  for (const lineHeight of [0, -1, Infinity, NaN, '4']) assert.throws(() => validateMeasurements([{ ...dimension, lineHeight }], { boxes: [box] }), /line height/);
});

test('deleting geometry prunes only its attached measurements and hidden geometry cannot be picked', () => {
  assert.deepEqual(pruneMeasurements([dimension, sketchDimension], { rectangles: [rectangle] }), [sketchDimension]);
  assert.deepEqual(measurementSegments({ boxes: [box], rectangles: [rectangle] }, new Set(['box'])).length, 4);
  assert.equal(measurementSegments({ boxes: [box] }).length, 12);
  assert.equal(resolveMeasurement(dimension, { boxes: [] }), null);
});

test('pixel snapping favors corners, rejects empty space and occluded geometry, and corrects perspective fractions', () => {
  const line: SketchShape = { ...rectangle, id: 'line', kind: 'line', position: [0, 0], size: [100, 0] };
  const segments = measurementSegments({ rectangles: [line] });
  const project = ([x, y]: number[]) => ({ x, y, w: x === 0 ? 1 : 2, visible: true });
  assert.equal(snapMeasurement([2, 1], segments, project)!.kind, 'corner');
  assert.equal(snapMeasurement([50, 0], segments, project)!.anchor.coordinates[0], 1 / 3);
  assert.equal(snapMeasurement([50, 40], segments, project), null);
  assert.equal(snapMeasurement([50, 0], segments, project, () => false), null);
});

type CompilerResult = Partial<ModelSpec & CompiledSketch> & { error?: string };
let receive: (event: { data: { source: string; kind: 'model' | 'sketch' } }) => void;
let compiled: CompilerResult;
(globalThis as any).self = { addEventListener: (_: string, callback: typeof receive) => { receive = callback; }, postMessage: (result: CompilerResult) => { compiled = result; } };
await import('../src/compiler.worker');
function compile(source: string, kind: 'model' | 'sketch') { receive({ data: { source, kind } }); return compiled; }

test('model and sketch measurements round-trip through editable source and the compiler worker', () => {
  const placedModel: Measurement = { ...dimension, offset: 2.25, lineHeight: 4, plane: 'xz' };
  const placedSketch: Measurement = { ...sketchDimension, offset: -1.5, lineHeight: .5, plane: 'yz' };
  const modelSource = generateSource([box], [], [], [], [], [placedModel]);
  const model = compile(modelSource, 'model');
  assert.equal(model.error, undefined); assert.deepEqual(model.measurements, [placedModel]);
  const sketchSource = generateSketchSource([rectangle], [], [], [placedSketch]);
  const sketch = compile(sketchSource, 'sketch');
  assert.equal(sketch.error, undefined); assert.deepEqual(sketch.measurements, [placedSketch]);
  assert.equal(resolveMeasurement(sketchDimension, { rectangles: sketch.rectangles })!.distance, 12);
  assert.match(compile('measurement({id:"bad",start:{objectId:"missing",coordinates:[0,0]},end:{objectId:"missing",coordinates:[1,0]}});', 'sketch').error!, /missing geometry/);
});

test('workspace recovery and undo snapshots retain attached measurements in both document kinds', () => {
  for (const kind of ['model', 'sketch'] as const) {
    const doc = createDocument(kind, '', kind);
    doc.boxes = kind === 'model' ? [box] : []; doc.rectangles = kind === 'sketch' ? [rectangle] : [];
    doc.groups = [{ id: 'annotations', name: 'Annotations', position: [10, 20, 0] }];
    doc.measurements = [{ ...(kind === 'model' ? dimension : sketchDimension), offset: -1.75, lineHeight: 4, plane: 'xz', groupId: 'annotations' }];
    doc.treeOrder = [doc.measurements[0].id, 'annotations', ...(kind === 'model' ? doc.boxes : doc.rectangles).map((s) => s.id)];
    doc.hiddenBoxIds = [doc.measurements[0].id]; doc.draftDirty = false;
    doc.source = doc.appliedSource = kind === 'model' ? generateSource(doc.boxes, [], doc.groups, doc.treeOrder, [], doc.measurements) : generateSketchSource(doc.rectangles, doc.groups, doc.treeOrder, doc.measurements);
    const recovered = restoreWorkspace(serializeWorkspace([doc], doc.id)).documents[0];
    assert.deepEqual(recovered.measurements, doc.measurements);
    assert.deepEqual(recovered.treeOrder, doc.treeOrder);
    assert.deepEqual(recovered.hiddenBoxIds, doc.hiddenBoxIds);
    const restored = resolveSnapshot(recovered.history[0], kind);
    assert.deepEqual(restored.measurements, doc.measurements);
    assert.equal(resolveMeasurement(restored.measurements[0], restored)!.distance, 12);
  }
});


test('creation plane is chosen from the first-click view without knowing the second endpoint', () => {
  assert.equal(autoMeasurementPlane([0, -1, 0]), 'xz');
  assert.equal(autoMeasurementPlane([0, 0, -1]), 'xy');
  assert.equal(autoMeasurementPlane([-1, 0, 0]), 'yz');
  assert.equal(autoMeasurementPlane([.2, -.9, .3]), 'xz');
});

test('saved planes are concrete and legacy auto planes migrate to a fixed plane', () => {
  const migrated = validateMeasurements([{ ...dimension, plane: 'auto' }], { boxes: [box] })[0];
  assert.equal(migrated.plane, 'xy');
  const saved: Measurement = { ...dimension, plane: autoMeasurementPlane([0, -1, 0]) };
  const topViewPlane = autoMeasurementPlane([0, 0, -1]);
  assert.equal(topViewPlane, 'xy');
  const compiled = compile(generateSource([box], [], [], [], [], [saved]), 'model');
  assert.equal(compiled.measurements![0].plane, 'xz');
  assert.equal(validateMeasurements(compiled.measurements, { boxes: [box] })[0].plane, 'xz');
});

test('plane layout projects annotation geometry while retaining the true 3D distance', () => {
  const start: [number, number, number] = [1, 2, 3], end: [number, number, number] = [4, 6, 15];
  for (const [plane, normalAxis] of [['xy', 2], ['xz', 1], ['yz', 0]] as const) {
    const layout = measurementPlaneLayout(start, end, plane);
    assert.equal(layout.start[normalAxis], layout.midpoint[normalAxis]);
    assert.equal(layout.end[normalAxis], layout.midpoint[normalAxis]);
    assert.equal(layout.direction[normalAxis], 0); assert.equal(layout.perpendicular[normalAxis], 0);
    assert.ok(Math.abs(layout.direction.reduce((dot, n, i) => dot + n * layout.perpendicular[i], 0)) < 1e-10);
    assert.deepEqual(layout.direction, measurementPlaneLayout(end, start, plane).direction);
    const diagonal = { ...dimension, plane, start: { objectId: 'a', coordinates: [0, 0, 0] }, end: { objectId: 'b', coordinates: [0, 0, 0] } };
    assert.equal(resolveMeasurement(diagonal, { boxes: [{ ...box, id: 'a', position: start }, { ...box, id: 'b', position: end }] })!.distance, 13);
  }
  assert.throws(() => validateMeasurements([{ ...dimension, plane: 'x' }], { boxes: [box] }), /plane/);
});

test('measurement group membership organizes annotations without applying group transforms in either view', () => {
  for (const kind of ['model', 'sketch'] as const) {
    const groups = [{ id: 'geometry', name: 'Geometry', position: [10, 20, 0] as [number, number, number] }, { id: 'annotations', name: 'Annotations', position: [100, 200, 0] as [number, number, number] }];
    const m: Measurement = { ...(kind === 'model' ? dimension : sketchDimension), groupId: 'annotations' };
    const geometry = { groups, boxes: kind === 'model' ? [{ ...box, groupId: 'geometry' }] : [], rectangles: kind === 'sketch' ? [{ ...rectangle, groupId: 'geometry' }] : [] };
    const before = resolveMeasurement(m, geometry)!;
    groups[1].position[0] += 500;
    assert.deepEqual(resolveMeasurement(m, geometry), before);
    groups[0].position[0] += 7;
    assert.deepEqual(resolveMeasurement(m, geometry)!.start, [before.start[0] + 7, before.start[1], before.start[2]]);
    assert.equal(resolveMeasurement(m, geometry)!.distance, before.distance);
    const move = planTreeMove(groups, [...geometry.boxes, ...geometry.rectangles, m], [], m.id, { placement: 'inside', targetId: 'geometry' });
    assert.equal(move.parentId, 'geometry');
    assert.deepEqual(resolveMeasurement({ ...m, groupId: move.parentId }, geometry), resolveMeasurement(m, geometry));
    assert.throws(() => validateMeasurements([{ ...m, groupId: 'missing' }], geometry), /missing group/);
    assert.throws(() => validateMeasurements([{ ...m, id: geometry.boxes[0]?.id ?? geometry.rectangles[0].id }], geometry), /unique ID/);
  }
});

test('nested source groups accept measurements and retain their placement without double transformations', () => {
  for (const kind of ['model', 'sketch'] as const) {
    const geometrySource = kind === 'model' ? 'box({id:"box",size:[12,8,6],position:[1,2,3]})' : 'rectangle({id:"rect",size:[12,8],position:[1,2]})';
    const m = { ...(kind === 'model' ? dimension : sketchDimension), name: 'Width', offset: 66, plane: 'xz' };
    const source = 'group({id:"root",position:[10,20,0]},[group({id:"notes",position:[400,500,0]},[measurement(' + JSON.stringify(m) + ')]),' + geometrySource + ']);';
    const result = compile(source, kind);
    assert.equal(result.error, undefined);
    assert.equal(result.measurements![0].groupId, 'notes');
    assert.equal(resolveMeasurement(result.measurements![0], result)!.distance, 12);
    const regenerated = kind === 'model' ? generateSource(result.boxes!, [], result.groups, [], [], result.measurements) : generateSketchSource(result.rectangles!, result.groups, [], result.measurements);
    assert.deepEqual(compile(regenerated, kind).measurements, result.measurements);
    assert.doesNotMatch(regenerated, /groupId/);
    assert.match(compile('group({id:"g"},[measurement(' + JSON.stringify(m) + '),measurement(' + JSON.stringify(m) + ')]);' + geometrySource + ';', kind).error!, /unique ID/);
  }
});


test('old local pixel measurements migrate to default inch distances while drafts and references survive', () => {
  for (const kind of ['model', 'sketch'] as const) {
    const doc = createDocument(kind, '// pending custom source', kind);
    doc.boxes = kind === 'model' ? [box] : []; doc.rectangles = kind === 'sketch' ? [rectangle] : [];
    doc.measurements = [{ ...(kind === 'model' ? dimension : sketchDimension), offset: -80, plane: 'xz' }];
    doc.appliedSource = '// last applied source';
    const legacy = JSON.parse(serializeWorkspace([doc], doc.id)); delete legacy.measurementUnits;
    const restored = restoreWorkspace(JSON.stringify(legacy)).documents[0];
    assert.equal(restored.source, doc.source); assert.equal(restored.draftDirty, true);
    assert.equal(restored.measurements[0].offset, -DEFAULT_MEASUREMENT_OFFSET);
    assert.equal(restored.measurements[0].plane, 'xz');
    assert.deepEqual(restored.measurements[0].start, doc.measurements[0].start);
    assert.equal(compile(restored.appliedSource, kind).measurements![0].offset, -DEFAULT_MEASUREMENT_OFFSET);
    assert.deepEqual(restoreWorkspace(serializeWorkspace([restored], restored.id)).documents[0].measurements, restored.measurements);
  }
});
