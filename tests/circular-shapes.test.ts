import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankDocument, restoreWorkspace, serializeWorkspace, resolveSnapshot } from '../src/documents';
import { createCylinderFromFace, cylinderAxes, cylinderAxisOrder, cylinderSize, getFaceFrame, reorientCylinder, generateSource, removeVariable, validateBoxes, type FaceName, type ModelSpec } from '../src/model';
import { circleFromCenter, generateSketchSource, snapToSketchEdges, validateSketchShapes } from '../src/sketch';
import { measurementSegments, resolveMeasurementAnchor, snapMeasurement, validateMeasurements, type Measurement, type MeasurementGeometry } from '../src/measurements';
import { sketchShapesInBox } from '../src/sketch-selection';
import { sketchReference } from '../src/model-sketch';

let receive: (event: { data: { source: string; kind: 'model' | 'sketch' } }) => void;
let result: ModelSpec & { rectangles?: ReturnType<typeof validateSketchShapes>; error?: string };
(globalThis as any).self = {
  addEventListener: (_: string, listener: typeof receive) => { receive = listener; },
  postMessage: (response: typeof result) => { result = response; },
};
await import('../src/compiler.worker');
const compile = (source: string, kind: 'model' | 'sketch' = 'model') => { receive({ data: { source, kind } }); assert.equal(result.error, undefined); return result; };
const circle = circleFromCenter([3, 4], 2, 'c', 'Circle', '#fff');
const cylinder = validateBoxes([{ id: 'solid', name: 'Cylinder', kind: 'cylinder', size: [4, 4, 6], position: [10, 20, 30], color: '#fff' }])[0];
const centerMeasurement: Measurement = { id: 'centers', start: { objectId: 'solid', coordinates: [0.5, 0.5, 0] }, end: { objectId: 'solid', coordinates: [0.5, 0.5, 1] } };
const project = ([x, y]: number[]) => ({ x: x * 100, y: y * 100, w: 1, visible: true });

