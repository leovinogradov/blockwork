import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePart, componentDisplayName, solidsConnect } from '../src/parts';
import { validateGroups, worldPosition, type GroupSpec } from '../src/groups';
import { cylinderSize, generateSource, reparentBox, resolveModel, type BoxSpec } from '../src/model';
import { exportModelCutlist } from '../src/cutlist-export';
import { planTreeMove } from '../src/component-tree';
import { duplicateGroupBranch, effectiveHiddenIds } from '../src/group-actions';
import { createBlankDocument, restoreWorkspace, serializeWorkspace, resolveSnapshot } from '../src/documents';

const assembly: GroupSpec = { id: 'g', name: 'Cabinet', position: [10, 20, 30] };
const part: GroupSpec = { id: 'p', name: 'MC1', kind: 'part', color: '#d9a76e', position: [2, 3, 4], parentId: 'g' };
const groups = [assembly, part];
const box = (id: string, size: BoxSpec['size'] = [0.75, 20, 83.25], position: BoxSpec['position'] = [0, 0, 0]): BoxSpec => ({ id, name: id, size, position, color: '#d9a76e', groupId: 'p' });
const panel = box('Panel');
const top = { ...box('Top', [0.75, 8, 11.5]), relative: { boxId: 'Panel', face: 'top' as const, offset: 0 } };

test('a notched Part uses resolved geometry, a single cutlist row, and full group path in tree order', () => {
  const loose = { ...box('Loose', [1, 2, 3]), groupId: 'g' };
  const model = resolveModel([top, loose, panel], [], groups);
  const before = structuredClone(model);
  const body = analyzePart(part, model.boxes, groups);
  assert.equal(body.bodyCount, 1);
  assert.deepEqual(body.size, [0.75, 20, 94.75]);
  assert.deepEqual(body.min, [12, 23, 34]);
  assert.deepEqual(exportModelCutlist(model, { treeOrder: ['g', 'Loose', 'p', 'Top', 'Panel'] }).rows, [
    { id: 'Loose', name: 'Cabinet > Loose', length: 3, width: 2, thickness: 1 },
    { id: 'p', name: 'Cabinet > MC1', length: 94.75, width: 20, thickness: 0.75 },
  ]);
  assert.deepEqual(model, before);
});

test('disconnected and empty Parts stay editable but are ignored as a whole, without leaking child rows', () => {
  const disconnected = resolveModel([panel, box('Detached', [0.75, 8, 10], [0, 0, 100])], [], groups);
  const result = exportModelCutlist(disconnected);
  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.ignored, [{ id: 'p', name: 'Cabinet > MC1', reason: 'Disconnected Part · 2 bodies; connect its subcomponents' }]);
  assert.match(exportModelCutlist(resolveModel([], [], groups)).ignored[0].reason, /Empty Part/);
  const connected = resolveModel([panel, box('Detached', [0.75, 8, 10], [0, 0, 83.25])], [], groups);
  assert.equal(exportModelCutlist(connected).rows.length, 1);
});

test('Part thickness filtering uses the overall stock bounds instead of each subcomponent', () => {
  const model = resolveModel([box('A', [2, 8, 10]), box('B', [2, 8, 10], [2, 0, 0])], [], groups);
  assert.equal(exportModelCutlist(model).rows.length, 0);
  assert.match(exportModelCutlist(model).ignored[0].reason, /Thickness 4 in exceeds 3 in/);
  assert.equal(exportModelCutlist(model, { maxThickness: 4 }).rows.length, 1);
});

