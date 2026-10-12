import test from 'node:test';
import assert from 'node:assert/strict';
import { exportModelCutlist } from '../src/cutlist-export';
import { resolveModel, type BoxSpec } from '../src/model';
import { planTreeMove } from '../src/component-tree';

const box = (id: string, size: BoxSpec['size'], overrides: Partial<BoxSpec> = {}): BoxSpec => ({
  id, name: id, size, position: [0, 0, 0], color: '#ffffff', ...overrides,
});

test('cutlist sorts dimensions independently of axes and includes the exact default threshold', () => {
  const model = resolveModel([
    box('x-thin', [3, 24, 12]), box('y-thin', [24, 3, 12]), box('z-thin', [12, 24, 3]),
    box('thick', [24, 12, 3 + 1 / 64]),
  ]);
  const before = structuredClone(model);
  const result = exportModelCutlist(model, { name: 'Cabinet.js' });
  assert.equal(result.filename, 'Cabinet-cutlist.csv');
  assert.equal(result.rows.length, 3);
  for (const row of result.rows) assert.deepEqual([row.length, row.width, row.thickness], [24, 12, 3]);
  assert.deepEqual(result.ignored.map((item) => item.id), ['thick']);
  assert.match(result.ignored[0].reason, /3 1\/64 in exceeds 3 in/);
  assert.equal(result.csv, 'Item No.,Component,Quantity,Length (in),Width (in),Thickness (in)\r\n1,x-thin,1,24,12,3\r\n2,y-thin,1,24,12,3\r\n3,z-thin,1,24,12,3\r\n');
  assert.deepEqual(model, before);
});

test('nested group paths and CSV quoting preserve component names in exported and ignored rows', () => {
  const model = resolveModel([
    box('panel', [12, 6, 0.75], { name: 'Panel, "A"\nShelf', groupId: 'child' }),
    box('block', [4, 5, 6], { groupId: 'child' }),
  ], [], [
    { id: 'child', name: 'Inner', position: [0, 0, 0], parentId: 'root' },
    { id: 'root', name: 'Cabinet', position: [100, 200, 300] },
  ]);
  const result = exportModelCutlist(model);
  assert.equal(result.rows[0].name, 'Cabinet > Inner > Panel, "A"\nShelf');
  assert.ok(result.csv.includes('"Cabinet > Inner > Panel, ""A""\nShelf",1,12,6,0.75'));
  assert.equal(result.ignored[0].name, 'Cabinet > Inner > block');
});

test('fractions update the cutoff using resolved variable dimensions and report unsupported shapes', () => {
  const model = resolveModel([
    box('shelf', [8, 16, 1], { expressions: { 'size.2': 'var(stock)' } }),
    box('block', [4, 4, 3.5]),
    box('pin', [1, 1, 8], { kind: 'cylinder', groupId: 'frame' }),
  ], [{ name: 'stock', value: 0.75 }], [{ id: 'frame', name: 'Frame', position: [0, 0, 0] }], [
    { id: 'sketch', name: 'Plan', axis: 'z', position: [0, 0, 0], size: [12, 6], color: '#ffffff', groupId: 'frame', shapes: [] },
  ]);
  const result = exportModelCutlist(model, { maxThickness: '3 1/2"' });
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].thickness, 0.75);
  assert.deepEqual(result.ignored.map((item) => item.name), ['Frame > pin', 'Frame > Plan']);
  assert.match(result.ignored[0].reason, /Cylinder/);
  assert.match(result.ignored[1].reason, /Sketch/);
  assert.equal(exportModelCutlist(model, { maxThickness: '1/2' }).rows.length, 0);
});

test('invalid limits fail before producing a CSV and empty previews remain available', () => {
  const model = resolveModel([box('part', [12, 6, 3])]);
  for (const maxThickness of ['', 'bad', 0, -1, NaN, Infinity]) {
    assert.throws(() => exportModelCutlist(model, { maxThickness }));
  }
  assert.throws(() => exportModelCutlist(model, { name: '../bad' }), /without folders/);
  const result = exportModelCutlist({ boxes: [], variables: [] });
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.ignored, []);
  assert.equal(result.csv.split('\r\n').length, 2);
});

test('cutlist follows nested component tree order despite interleaved box storage, filtering, and tree moves', () => {
  const model = resolveModel([
    box('middle-a', [12, 6, 0.75], { groupId: 'middle' }),
    box('side', [12, 6, 0.75], { groupId: 'side-group' }),
    box('middle-b', [12, 6, 0.75], { groupId: 'middle' }),
    box('outside', [12, 6, 0.75]),
    box('nested-panel', [12, 6, 0.75], { groupId: 'nested' }),
    box('thick', [12, 6, 4], { groupId: 'middle' }),
    box('pin', [1, 1, 8], { kind: 'cylinder', groupId: 'middle' }),
  ], [], [
    { id: 'side-group', name: 'SideCabinet', position: [0, 0, 0] },
    { id: 'nested', name: 'Nested', position: [0, 0, 0], parentId: 'middle' },
    { id: 'middle', name: 'MiddleCabinet', position: [0, 0, 0] },
  ], [{ id: 'sketch', name: 'Plan', axis: 'z', position: [0, 0, 0], size: [12, 6], color: '#ffffff', shapes: [], groupId: 'middle' }]);
  const treeOrder = ['outside', 'middle', 'middle-b', 'sketch', 'thick', 'nested', 'pin', 'middle-a', 'side-group', 'side', 'nested-panel'];
  const before = structuredClone({ model, treeOrder });
  const result = exportModelCutlist(model, { treeOrder });
  assert.deepEqual(result.rows.map((row) => row.id), ['outside', 'middle-b', 'nested-panel', 'middle-a', 'side']);
  assert.deepEqual(result.ignored.map((row) => row.id), ['sketch', 'thick', 'pin']);
  assert.deepEqual(result.csv.trim().split('\r\n').slice(1).map((line) => line.split(',')[0]), ['1', '2', '3', '4', '5']);
  const move = planTreeMove(model.groups!, model.boxes, treeOrder, 'middle-a', { targetId: 'middle-b', placement: 'before' });
  assert.deepEqual(exportModelCutlist(model, { treeOrder: move.order }).rows.map((row) => row.id), ['outside', 'middle-a', 'middle-b', 'nested-panel', 'side']);
  assert.deepEqual({ model, treeOrder }, before);
});

test('missing or stale tree order falls back to complete grouped tree order', () => {
  const model = resolveModel([
    box('a1', [12, 6, 0.75], { groupId: 'a' }),
    box('b1', [12, 6, 0.75], { groupId: 'b' }),
    box('a2', [12, 6, 0.75], { groupId: 'a' }),
    box('root', [12, 6, 0.75]),
  ], [], [
    { id: 'a', name: 'A', position: [0, 0, 0] },
    { id: 'b', name: 'B', position: [0, 0, 0] },
  ]);
  assert.deepEqual(exportModelCutlist(model).rows.map((row) => row.id), ['a1', 'a2', 'b1', 'root']);
  assert.deepEqual(exportModelCutlist(model, { treeOrder: ['deleted', 'b', 'b', 'a2'] }).rows.map((row) => row.id), ['b1', 'a2', 'a1', 'root']);
});
