import test from 'node:test';
import assert from 'node:assert/strict';
import { boxFacePlane, groupDescendants, groupOffset, pointOnPlane, reparentPosition, validateGroups, worldPosition, type GroupSpec } from '../src/groups';
import { createBlankDocument, restoreWorkspace, serializeWorkspace } from '../src/documents';
import { createBoxFromFace, generateSource, parseInches, resolveModel, type BoxSpec } from '../src/model';
import { generateSketchSource, validateSketchShapes, type SketchShape } from '../src/sketch';

const groups: GroupSpec[] = [
  { id: 'assembly', name: 'Assembly', position: [10, 20, 30] },
  { id: 'nested', name: 'Nested', parentId: 'assembly', position: [2, 3, 4] },
];
const box: BoxSpec = { id: 'b', name: 'Box', size: [4, 5, 6], position: [1, 2, 3], color: '#fff', groupId: 'nested' };
const planar = groups.map((g) => ({ ...g, position: [g.position[0], g.position[1], 0] as [number, number, number] }));
const shapes: SketchShape[] = [
  { id: 'rectangle', name: 'Rectangle', size: [4, 5], position: [1, 2], color: '#fff', groupId: 'nested' },
  { id: 'line', name: 'Line', kind: 'line', size: [-4, 5], position: [7, 8], color: '#fff', groupId: 'assembly' },
];

test('moving a parent translates all nested boxes and sketch shapes without changing local geometry', () => {
  const moved = groups.map((g) => g.id === 'assembly' ? { ...g, position: [15, 10, 32] as [number, number, number] } : g);
  const original = worldPosition(box.position, groups, box.groupId);
  assert.deepEqual(original, [13, 25, 37]);
  assert.deepEqual(worldPosition(box.position, moved, box.groupId), [18, 15, 39]);
  assert.deepEqual(groupDescendants(groups, 'assembly'), new Set(['assembly', 'nested']));
  const flatMoved = planar.map((g) => g.id === 'assembly' ? { ...g, position: [15, 10, 0] as [number, number, number] } : g);
  for (const shape of validateSketchShapes(shapes, planar)) {
    const before = worldPosition(shape.position, planar, shape.groupId);
    const after = worldPosition(shape.position, flatMoved, shape.groupId);
    assert.deepEqual(after, [before[0] + 5, before[1] - 10, 0]);
  }
  assert.deepEqual(box.position, [1, 2, 3]);
});

test('membership and parent changes preserve world position, including ungrouping', () => {
  const position = reparentPosition(box.position, groups, 'nested', 'assembly');
  assert.deepEqual(position, [3, 5, 7]);
  assert.deepEqual(worldPosition(position, groups, 'assembly'), worldPosition(box.position, groups, 'nested'));
  assert.deepEqual(reparentPosition(position, groups, 'assembly', undefined), [13, 25, 37]);
  const nested = groups[1];
  const detached = { ...nested, parentId: undefined, position: reparentPosition(nested.position, groups, nested.parentId) };
  assert.deepEqual(groupOffset([groups[0], detached], 'nested'), groupOffset(groups, 'nested'));
});

test('groups reject cycles, unknown parents, colliding IDs, invalid origins, and off-plane sketch origins', () => {
  assert.throws(() => validateGroups([{ ...groups[0], parentId: 'nested' }, groups[1]]), /cycle/);
  assert.throws(() => validateGroups([{ ...groups[0], parentId: 'missing' }]), /Unknown/);
  assert.throws(() => validateGroups([groups[0], groups[0]]), /unique/);
  assert.throws(() => validateGroups([{ ...groups[0], position: [0, 0, Infinity] }]), /finite/);
  assert.throws(() => validateSketchShapes(shapes, groups), /plane/);
  assert.throws(() => resolveModel([{ ...box, groupId: 'missing' }], [], groups), /Unknown group/);
  assert.throws(() => resolveModel([{ ...box, id: 'nested' }], [], groups), /distinct/);
  assert.throws(() => validateSketchShapes([{ ...shapes[0], groupId: 'missing' }], planar), /Unknown group/);
  assert.deepEqual(validateGroups([{ id: 'g', name: 'Group', position: ['1/3', '-1 1/2', 0] }])[0].position, [21 / 64, -1.5, 0]);
});

test('face-linked boxes move with their group, and cross-group links require detachment', () => {
  const child = createBoxFromFace(box, 'top', 'child', groups);
  assert.equal(child.groupId, 'nested');
  const model = resolveModel([box, child], [], groups);
  assert.deepEqual(worldPosition(model.boxes[1].position, groups, 'nested'), [13, 25, 43]);
  const moved = groups.map((g) => g.id === 'assembly' ? { ...g, position: [20, 20, 30] as [number, number, number] } : g);
  assert.deepEqual(worldPosition(resolveModel(model.boxes, [], moved).boxes[1].position, moved, 'nested'), [23, 25, 43]);
  assert.throws(() => resolveModel([box, { ...child, groupId: 'assembly' }], [], groups), /same group/);
});