test('circles accept fractional radii and preserve the clicked center', () => {
  const small = circleFromCenter([3, 4], '1/64', 'tiny', 'Tiny circle', '#fff');
  assert.deepEqual(small.size, [1 / 32, 1 / 32]);
  assert.deepEqual(small.position, [3 - 1 / 64, 4 - 1 / 64]);
  assert.deepEqual(resolveMeasurementAnchor({ objectId: 'tiny', coordinates: [0.5, 0.5] }, { rectangles: [small] }), [3, 4, 0]);
  const source = generateSketchSource([small]);
  assert.match(source, /circle\(.*radius:/);
  assert.deepEqual(compile(source, 'sketch').rectangles, [small]);
  const referenced = circleFromCenter([1 / 128, 1 / 128], '3/64', 'ref', 'Referenced circle', '#fff');
  assert.deepEqual(resolveMeasurementAnchor({ objectId: 'ref', coordinates: [0.5, 0.5] }, { rectangles: [referenced] }), [1 / 128, 1 / 128, 0]);
  for (const d of [0, -1, '1/256', Infinity]) assert.throws(() => circleFromCenter([0, 0], d, 'bad', 'Bad', '#fff'));
  assert.throws(() => validateSketchShapes([{ ...circle, size: [2, 3] }]), /diameter/);
});

test('drawing snaps to circle centers and the real circumference without square corners', () => {
  assert.deepEqual(snapToSketchEdges([3.02, 4.03], [circle], 0.2), { point: [3, 4], kind: 'center' });
  const snap = snapToSketchEdges([4.44, 5.44], [circle], 0.2);
  assert.equal(snap.kind, 'edge');
  assert.ok(Math.abs(Math.hypot(snap.point[0] - 3, snap.point[1] - 4) - 2) < 1e-10);
  assert.equal(snapToSketchEdges([1, 2], [circle], 0.2).kind, null);
});

test('circle and cylinder source helpers retain groups, mounted circles and variable radii', () => {
  const model = compile(`variable({name:'r',value:inch('2')}); group({id:'g',position:[1,2,3]}, [
    cylinder({id:'solid',radius:inch('var(r)'),length:inch('6')}),
    sketch({id:'drawing',axis:'y'}, [circle({id:'c',radius:inch('1 1/64'),position:[1.25,2.5]})])
  ]);`);
  assert.equal(model.boxes[0].kind, 'cylinder');
  assert.deepEqual(model.boxes[0].size, [4, 4, 6]);
  assert.equal(model.boxes[0].groupId, 'g');
  assert.equal(model.sketches![0].shapes[0].kind, 'circle');
  const source = generateSource(model.boxes, model.variables, model.groups, [], model.sketches);
  assert.match(source, /cylinder\(.*radius: "var\(r\)"/);
  assert.match(source, /length: inch\("6"\)/);
  assert.deepEqual(compile(source), model);
  assert.deepEqual(validateBoxes(model.boxes, [{ name: 'r', value: 2.5 }], model.groups)[0].size, [5, 5, 6]);
  assert.throws(() => validateBoxes([{ ...cylinder, size: [2, 3, 4] }]), /diameter/);
  assert.throws(() => validateBoxes([{ ...cylinder, size: [0, 0, 4] }]), /positive/);
});

test('measurements snap to circle centers and both cylinder end centers, and follow resizing', () => {
  const geometry = { rectangles: [circle], boxes: [cylinder] };
  const segments = measurementSegments(geometry);
  assert.deepEqual(snapMeasurement([300, 400], segments, project)?.anchor, { objectId: 'c', coordinates: [0.5, 0.5] });
  const bottomProject = ([x, , z]: number[]) => ({ x: x * 100, y: z * 100, w: 1, visible: true });
  const bottom = snapMeasurement([1200, 3000], segments, bottomProject);
  const top = snapMeasurement([1200, 3600], segments, bottomProject);
  assert.equal(bottom?.kind, 'center'); assert.equal(top?.kind, 'center');
  assert.deepEqual(bottom?.anchor, centerMeasurement.start);
  assert.deepEqual(top?.anchor, centerMeasurement.end);
  assert.deepEqual(validateMeasurements([centerMeasurement], geometry), [centerMeasurement]);
  const changed = { boxes: [{ ...cylinder, size: [8, 8, 12] as [number, number, number], position: [1, 2, 3] as [number, number, number] }] };
  assert.deepEqual(resolveMeasurementAnchor(centerMeasurement.start, changed), [5, 6, 3]);
  assert.deepEqual(resolveMeasurementAnchor(centerMeasurement.end, changed), [5, 6, 15]);
  assert.equal(snapMeasurement([300, 400], measurementSegments(geometry, new Set(['c'])), project), null);
  assert.equal(snapMeasurement([300, 400], segments, project, () => false), null);
});

test('cylinder radius expressions remain stable through repeated exports and variable removal', () => {
  let model = compile(`variable({name:'r',value:inch('1 1/2')}); cylinder({id:'s',radius:'var(r)',length:4});`);
  assert.deepEqual(model.boxes[0].size, [3, 3, 4]);
  assert.deepEqual(model.boxes[0].expressions, { radius: 'var(r)' });
  const originalSource = generateSource(model.boxes, model.variables);
  for (let i = 0; i < 3; i++) {
    model = compile(generateSource(model.boxes, model.variables));
    assert.equal(generateSource(model.boxes, model.variables), originalSource);
  }
  const changed = validateBoxes(model.boxes, [{ name: 'r', value: 2.25 }]);
  assert.deepEqual(changed[0].size, [4.5, 4.5, 4]);
  const detached = removeVariable(model.boxes, model.variables, 'r');
  assert.deepEqual(detached.boxes[0].size, [3, 3, 4]);
  assert.doesNotMatch(generateSource(detached.boxes, detached.variables), /var\(r\)/);
});

test('cylinder radii snap before doubling and require a positive radius', () => {
  assert.deepEqual(compile(`cylinder({radius:inch('1/64'),length:1});`).boxes[0].size, [1 / 32, 1 / 32, 1]);
  for (const radius of ['0', '-1', '1/256']) {
    receive({ data: { source: `cylinder({radius:'${radius}',length:1});`, kind: 'model' } });
    assert.match(result.error!, /radius must be positive/);
  }
  assert.throws(() => validateBoxes([{ ...cylinder, kind: undefined, expressions: { radius: '1' } }]), /require a cylinder/);
});

test('rim measurements remain on the exact circle and cylinder circumference between sampled vertices', () => {
  for (const geometry of [{ rectangles: [circle] }, { boxes: [{ ...cylinder, position: [1, 2, 0] as [number, number, number] }] }] satisfies MeasurementGeometry[]) {
    const angle = 0.31, point: [number, number] = [3 + 2 * Math.cos(angle), 4 + 2 * Math.sin(angle)];
    const snap = snapMeasurement(point.map((n) => n * 100) as [number, number], measurementSegments(geometry), project)!;
    assert.equal(snap.kind, 'edge');
    assert.ok(Math.abs(Math.hypot(snap.anchor.coordinates[0] - 0.5, snap.anchor.coordinates[1] - 0.5) - 0.5) < 1e-10);
    const resolved = resolveMeasurementAnchor(snap.anchor, geometry)!;
    assert.ok(resolved.every((n, i) => Math.abs(n - snap.point[i]) < 1e-10));
    assert.doesNotThrow(() => validateMeasurements([{ id: 'rim', start: snap.anchor, end: snap.anchor }], geometry));
  }
});

test('circular anchors reject bounding corners, face interiors and cylinder side interiors', () => {
  for (const coordinates of [[0, 0, 0], [0.6, 0.5, 0], [0.5, 0.5, 0.5], [1, 0.5, 0.5]]) {
    assert.throws(() => validateMeasurements([{ ...centerMeasurement, start: { objectId: 'solid', coordinates } }], { boxes: [cylinder] }), /rim or end center/);
  }
});

test('mounted circle centers and rims measure in the sketch plane within nested groups', () => {
  const geometry: MeasurementGeometry = { sketches: [{ id: 'drawing', name: 'Drawing', axis: 'x', size: [10, 10], position: [1, 2, 3], color: '#fff', groupId: 'g', shapes: [circle] }], groups: [{ id: 'g', name: 'Group', position: [10, 20, 30] }] };
  const anchor = { objectId: 'drawing', shapeId: 'c', coordinates: [0.5, 0.5] };
  assert.deepEqual(resolveMeasurementAnchor(anchor, geometry), [11, 25, 37]);
  assert.ok(measurementSegments(geometry).some((segment) => segment.pointKind === 'center' && segment.start.shapeId === 'c'));
  assert.doesNotThrow(() => validateMeasurements([{ id: 'm', start: anchor, end: anchor }], geometry));
});

test('circle and cylinder documents recover geometry and center measurements in undo snapshots', () => {
  const model = createBlankDocument([], 'model'); model.boxes = [cylinder]; model.measurements = [centerMeasurement];
  model.source = model.appliedSource = generateSource([cylinder], [], [], [], [], [centerMeasurement]);
  const sketch = createBlankDocument([model], 'sketch'); sketch.rectangles = [circle];
  sketch.source = sketch.appliedSource = generateSketchSource([circle]);
  const recovered = restoreWorkspace(serializeWorkspace([model, sketch], sketch.id));
  assert.deepEqual(recovered.documents[0].boxes, [cylinder]);
  assert.deepEqual(recovered.documents[0].measurements, [centerMeasurement]);
  assert.deepEqual(recovered.documents[1].rectangles, [circle]);
  assert.deepEqual(resolveSnapshot(recovered.documents[0].history[0], 'model').boxes, [cylinder]);
  assert.deepEqual(sketchReference([circle]).size, [4, 4]);
});

test('circle marquee ignores empty corners of its bounding square', () => {
  const project = (p: [number, number]) => p;
  assert.deepEqual(sketchShapesInBox([circle], [2.9, 3.9], [3.1, 4.1], project, new Set()), ['c']);
  assert.deepEqual(sketchShapesInBox([circle], [1, 2], [1.2, 2.2], project, new Set()), []);
});

test('cylinders attach flush and point outward from every face, following their parent', () => {
  const parent = validateBoxes([{ ...cylinder, id: 'parent', kind: undefined, size: [8, 6, 4] }])[0];
  for (const face of ['left', 'right', 'front', 'back', 'top', 'bottom'] as FaceName[]) {
    const frame = getFaceFrame(face);
    const child = createCylinderFromFace(parent, face, 'child', [], { radius: 1, length: 3 });
    const { lengthAxis } = cylinderAxes(child);
    assert.equal(lengthAxis, frame.normalAxis);
    assert.deepEqual(child.size, cylinderSize(1, 3, (['x', 'y', 'z'] as const)[lengthAxis]));
    const contact = child.position[lengthAxis] + (frame.normalSign < 0 ? child.size[lengthAxis] : 0);
    assert.equal(contact, parent.position[lengthAxis] + (frame.normalSign > 0 ? parent.size[lengthAxis] : 0));
    const moved = { ...parent, position: [2, 3, 5] as [number, number, number], size: [10, 8, 6] as [number, number, number] };
    const resolved = validateBoxes([moved, child])[1];
    assert.equal(resolved.position[lengthAxis] + (frame.normalSign < 0 ? 3 : 0), moved.position[lengthAxis] + (frame.normalSign > 0 ? moved.size[lengthAxis] : 0));
    assert.deepEqual(compile(generateSource([parent, child])).boxes, [parent, child]);
    const fitted = createCylinderFromFace(parent, face, 'fitted');
    assert.equal(fitted.size[cylinderAxes(fitted).radialAxes[0]], Math.min(parent.size[frame.uAxis], parent.size[frame.vAxis]));
  }
});

test('X, Y and Z cylinders retain expressions through axis edits and source round trips', () => {
  const model = compile(`variable({name:'r',value:2}); variable({name:'h',value:7}); cylinder({id:'s',radius:'var(r)',length:'var(h)'});`);
  let solid = model.boxes[0];
  for (const axis of ['x', 'y', 'z'] as const) {
    solid = reorientCylinder(solid, axis);
    assert.deepEqual(solid.size, cylinderSize(2, 7, axis));
    assert.deepEqual(solid.expressions, { radius: 'var(r)', [`size.${cylinderAxes(solid).lengthAxis}`]: 'var(h)' });
    const resolved = validateBoxes([solid], model.variables);
    assert.deepEqual(compile(generateSource(resolved, model.variables)).boxes, resolved);
    assert.deepEqual(validateBoxes([solid], [{ name: 'r', value: 3 }, { name: 'h', value: 9 }])[0].size, cylinderSize(3, 9, axis));
  }
  assert.throws(() => validateBoxes([{ ...solid, axis: 'w' }]), /axis/);
  receive({ data: { source: `cylinder({radius:1,length:2,axis:'w'})`, kind: 'model' } });
  assert.match(result.error!, /axis/);
});

test('oriented cylinder end centers and exact rims snap and resolve in each axial plane', () => {
  for (const axis of ['x', 'y', 'z'] as const) {
    const solid = reorientCylinder(cylinder, axis), geometry = { boxes: [solid] };
    const { radialAxes: [u, v], lengthAxis } = cylinderAxes(solid);
    const order = cylinderAxisOrder(solid);
    assert.deepEqual(order, [u, v, lengthAxis]);
    const segments = measurementSegments(geometry);
    const centers = segments.filter((segment) => segment.pointKind === 'center');
    assert.equal(centers.length, 2);
    for (const center of centers) {
      const coordinates = [0.5, 0.5, 0.5]; coordinates[lengthAxis] = center.start.coordinates[lengthAxis];
      assert.deepEqual(center.start.coordinates, coordinates);
      assert.deepEqual(resolveMeasurementAnchor(center.start, geometry), center.a);
      const projection = (point: number[]) => ({ x: point[u] * 100, y: point[lengthAxis] * 100, w: 1, visible: true });
      assert.equal(snapMeasurement([center.a[u] * 100, center.a[lengthAxis] * 100], segments, projection)?.kind, 'center');
    }
    const angle = 0.31, project = (point: number[]) => ({ x: point[u] * 100, y: point[v] * 100, w: 1, visible: true });
    const cursor: [number, number] = [(solid.position[u] + 2 + 2 * Math.cos(angle)) * 100, (solid.position[v] + 2 + 2 * Math.sin(angle)) * 100];
    const snap = snapMeasurement(cursor, segments, project)!;
    assert.equal(snap.kind, 'edge');
    assert.ok(Math.abs(Math.hypot(snap.anchor.coordinates[u] - 0.5, snap.anchor.coordinates[v] - 0.5) - 0.5) < 1e-10);
    assert.ok(resolveMeasurementAnchor(snap.anchor, geometry)!.every((value, i) => Math.abs(value - snap.point[i]) < 1e-10));
    assert.doesNotThrow(() => validateMeasurements([{ id: 'm', start: centers[0].start, end: snap.anchor }], geometry));
  }
});
