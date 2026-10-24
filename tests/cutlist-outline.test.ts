import test from 'node:test';
import assert from 'node:assert/strict';
import { partCutlistOutline, type CutlistOutline } from '../src/cutlist-outline';
import { exportModelCutlist } from '../src/cutlist-export';
import { cylinderSize, type BoxSpec } from '../src/model';
import { createBlankDocument, restoreWorkspace, serializeWorkspace } from '../src/documents';
import { applyCutlistLayout, createOptimizedCutlistDocument, cutlistLayoutShapes } from '../src/optimized-cutlist-document';
import { optimizeCutlist, optimizedCutlistFromSource, optimizedCutlistSource, restoreOptimizedCutlist, validateCutlistRows } from '../src/optimized-cutlist';

const solid = (id: string, size: BoxSpec['size'], position: BoxSpec['position'] = [0, 0, 0]): BoxSpec => ({ id, name: id, size, position, color: '#ffffff', groupId: 'p' });
const perimeter = (outline: CutlistOutline) => outline.reduce((sum, [a, b]) => sum + Math.hypot(b[0] - a[0], b[1] - a[1]), 0);
const measure = (text: string, height: number): [number, number] => [text.length * height * 0.8, height];
function notch() {
  return exportModelCutlist({ boxes: [solid('base', [10, 4, 0.75]), solid('top', [4, 4, 0.75], [0, 4, 0])], variables: [], groups: [{ id: 'p', name: 'Notched panel', kind: 'part', position: [20, -30, 40] }] });
}

test('snapshots the normalized notched silhouette without additive seams or model mutation', () => {
  const cutlist = notch(), row = cutlist.rows[0];
  assert.deepEqual([row.length, row.width, row.thickness], [10, 8, 0.75]);
  assert.equal(perimeter(row.outline!), 36);
  assert.ok(row.outline!.some(([a, b]) => a[0] === 4 && b[0] === 4 && Math.min(a[1], b[1]) === 4 && Math.max(a[1], b[1]) === 8));
  assert.ok(!row.outline!.some(([a, b]) => a[1] === 4 && b[1] === 4 && Math.max(a[0], b[0]) <= 4), 'shared seam is absent');
  assert.match(cutlist.csv, /1,Notched panel,1,10,8,0.75/);
});

test('projection maps length and width consistently for every thickness axis', () => {
  for (const depth of [0, 1, 2]) {
    const [u, v] = [0, 1, 2].filter((axis) => axis !== depth);
    const size: BoxSpec['size'] = [0.75, 0.75, 0.75]; size[u] = 10; size[v] = 8;
    const min: BoxSpec['position'] = [-10, 20, -30];
    const outline = partCutlistOutline([solid('a', size, min)], min, size);
    assert.equal(perimeter(outline), 36);
    assert.equal(Math.max(...outline.flat().map((p) => p[0])), 10);
    assert.equal(Math.max(...outline.flat().map((p) => p[1])), 8);
  }
});

test('union removes overlaps, contained shapes and duplicate edges while retaining hole boundaries', () => {
  const a = solid('a', [6, 4, 0.75]), b = solid('b', [6, 4, 0.75], [4, 0, 0]);
  for (const solids of [[a, b], [b, a], [a, b, { ...a, id: 'copy' }], [a, b, solid('inside', [2, 2, 0.75], [1, 1, 0])]]) {
    assert.equal(perimeter(partCutlistOutline(solids, [0, 0, 0], [10, 4, 0.75])), 28);
  }
  const frame = [solid('bottom', [10, 2, 0.75]), solid('top', [10, 2, 0.75], [0, 8, 0]), solid('left', [2, 6, 0.75], [0, 2, 0]), solid('right', [2, 6, 0.75], [8, 2, 0])];
  assert.equal(perimeter(partCutlistOutline(frame, [0, 0, 0], [10, 10, 0.75])), 64);
});