test('model and sketch source round-trip group definitions and local membership', () => {
  const rawBoxes: unknown[] = [], rawGroups: unknown[] = [];
  const source = generateSource([box], [], groups);
  new Function('group', 'box', 'inch', source)((g: unknown) => rawGroups.push(g), (b: unknown) => rawBoxes.push(b), parseInches);
  assert.deepEqual(resolveModel(rawBoxes, [], rawGroups), resolveModel([box], [], groups));
  const rawShapes: unknown[] = [], sketchGroups: unknown[] = [];
  new Function('group', 'rectangle', 'line', 'inch', generateSketchSource(shapes, planar))(
    (g: unknown) => sketchGroups.push(g),
    (r: SketchShape) => rawShapes.push(r),
    (l: { id: string; name: string; start: string[]; end: string[]; color: string; groupId: string }) => {
      // Worker tests below exercise the actual endpoint parsing.
      assert.equal(l.groupId, 'assembly'); assert.equal(l.start.length, 2);
    },
    (n: string) => n,
  );
  assert.deepEqual(validateSketchShapes(rawShapes, sketchGroups), [shapes[0]]);
});

test('workspace recovery preserves group transforms, collapsed entries and undo snapshots', () => {
  for (const kind of ['model', 'sketch'] as const) {
    const document = createBlankDocument([], kind);
    document.groups = structuredClone(kind === 'model' ? groups : planar);
    document.collapsedGroupIds = ['assembly'];
    if (kind === 'model') document.boxes = [structuredClone(box)]; else document.rectangles = structuredClone(shapes);
    document.appliedSource = kind === 'model' ? generateSource(document.boxes, [], document.groups) : generateSketchSource(document.rectangles, document.groups);
    document.source = document.appliedSource;
    const restored = restoreWorkspace(serializeWorkspace([document], document.id)).documents[0];
    assert.deepEqual(restored.groups, document.groups);
    assert.deepEqual(restored.collapsedGroupIds, ['assembly']);
    assert.deepEqual(restored.history[0].groups, document.groups);
    restored.history[0].groups![0].position[0] = 99;
    assert.equal(restored.groups[0].position[0], 10);
  }
});

test('the shared plane frame maps sketch points onto all six box faces', () => {
  const expected = { front: [13, 25, 37], back: [17, 30, 37], left: [13, 30, 37], right: [17, 25, 37], top: [13, 25, 43], bottom: [13, 30, 37] };
  for (const face of Object.keys(expected) as (keyof typeof expected)[]) {
    const frame = boxFacePlane(box, face, groups);
    assert.deepEqual(pointOnPlane(frame, [0, 0]), expected[face]);
    const point = pointOnPlane(frame, [2, 3, 1]);
    assert.deepEqual(point, frame.origin.map((n, i) => n + 2 * frame.u[i] + 3 * frame.v[i] + frame.normal[i]));
  }
});

test('compiler worker accepts grouped boxes and mixed sketch shapes and rejects dangling membership', async () => {
  let listener: (event: { data: { source: string; kind: string } }) => void;
  let result: any;
  (globalThis as any).self = { addEventListener: (_: string, fn: typeof listener) => { listener = fn; }, postMessage: (value: unknown) => { result = value; } };
  await import('../src/compiler.worker');
  listener!({ data: { source: generateSource([box], [], groups), kind: 'model' } });
  assert.deepEqual(result, resolveModel([box], [], groups));
  listener!({ data: { source: generateSketchSource(shapes, planar), kind: 'sketch' } });
  assert.deepEqual(result, { rectangles: shapes, groups: planar });
  listener!({ data: { source: "rectangle({size:[1,2], groupId:'missing'});", kind: 'sketch' } });
  assert.match(result.error, /Unknown group/);
});

test('undo snapshots keep 3D group Z translations separate from sketch plane validation', async () => {
  const { resolveSnapshot } = await import('../src/documents');
  const snapshot = { groups, boxes: [box], variables: [], source: '', hiddenIds: [] };
  const geometry = resolveSnapshot(snapshot, 'model');
  assert.deepEqual(worldPosition(geometry.boxes[0].position, geometry.groups, box.groupId), [13, 25, 37]);
  assert.deepEqual(geometry.rectangles, []);
  assert.throws(() => resolveSnapshot(snapshot, 'sketch'), /plane/);
});