test('Part owns color: every solid inherits it, source stores it only on the Part, and detaching keeps the applied color', () => {
  const coloredGroups = [assembly, { ...part, color: '#86a9a380' }];
  const model = resolveModel([{ ...panel, color: '#ff0000' }, { ...top, color: '#0000ff' }], [], coloredGroups);
  assert.ok(model.boxes.every((solid) => solid.color === '#86a9a380'));
  const source = generateSource(model.boxes, [], model.groups);
  assert.equal((source.match(/color:/g) ?? []).length, 0, 'subcomponents have no authored color');
  assert.match(source, /"color":"#86a9a380"/);
  const detached = reparentBox(model.boxes[0], coloredGroups, 'g');
  assert.equal(resolveModel([detached], [], coloredGroups).boxes[0].color, '#86a9a380');
  const copy = duplicateGroupBranch({ groups: coloredGroups, boxes: model.boxes, sketches: [], rectangles: [], measurements: [] }, 'p', []);
  assert.equal(copy.groups[0].color, '#86a9a380');
  assert.equal(validateGroups([{ ...part, color: undefined }, assembly])[0].color, '#d9a76e');
  assert.throws(() => validateGroups([{ ...part, color: '' }, assembly]), /needs a color/);
});

test('positive face area and overlap connect boxes, while edges, points and gaps do not', () => {
  const base = box('a', [2, 2, 2]);
  for (const position of [[2, 0, 0], [0, 2, 0], [0, 0, 2], [1, 1, 1], [2, 1.5, 1.5]] as BoxSpec['position'][]) assert.equal(solidsConnect(base, box('b', [2, 2, 2], position)), true);
  for (const position of [[2, 2, 0], [2, 2, 2], [2.015625, 0, 0]] as BoxSpec['position'][]) assert.equal(solidsConnect(base, box('b', [2, 2, 2], position)), false);
  assert.equal(analyzePart(part, [base, box('c', [2, 2, 2], [4, 0, 0]), box('bridge', [2, 2, 2], [2, 0, 0])], groups).bodyCount, 1);
});

test('cylinder contact uses circular geometry on every axis, including cap joints and side tangency', () => {
  for (const axis of ['x', 'y', 'z'] as const) {
    const a: BoxSpec = { ...box('a', cylinderSize(1, 4, axis)), kind: 'cylinder', axis };
    const i = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const radial = [0, 1, 2].filter((n) => n !== i);
    const cap: BoxSpec['position'] = [0, 0, 0]; cap[i] = 4;
    assert.equal(solidsConnect(a, { ...a, id: 'b', position: cap }), true);
    assert.equal(solidsConnect(a, box('cap', [2, 2, 2], cap)), true);
    const tangent: BoxSpec['position'] = [0, 0, 0]; tangent[radial[0]] = 2;
    assert.equal(solidsConnect(a, { ...a, id: 'b', position: tangent }), false);
    const corner: BoxSpec['position'] = [0, 0, 0]; radial.forEach((n) => { corner[n] = 1.875; });
    assert.equal(solidsConnect(a, box('corner', [0.125, 0.125, 0.125], corner)), false);
    const inside: BoxSpec['position'] = [0, 0, 0]; radial.forEach((n) => { inside[n] = 0.875; });
    assert.equal(solidsConnect(a, box('inside', [0.125, 0.125, 0.125], inside)), true);
  }
  const x: BoxSpec = { ...box('x', cylinderSize(1, 4, 'x')), kind: 'cylinder', axis: 'x' };
  const y: BoxSpec = { ...box('y', cylinderSize(1, 4, 'y')), kind: 'cylinder', axis: 'y' };
  assert.equal(solidsConnect(x, y), true);
  assert.equal(solidsConnect(x, { ...y, position: [0, 0, 2] }), false);
  assert.equal(exportModelCutlist(resolveModel([x, y], [], groups), { maxThickness: 4 }).rows.length, 1);
});

