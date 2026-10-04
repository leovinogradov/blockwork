import test from 'node:test';
import assert from 'node:assert/strict';
import { boxFacePlane, groupDescendants, groupOffset, pointOnPlane, reparentPosition, validateGroups, worldPosition, type GroupSpec } from '../src/groups';
import { createBlankDocument, restoreWorkspace, serializeWorkspace } from '../src/documents';
import { createBoxFromFace, generateSource, reparentBox, resolveModel, type BoxSpec, type FaceName } from '../src/model';
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

test('face-linked boxes move with their group and remain linked across group boundaries', () => {
  const child = createBoxFromFace(box, 'top', 'child', groups);
  assert.equal(child.groupId, 'nested');
  const model = resolveModel([box, child], [], groups);
  assert.deepEqual(worldPosition(model.boxes[1].position, groups, 'nested'), [13, 25, 43]);
  const moved = groups.map((g) => g.id === 'assembly' ? { ...g, position: [20, 20, 30] as [number, number, number] } : g);
  assert.deepEqual(worldPosition(resolveModel(model.boxes, [], moved).boxes[1].position, moved, 'nested'), [23, 25, 43]);
  const reparented = reparentBox(child, groups, 'assembly');
  const regrouped = resolveModel([box, reparented], [], groups);
  assert.deepEqual(regrouped.boxes[1].relative, child.relative);
  assert.deepEqual(worldPosition(regrouped.boxes[1].position, groups, 'assembly'), [13, 25, 43]);
  assert.deepEqual(worldPosition(resolveModel(regrouped.boxes, [], moved).boxes[1].position, moved, 'assembly'), [23, 25, 43]);
});

test('moving either end of a face relation between groups or to top level preserves all six face placements', () => {
  for (const face of ['front', 'back', 'left', 'right', 'top', 'bottom'] as FaceName[]) {
    const child = createBoxFromFace(box, face, 'child', groups);
    const original = resolveModel([box, child], [], groups);
    const before = original.boxes.map((b) => worldPosition(b.position, groups, b.groupId));
    for (const id of ['b', 'child']) {
      for (const destination of ['assembly', undefined]) {
        const moved = resolveModel(original.boxes.map((b) => b.id === id ? reparentBox(b, groups, destination) : b), [], groups);
        assert.deepEqual(moved.boxes[1].relative, child.relative, `${face}: ${id} relation retained`);
        assert.deepEqual(moved.boxes.map((b) => worldPosition(b.position, groups, b.groupId)), before, `${face}: ${id} world positions retained`);
      }
    }
  }
});

test('cross-group relation chains retain offset expressions and follow reference edits', () => {
  const variables = [{ name: 'gap', value: 0.5 }];
  const input = resolveModel([
    box,
    { id: 'child', name: 'Child', size: [2, 2, 1], position: [0, 0, 0], color: '#fff', groupId: 'nested', relative: { boxId: 'b', face: 'top', offset: 'var(gap)', u: { side: 'right', offset: 'var(gap)' }, v: { side: 'bottom', offset: 'var(gap)' } } },
    { id: 'grandchild', name: 'Grandchild', size: [1, 1, 1], position: [0, 0, 0], color: '#fff', groupId: 'nested', relative: { boxId: 'child', face: 'right', offset: 'var(gap)', u: { side: 'left', offset: 0 }, v: { side: 'bottom', offset: 0 } } },
  ], variables, groups);
  const regrouped = resolveModel(input.boxes.map((b) => b.id === 'child' ? reparentBox(b, groups, 'assembly') : b.id === 'grandchild' ? reparentBox(b, groups) : b), variables, groups);
  const positions = (items: BoxSpec[]) => items.map((b) => worldPosition(b.position, groups, b.groupId));
  assert.deepEqual(positions(regrouped.boxes), positions(input.boxes));
  for (let i = 1; i < 3; i++) {
    assert.deepEqual(regrouped.boxes[i].relative, input.boxes[i].relative);
    assert.deepEqual(regrouped.boxes[i].expressions, input.boxes[i].expressions);
  }
  const moved = resolveModel(regrouped.boxes.map((b) => b.id === 'b' ? { ...b, position: [11, 2, 3] } : b), variables, groups);
  assert.deepEqual(positions(moved.boxes), positions(input.boxes).map(([x, y, z]) => [x + 10, y, z]));
  const resized = resolveModel(regrouped.boxes.map((b) => b.id === 'b' ? { ...b, size: [4, 5, 8] } : b), variables, groups);
  assert.deepEqual(positions(resized.boxes).slice(1), positions(input.boxes).slice(1).map(([x, y, z]) => [x, y, z + 2]));
});

test('cross-group partial anchors preserve free axes when the destination group moves', () => {
  const child: BoxSpec = { id: 'child', name: 'Child', size: [2, 2, 1], position: [4, 5, 6], color: '#fff', groupId: 'assembly', relative: { boxId: 'b', face: 'top', offset: 0 } };
  const before = resolveModel([box, child], [], groups);
  const movedGroups = groups.map((g) => g.id === 'nested' ? { ...g, position: [2, 3, 9] as [number, number, number] } : g);
  const after = resolveModel(before.boxes, [], movedGroups);
  const beforeWorld = worldPosition(before.boxes[1].position, groups, 'assembly');
  const afterWorld = worldPosition(after.boxes[1].position, movedGroups, 'assembly');
  assert.deepEqual(afterWorld, [beforeWorld[0], beforeWorld[1], beforeWorld[2] + 5]);
  assert.deepEqual(after.boxes[1].relative, child.relative);
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

test('compiler worker round-trips grouped boxes and mixed sketch shapes and rejects legacy source membership', async () => {
  let listener: (event: { data: { source: string; kind: string } }) => void;
  let result: any;
  (globalThis as any).self = { addEventListener: (_: string, fn: typeof listener) => { listener = fn; }, postMessage: (value: unknown) => { result = value; } };
  await import('../src/compiler.worker');
  const sorted = (values: { id: string }[]) => values.slice().sort((a, b) => a.id.localeCompare(b.id));
  listener!({ data: { source: generateSource([box], [], groups), kind: 'model' } });
  assert.deepEqual({ ...result, groups: sorted(result.groups) }, resolveModel([box], [], groups));
  listener!({ data: { source: generateSketchSource(shapes, planar), kind: 'sketch' } });
  assert.deepEqual({ rectangles: sorted(result.rectangles), groups: sorted(result.groups) }, { rectangles: sorted(shapes), groups: planar });
  listener!({ data: { source: "rectangle({size:[1,2], groupId:'missing'});", kind: 'sketch' } });
  assert.match(result.error, /groupId is no longer supported/);
});

test('undo snapshots keep 3D group Z translations separate from sketch plane validation', async () => {
  const { resolveSnapshot } = await import('../src/documents');
  const snapshot = { groups, boxes: [box], variables: [], source: '', hiddenIds: [] };
  const geometry = resolveSnapshot(snapshot, 'model');
  assert.deepEqual(worldPosition(geometry.boxes[0].position, geometry.groups, box.groupId), [13, 25, 37]);
  assert.deepEqual(geometry.rectangles, []);
  assert.throws(() => resolveSnapshot(snapshot, 'sketch'), /plane/);
});
