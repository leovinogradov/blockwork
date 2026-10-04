import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, resolveSnapshot, restoreWorkspace, serializeWorkspace } from '../src/documents';
import { pointOnPlane, reparentPosition, worldPosition, type GroupSpec } from '../src/groups';
import { generateSource, resolveModel, type ModelSpec } from '../src/model';
import { modelSketchFrame, modelSketchPoints, sketchReference, validateModelSketches, type ModelSketch } from '../src/model-sketch';

let receive: (event: { data: { source: string; kind: 'model' } }) => void;
let result: ModelSpec & { error?: string };
(globalThis as any).self = {
  addEventListener: (_: string, listener: typeof receive) => { receive = listener; },
  postMessage: (response: typeof result) => { result = response; },
};
await import('../src/compiler.worker');
const compile = (source: string) => { receive({ data: { source, kind: 'model' } }); return result; };
const sketch: ModelSketch = { id: 'drawing', name: 'Drawing', axis: 'z', size: [12, 8], position: [1, 2, 3], color: '#86a9a3', shapes: [
  { id: 'outline', name: 'Outline', size: [12, 8], position: [0, 0], color: '#ffffff' },
  { id: 'diagonal', name: 'Diagonal', kind: 'line', size: [-4, 3], position: [6, 2], color: '#d9a76e' },
] };
const canonical = (model: ModelSpec) => ({ ...model, groups: model.groups?.toSorted((a, b) => a.id.localeCompare(b.id)) });

test('sketch(properties, items) compiles with rectangles, signed lines, and model groups', () => {
  const model = compile(`group({id:'assembly', position:[10,20,30]}, [
    box({id:'board',size:[12,8,1]}),
    sketch({id:'drawing',axis:'y',size:[12,8],position:[1,2,3]}, [
      rectangle({id:'outline',size:[12,8]}),
      line({id:'diagonal',start:[6,2],end:[2,5]})
    ])
  ]);`);
  assert.equal(model.error, undefined);
  assert.equal(model.boxes.length, 1);
  assert.equal(model.sketches!.length, 1);
  const drawing = model.sketches![0];
  assert.equal(drawing.groupId, 'assembly');
  assert.deepEqual(drawing.shapes[1].size, [-4, 3]);
  assert.deepEqual(pointOnPlane(modelSketchFrame(drawing, model.groups), [6, 2]), [17, 22, 35]);
  const source = generateSource(model.boxes, model.variables, model.groups, ['assembly', 'drawing', 'board'], model.sketches);
  assert.doesNotMatch(source, /groupId|"shapes"/);
  assert.ok(source.indexOf('sketch(') < source.indexOf('box('));
  assert.deepEqual(canonical(compile(source)), canonical(model));
});

test('all three normal axes map local shape coordinates and frame corners to 3D', () => {
  const expected = { x: [1, 6, 8], y: [5, 2, 8], z: [5, 7, 3] };
  for (const axis of ['x', 'y', 'z'] as const) {
    const mounted = { ...sketch, axis };
    assert.deepEqual(pointOnPlane(modelSketchFrame(mounted), [4, 5]), expected[axis]);
    const points = modelSketchPoints(mounted);
    assert.equal(points.length, 10);
    assert.deepEqual(points[6], pointOnPlane(modelSketchFrame(mounted), [12, 0]));
    assert.deepEqual(points.at(-1), pointOnPlane(modelSketchFrame(mounted), [2, 5]));
  }
});

test('regrouping and ungrouping preserve a sketch plane and its shape points', () => {
  const groups: GroupSpec[] = [{ id: 'outer', name: 'Outer', position: [10, 20, 30] }, { id: 'inner', name: 'Inner', position: [2, 4, 6], parentId: 'outer' }];
  const original = { ...sketch, axis: 'x' as const, groupId: 'inner' };
  const moved = { ...original, groupId: 'outer', position: reparentPosition(original.position, groups, 'inner', 'outer') };
  const detached = { ...moved, groupId: undefined, position: reparentPosition(moved.position, groups, 'outer') };
  assert.deepEqual(modelSketchFrame(original, groups), modelSketchFrame(moved, groups));
  assert.deepEqual(modelSketchFrame(original, groups), modelSketchFrame(detached));
  const model = resolveModel([], [], groups, [moved]);
  assert.deepEqual(compile(generateSource([], [], groups, [], model.sketches)).sketches, model.sketches);
});