test('cylinder end profiles approximate a circle and side profiles remain rectangular on every axis', () => {
  for (const axis of ['x', 'y', 'z'] as const) {
    const cylinder: BoxSpec = { ...solid('round', cylinderSize(4, 0.75, axis)), kind: 'cylinder', axis };
    const outline = partCutlistOutline([cylinder], [0, 0, 0], cylinder.size);
    assert.ok(Math.abs(perimeter(outline) - 8 * Math.PI) < 0.1);
    assert.ok(outline.length > 20);
    assert.deepEqual(validateCutlistRows([{ id: 'p', name: 'p', length: 8, width: 8, thickness: 0.75, outline }])[0].outline, outline);
    const long: BoxSpec = { ...cylinder, size: cylinderSize(0.375, 10, axis) };
    assert.equal(perimeter(partCutlistOutline([long], [0, 0, 0], long.size)), 21.5);
  }
  const tiny: BoxSpec = { ...solid('tiny', [1 / 64, 1 / 64, 1 / 64]), kind: 'cylinder', axis: 'x' };
  assert.ok(partCutlistOutline([tiny], [0, 0, 0], tiny.size).length >= 4);
});

test('curved unions clip covered arcs and box edges at their intersections', () => {
  const round: BoxSpec = { ...solid('round', [8, 8, 0.75]), kind: 'cylinder' };
  const half = partCutlistOutline([solid('half', [4, 8, 0.75]), round], [0, 0, 0], [8, 8, 0.75]);
  assert.ok(Math.abs(perimeter(half) - (16 + 4 * Math.PI)) < 0.1);
  const pair = partCutlistOutline([round, { ...round, id: 'other', position: [4, 0, 0] }], [0, 0, 0], [12, 8, 0.75]);
  assert.ok(Math.abs(perimeter(pair) - 32 * Math.PI / 3) < 0.1);
});

test('outline placement follows both unrotated and rotated packing and stays native through undo and persistence', () => {
  const cutlist = notch();
  for (const panel of [{ width: 10, height: 8 }, { width: 8, height: 10 }]) {
    const layout = optimizeCutlist(cutlist.rows, [panel]), part = layout.panels[0].placements[0];
    const shapes = cutlistLayoutShapes(layout, cutlist.rows, measure), stock = shapes.find((s) => s.id === 'stock-0')!;
    const lines = shapes.filter((s) => s.id.startsWith('cut-outline-'));
    assert.equal(lines.length, cutlist.rows[0].outline!.length);
    cutlist.rows[0].outline!.forEach(([a, b], index) => {
      const placed = ([u, v]: [number, number]) => [stock.position[0] + part.x + (part.rotated ? 8 - v : u), stock.position[1] + part.y + (part.rotated ? u : v)];
      assert.deepEqual(lines[index].position, placed(a));
      const end = placed(b);
      assert.deepEqual(lines[index].size, end.map((n, axis) => n - lines[index].position[axis]));
    });
    const source = createBlankDocument([]), doc = createOptimizedCutlistDocument([source], source, cutlist, 3);
    applyCutlistLayout(doc, layout, measure);
    assert.match(doc.source, /line\(.*outline/);
    assert.deepEqual(doc.history[doc.historyAt].rectangles, doc.rectangles);
    const restored = restoreWorkspace(serializeWorkspace([doc], doc.id)).documents[0];
    assert.deepEqual(restored.rectangles, doc.rectangles);
    assert.deepEqual(restored.optimizedCutlist, doc.optimizedCutlist);
    assert.deepEqual(optimizedCutlistFromSource(optimizedCutlistSource(doc.source, doc.optimizedCutlist!)), doc.optimizedCutlist);
    cutlist.rows[0].outline![0][0][0] = 1;
    assert.notDeepEqual(doc.optimizedCutlist!.rows, cutlist.rows, 'outline snapshot is independent');
    cutlist.rows[0].outline![0][0][0] = 0;
  }
});

test('legacy dimension-only snapshots still render and malformed outlines fail validation', () => {
  const legacy = { id: 'p', name: 'p', length: 10, width: 8, thickness: 0.75 };
  assert.deepEqual(validateCutlistRows([legacy]), [legacy]);
  assert.equal(cutlistLayoutShapes(optimizeCutlist([legacy], [{ width: 10, height: 8 }]), [legacy], measure).length, 4);
  for (const outline of [null, [], Array(1), [null], [[[0, 0], [0, 0]]], [[[0, 0], [11, 1]]], [[[0, 0], [NaN, 1]]], [[[0, 0], [1, 0.001]]], [[[0, 0], [-1, 1]]]]) {
    assert.throws(() => validateCutlistRows([{ ...legacy, outline }]), /cutlist outline/);
    const source = createBlankDocument([]), doc = createOptimizedCutlistDocument([source], source, notch(), 3);
    assert.throws(() => restoreOptimizedCutlist({ ...doc.optimizedCutlist, rows: [{ ...legacy, outline }] }), /cutlist outline/);
  }
});