test('Part names are derived without changing local subcomponent names', () => {
  assert.equal(componentDisplayName(panel, groups), 'MC1 > Panel');
  assert.equal(componentDisplayName({ ...panel, name: '' }, groups), 'MC1');
  assert.equal(componentDisplayName({ ...panel, groupId: 'g' }, groups), 'Panel');
  assert.equal(componentDisplayName(panel, groups.map((g) => g.id === 'p' ? { ...g, name: 'Renamed' } : g)), 'Renamed > Panel');
  assert.equal(panel.name, 'Panel');
  const unnamed = resolveModel([{ ...panel, name: '' }], [], groups).boxes[0];
  assert.equal(componentDisplayName(unnamed, groups), 'MC1');
  assert.equal(reparentBox(unnamed, groups, 'g').name, 'MC1');
  assert.throws(() => resolveModel([{ ...panel, name: '', groupId: 'g' }], [], groups), /needs a name/);
});

test('Parts can live in groups but cannot contain groups or Parts, including drag insertion beside a subcomponent', () => {
  assert.deepEqual(validateGroups(groups), groups);
  assert.throws(() => validateGroups(groups.map((g) => ({ ...g, position: [0, 0, 0] })), true), /Parts belong in 3D/);
  assert.throws(() => validateGroups([...groups, { ...assembly, id: 'nested', parentId: 'p' }]), /not groups or other Parts/);
  assert.throws(() => planTreeMove(groups, [panel], [], 'g', { targetId: 'p', placement: 'inside' }), /not groups or other Parts/);
  assert.throws(() => planTreeMove(groups, [panel], [], 'g', { targetId: 'Panel', placement: 'before' }), /not groups or other Parts/);
  assert.equal(planTreeMove(groups, [panel], [], 'Panel', { targetId: 'p', placement: 'inside' }).parentId, 'p');
});

test('Part transforms, duplication, hiding, save recovery, and undo snapshots preserve body semantics', () => {
  const model = resolveModel([panel, top], [], groups);
  const reparented = reparentBox(model.boxes[0], groups, 'g');
  assert.deepEqual(worldPosition(reparented.position, groups, 'g'), worldPosition(panel.position, groups, 'p'));
  const copy = duplicateGroupBranch({ groups, boxes: model.boxes, sketches: [], rectangles: [], measurements: [] }, 'p', ['g', 'p', 'Top', 'Panel'], (() => { let n = 0; return () => `copy-${++n}`; })());
  assert.equal(copy.groups[0].kind, 'part');
  assert.equal(analyzePart(copy.groups[0], copy.boxes, [...groups, ...copy.groups]).bodyCount, 1);
  assert.deepEqual(effectiveHiddenIds(groups, model.boxes, new Set(['p'])), new Set(['p', 'Top', 'Panel']));
  assert.deepEqual(effectiveHiddenIds(groups, model.boxes, new Set(['Panel'])), new Set(), 'visibility belongs to the Part, not its subcomponents');
  const document = createBlankDocument([], 'model');
  Object.assign(document, model, { source: generateSource(model.boxes, [], groups), appliedSource: generateSource(model.boxes, [], groups) });
  const restored = restoreWorkspace(serializeWorkspace([document], document.id)).documents[0];
  assert.deepEqual(restored.groups, groups);
  assert.deepEqual(resolveSnapshot(restored.history[0], 'model').groups, groups);
});

test('part() source compiles and round-trips with relative subcomponents and nested ordinary groups', async () => {
  let listener: (event: { data: { source: string; kind: string } }) => void;
  let result: any;
  (globalThis as any).self = { addEventListener: (_: string, fn: typeof listener) => { listener = fn; }, postMessage: (value: unknown) => { result = value; } };
  await import('../src/compiler.worker');
  const model = resolveModel([panel, top], [], groups);
  const source = generateSource(model.boxes, [], groups, ['g', 'p', 'Panel', 'Top']);
  assert.match(source, /part\(/);
  listener!({ data: { source, kind: 'model' } });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.boxes, model.boxes);
  assert.deepEqual(result.groups.slice().reverse(), groups);
  listener!({ data: { source: 'part({name:"Invalid"}, [group({name:"Nested"}, [])]);', kind: 'model' } });
  assert.match(result.error, /not groups or other Parts/);
});