test('copying a 2D sketch flattens nested group positions and fits a finite frame', () => {
  const groups: GroupSpec[] = [{ id: 'outer', name: 'Outer', position: [-10, -20, 0] }, { id: 'inner', name: 'Inner', parentId: 'outer', position: [3, 4, 0] }];
  const shapes = sketch.shapes.map((shape) => ({ ...shape, groupId: 'inner' }));
  const copied = sketchReference(shapes, groups);
  assert.deepEqual(copied.size, [12, 8]);
  assert.deepEqual(copied.shapes.map((shape) => shape.position), [[0, 0], [6, 2]]);
  assert.ok(copied.shapes.every((shape) => !shape.groupId));
  copied.shapes[0].position[0] = 99;
  assert.equal(shapes[0].position[0], 0);
  assert.deepEqual(sketchReference([]), { size: [12, 8], shapes: [] });
  assert.deepEqual(sketchReference([{ ...sketch.shapes[1], position: [5, 8], size: [0, -6] }]).size, [1 / 64, 6]);
});

test('sketch contents, hidden state, draft, and mixed tree order survive recovery and undo', () => {
  const doc = createDocument('model.js', 'unfinished draft');
  doc.sketches = [structuredClone(sketch)];
  doc.groups = [{ id: 'assembly', name: 'Assembly', position: [10, 20, 30] }];
  doc.sketches[0].groupId = 'assembly';
  doc.sketches[0].referenceName = 'panel.js';
  doc.treeOrder = ['assembly', sketch.id];
  doc.hiddenBoxIds = [sketch.id];
  doc.appliedSource = generateSource([], [], doc.groups, doc.treeOrder, doc.sketches);
  const recovered = restoreWorkspace(serializeWorkspace([doc], doc.id)).documents[0];
  assert.deepEqual(recovered.sketches, doc.sketches);
  assert.deepEqual(recovered.treeOrder, doc.treeOrder);
  assert.deepEqual(recovered.hiddenBoxIds, [sketch.id]);
  assert.equal(recovered.source, 'unfinished draft');
  const geometry = resolveSnapshot(recovered.history[0], 'model');
  assert.deepEqual(geometry.sketches, doc.sketches);
  assert.deepEqual(worldPosition(geometry.sketches[0].position, geometry.groups, 'assembly'), [11, 22, 33]);
  geometry.sketches[0].shapes[0].size[0] = 99;
  assert.equal(recovered.sketches[0].shapes[0].size[0], 12);
});

test('invalid planes, dimensions, contents, and IDs are rejected', () => {
  assert.throws(() => validateModelSketches([{ ...sketch, axis: 'diagonal' }]), /axis/);
  assert.throws(() => validateModelSketches([{ ...sketch, size: [12, 0] }]), /positive/);
  assert.throws(() => validateModelSketches([{ ...sketch, position: [1, 2] }]), /3 inch/);
  assert.throws(() => validateModelSketches([{ ...sketch, shapes: [{ ...sketch.shapes[0], groupId: 'outside' }] }]), /Unknown group/);
  assert.throws(() => resolveModel([{ id: 'drawing', name: 'Collision', size: [1, 1, 1], position: [0, 0, 0], color: '#fff' }], [], [], [sketch]), /distinct/);
  assert.throws(() => validateModelSketches([sketch, sketch]), /unique/);
});

test('sketch helper rejects non-shape items, sharing, sparse lists, and legacy properties', () => {
  for (const items of ['null', '{}', "'oops'", '42']) assert.match(compile(`sketch({}, ${items})`).error!, /array/);
  for (const item of ['null', '{}', "box({size:[1,1,1]})", 'group({})', 'sketch({})']) assert.match(compile(`sketch({}, [${item}])`).error!, /rectangle.*line/);
  assert.match(compile('sketch({}, Array(2))').error!, /rectangle.*line/);
  assert.match(compile('const r=rectangle({size:[1,2]}); sketch({},[r,r]);').error!, /twice/);
  assert.match(compile('const r=rectangle({size:[1,2]}); sketch({},[r]); sketch({},[r]);').error!, /two sketches/);
  assert.match(compile("sketch({groupId:'g'})").error!, /groupId is no longer/);
  assert.match(compile('sketch({shapes:[]})').error!, /sketch\(properties, items\)/);
  assert.match(compile('rectangle({size:[1,2]})').error!, /inside sketch/);
  assert.match(compile('group({}, [rectangle({size:[1,2]})])').error!, /inside sketch/);
});

test('empty sketches and independent shape ID scopes round-trip', () => {
  const model = compile("sketch({id:'a'}, [rectangle({id:'r',size:[1,2]})]); sketch({id:'b'}, [rectangle({id:'r',size:[2,3]})]); sketch({id:'empty'},[]);");
  assert.equal(model.error, undefined);
  assert.equal(model.sketches![2].shapes.length, 0);
  assert.deepEqual(compile(generateSource([], [], [], [], model.sketches)), model);
});
