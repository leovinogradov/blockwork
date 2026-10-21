import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankDocument, resolveSnapshot, restoreDocument, restoreWorkspace, serializeDocument, serializeWorkspace } from '../src/documents';
import { exportModelCutlist, type CutlistRow } from '../src/cutlist-export';
import { optimizeCutlist, restoreOptimizedCutlist, validatePanelSizes, validateSawKerf, type CutlistLayout } from '../src/optimized-cutlist';
import { applyCutlistLayout as applyLayout, createOptimizedCutlistDocument, cutlistLayoutShapes as layoutShapes } from '../src/optimized-cutlist-document';
import { saveDocumentFile } from '../src/save-document';
import { openDocumentFile } from '../src/open-document';
import { exportLibrary, restoreLibrary } from '../src/file-library';
import { sketchShapeOrigin } from '../src/sketch';

// Deterministic font metrics for Node; browser checks use actual canvas measurements.
const measureText = (text: string, height: number): [number, number] => [text.length * height * 0.8, height * 1.1];
const applyCutlistLayout = (...args: Parameters<typeof applyLayout>) => applyLayout(args[0], args[1], measureText);
const cutlistLayoutShapes = (...args: Parameters<typeof layoutShapes>) => layoutShapes(args[0], args[1], measureText);

const row = (length: number, width: number, id = 'piece'): CutlistRow => ({ id, name: id, length, width, thickness: 0.75 });
function verify(layout: CutlistLayout, rows: CutlistRow[], kerf = 0) {
  const placed: number[] = [];
  for (const panel of layout.panels) {
    for (const part of panel.placements) {
      placed.push(part.rowIndex);
      const original = rows[part.rowIndex];
      assert.deepEqual([part.width, part.height], part.rotated ? [original.width, original.length] : [original.length, original.width]);
      assert.ok(part.x >= 0 && part.y >= 0 && part.x + part.width <= panel.width && part.y + part.height <= panel.height, 'placement stays inside stock');
      for (const other of panel.placements) if (other !== part) {
        assert.ok(part.x + part.width + kerf <= other.x || other.x + other.width + kerf <= part.x || part.y + part.height + kerf <= other.y || other.y + other.height + kerf <= part.y, 'placements have the required kerf clearance');
      }
    }
    // Every recursive sub-layout can be separated with an end-to-end cut.
    const guillotine = (parts: typeof panel.placements): boolean => {
      if (parts.length < 2) return true;
      for (const axis of ['x', 'y'] as const) {
        const size = axis === 'x' ? 'width' : 'height';
        for (const part of parts) {
          const edge = part[axis] + part[size];
          const before = parts.filter((p) => p[axis] + p[size] <= edge);
          const after = parts.filter((p) => p[axis] >= edge);
          if (before.length && after.length && before.length + after.length === parts.length && guillotine(before) && guillotine(after)) return true;
        }
      }
      return false;
    };
    assert.ok(guillotine(panel.placements), 'layout admits guillotine cuts');
  }
  assert.deepEqual(placed.sort((a, b) => a - b), rows.map((_, i) => i), 'every cutlist row appears exactly once');
  assert.equal(layout.usedArea, rows.reduce((sum, r) => sum + r.length * r.width, 0));
}

test('packs an exact tiling, permits rotation and ignores mixed thicknesses', () => {
  const rows = [row(48, 24, 'a'), row(48, 24, 'b'), row(48, 24, 'c'), { ...row(48, 24, 'd'), thickness: 2 }];
  const layout = optimizeCutlist(rows, [{ width: 48, height: 96 }]);
  assert.equal(layout.panels.length, 1);
  assert.equal(layout.usedArea, layout.totalArea);
  verify(layout, rows);
  const rotated = optimizeCutlist([row(80, 30)], [{ width: 40, height: 90 }]);
  assert.equal(rotated.panels[0].placements[0].rotated, true);
  verify(rotated, [row(80, 30)]);
});

test('unlimited stock repeats sizes and favors fewer large panels over small panels', () => {
  const rows = Array.from({ length: 9 }, (_, i) => row(24, 24, String(i)));
  const sizes = [{ width: 24, height: 24 }, { width: 48, height: 48 }];
  const before = structuredClone({ rows, sizes });
  const layout = optimizeCutlist(rows, sizes);
  assert.equal(layout.panels.length, 3);
  assert.deepEqual(layout.panels.map((p) => p.width), [48, 48, 24]);
  assert.deepEqual({ rows, sizes }, before);
  assert.deepEqual(optimizeCutlist(rows, sizes), layout, 'deterministic');
  verify(layout, rows);
});

test('handles heterogeneous stock sizes, fractional inches, duplicate sizes and adversarial layouts', () => {
  const rows = [row(80, 12), row(45, 45, 'square'), row(80, 12, 'long')];
  const sizes = [{ width: 96, height: 24 }, { width: 48, height: 48 }];
  const layout = optimizeCutlist(rows, sizes);
  assert.equal(layout.panels.length, 2);
  verify(layout, rows);
  verify(optimizeCutlist([row(0.75, 0.25), row(0.25, 0.25)], [{ width: 1, height: 0.25 }, { width: 1, height: 0.25 }]), [row(0.75, 0.25), row(0.25, 0.25)]);
  let seed = 123456;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let i = 0; i < 25; i++) {
    const pieces = Array.from({ length: 35 }, (_, index) => row((1 + Math.floor(random() * 96)) / 2, (1 + Math.floor(random() * 96)) / 2, String(index)));
    verify(optimizeCutlist(pieces, [{ width: 96, height: 48 }, { width: 60, height: 60 }]), pieces);
    verify(optimizeCutlist(pieces, [{ width: 96, height: 48 }, { width: 60, height: 60 }], 1 / 8), pieces, 1 / 8);
  }
});

test('reports oversized pieces and rejects invalid input without emitting a partial layout', () => {
  assert.throws(() => optimizeCutlist([row(97, 49, 'Oversized shelf'), row(2, 2)], [{ width: 96, height: 48 }]), /Oversized shelf.*Add a larger/);
  assert.throws(() => optimizeCutlist([], [{ width: 1, height: 1 }]), /empty/);
  for (const number of [0, -1, NaN, Infinity, 0.001, 0.333]) {
    assert.throws(() => optimizeCutlist([row(number, 1)], [{ width: 96, height: 48 }]), /dimensions/);
    assert.throws(() => validatePanelSizes([{ width: 96, height: number }]), /dimensions/);
  }
  assert.throws(() => validatePanelSizes([]), /between 1 and 20/);
  assert.throws(() => validatePanelSizes(Array(21).fill({ width: 96, height: 48 })), /between 1 and 20/);
});

test('missing or malformed panels stop optimization before any cutlist work', () => {
  const unreadableRows = new Proxy([], { get() { assert.fail('Cutlist rows must not be inspected without valid panels.'); } }) as CutlistRow[];
  for (const panels of [undefined, null, {}, '', [], Array(1), [null], [undefined], [2], [{width:96}], [{width:96,height:Infinity}], [{width:1e100,height:48}]]) {
    assert.throws(() => optimizeCutlist(unreadableRows, panels as any), /panel sizes|Panel dimensions/);
  }
});

test('malformed and oversized cutlists are rejected before packing', () => {
  for (const pieces of [undefined, null, {}, '', [], Array(1), [null], [undefined], [row(0,1)], [{...row(1,1),name:''}], [{...row(1,1),thickness:NaN}], [row(1e100,1)], Array(2001).fill(row(1,1))]) {
    assert.throws(() => optimizeCutlist(pieces as any, [{width:96,height:48}]), /cutlist|Cutlist/);
  }
});

function fixture() {
  const model = createBlankDocument([]);
  model.name = 'Cabinet'; model.parentId = 'projects';
  model.boxes = Array.from({ length: 5 }, (_, i) => ({ id: `shelf-${i}`, name: `Shelf ${i + 1}`, size: [48, 24, 0.75] as [number, number, number], position: [0, 0, 0] as [number, number, number], color: '#ffffff' }));
  model.source = 'unrun draft'; model.draftDirty = true;
  const cutlist = exportModelCutlist({ boxes: model.boxes, variables: [] });
  const doc = createOptimizedCutlistDocument([model], model, cutlist, 3);
  return { model, cutlist, doc };
}

test('creates a separate named 2D snapshot and retains its source reference independently of model changes', () => {
  const { model, cutlist, doc } = fixture();
  assert.equal(doc.kind, 'sketch'); assert.equal(doc.parentId, 'projects');
  assert.equal(doc.name, 'Cabinet optimized cutlist');
  assert.equal(doc.optimizedCutlist!.kerf, 1 / 8);
  assert.equal(doc.viewMode, 'top'); assert.equal(doc.projectionMode, 'orthographic');
  assert.deepEqual(doc.rectangles, []); assert.equal(doc.draftDirty, false);
  assert.deepEqual(doc.optimizedCutlist?.source, { documentId: model.id, name: model.name });
  assert.deepEqual(doc.optimizedCutlist?.rows, cutlist.rows);
  cutlist.rows[0].length = 1; model.boxes[0].size[0] = 2;
  assert.equal(doc.optimizedCutlist?.rows[0].length, 48);
  assert.equal(model.source, 'unrun draft');
  assert.equal(createOptimizedCutlistDocument([model, doc], model, exportModelCutlist({ boxes: model.boxes, variables: [] }), 3).name, 'Cabinet optimized cutlist 2');
});

test('generated layout uses native shapes with panel bounds, piece numbers, dimensions and undo', () => {
  const { doc } = fixture();
  const layout = optimizeCutlist(doc.optimizedCutlist!.rows, doc.optimizedCutlist!.panels, doc.optimizedCutlist!.kerf);
  applyCutlistLayout(doc, layout);
  assert.equal(doc.history.length, 2);
  assert.deepEqual(resolveSnapshot(doc.history[0], 'sketch').rectangles, []);
  assert.deepEqual(resolveSnapshot(doc.history[1], 'sketch').rectangles, doc.rectangles);
  assert.equal(doc.rectangles.filter((shape) => shape.id.startsWith('cut-') && shape.kind !== 'text').length, 5);
  assert.equal(doc.rectangles.filter((shape) => shape.id.startsWith('stock-') && shape.kind !== 'text').length, 2);
  assert.match(doc.source, /Panel 1/); assert.match(doc.source, /Shelf 1/);
  assert.match(doc.source, /text: "1", height: inch/);
  for (const label of doc.rectangles.filter((shape) => shape.kind === 'text')) {
    assert.ok(label.textHeight > 0);
    assert.deepEqual(label.size, measureText(label.text, label.textHeight));
    const piece = label.id.startsWith('cut-label-') ? doc.rectangles.find((shape) => shape.id === label.id.replace('cut-label-', 'cut-')) : undefined;
    if (piece) {
      assert.ok(label.position[0] >= piece.position[0]);
      assert.ok(label.position[1] <= piece.position[1] + piece.size[1]);
      assert.ok(label.position[1] - label.size[1] >= piece.position[1]);
    }
  }
  assert.deepEqual(doc.measurements, []);
  const before = structuredClone(doc);
  doc.draftDirty = true;
  assert.throws(() => applyCutlistLayout(doc, layout), /source draft/);
  doc.draftDirty = false;
  assert.deepEqual(doc, before);
  const tooMany = optimizeCutlist(Array.from({ length: 501 }, (_, i) => row(1, 1, String(i))), [{ width: 1, height: 1 }]);
  assert.throws(() => cutlistLayoutShapes(tooMany, Array.from({ length: 501 }, (_, i) => row(1, 1, String(i)))), /at most 2000/);
  assert.deepEqual(doc, before);
});

test('drawing bounds center around the origin while preserving panel-local placements', () => {
  for (const sizes of [
    [{ width: 48, height: 24 }],
    [{ width: 48, height: 24 }, { width: 24, height: 24 }],
    [{ width: 48 + 1 / 64, height: 24 + 1 / 64 }],
  ]) for (const count of [1, 2, 3, 5]) {
    const rows = Array.from({ length: count }, (_, i) => row(i === count - 1 ? 24 : 48, 24, String(i)));
    const layout = optimizeCutlist(rows, sizes, 1 / 8);
    const before = structuredClone(layout);
    const shapes = cutlistLayoutShapes(layout, rows);
    for (const axis of [0, 1] as const) {
      const min = Math.min(...shapes.map((shape) => sketchShapeOrigin(shape)[axis]));
      const max = Math.max(...shapes.map((shape) => sketchShapeOrigin(shape)[axis] + shape.size[axis]));
      assert.ok(min < 0 && max > 0, 'drawing extends on both sides of each axis');
      assert.ok(Math.abs((min + max) / 2) <= 1 / 128 + 1e-9, 'complete bounds are centered to the nearest grid step');
    }
    layout.panels.forEach((panel, index) => {
      const stock = shapes.find((shape) => shape.id === `stock-${index}`)!;
      assert.deepEqual(stock.size, [panel.width, panel.height]);
      for (const part of panel.placements) {
        const cut = shapes.find((shape) => shape.id === `cut-${part.rowIndex}`)!;
        assert.deepEqual(cut.size, [part.width, part.height]);
        assert.deepEqual(cut.position, [stock.position[0] + part.x, stock.position[1] + part.y]);
        const label = shapes.find((shape) => shape.id === `cut-label-${part.rowIndex}`)!;
        const origin = sketchShapeOrigin(label);
        assert.ok(origin.every((value, axis) => value >= cut.position[axis] && value + label.size[axis] <= cut.position[axis] + cut.size[axis] + 1e-9), 'piece labels stay inside their pieces');
      }
    });
    assert.deepEqual(layout, before, 'drawing translation leaves optimizer output unchanged');
  }
});

test('an empty or non-finite generated layout cannot replace the current drawing', () => {
  const {doc} = fixture();
  applyCutlistLayout(doc, optimizeCutlist(doc.optimizedCutlist!.rows, doc.optimizedCutlist!.panels, doc.optimizedCutlist!.kerf));
  const before = structuredClone(doc);
  const mustNotMeasure = () => { assert.fail('Invalid layouts must fail before label generation.'); return [1,1] as [number,number]; };
  for (const layout of [{panels:[],usedArea:0,totalArea:0}, {panels:[{width:96,height:48,placements:[]}],usedArea:NaN,totalArea:4608}]) {
    assert.throws(() => applyLayout(doc,layout,mustNotMeasure), /No valid panel layout/);
    assert.deepEqual(doc,before);
  }
});

test('workspace and library backups preserve inputs and drawing after the source is deleted', () => {
  const { doc } = fixture();
  applyCutlistLayout(doc, optimizeCutlist(doc.optimizedCutlist!.rows, doc.optimizedCutlist!.panels, doc.optimizedCutlist!.kerf));
  const restored = restoreWorkspace(serializeWorkspace([doc], doc.id)).documents[0];
  assert.deepEqual(restored.optimizedCutlist, doc.optimizedCutlist);
  assert.deepEqual(restored.rectangles, doc.rectangles);
  restored.optimizedCutlist!.rows[0].name = 'Changed';
  assert.notEqual(doc.optimizedCutlist!.rows[0].name, 'Changed');
  const data = { documents: [doc], folders: [{ id: 'projects', name: 'Projects', parentId: null }], workspace: { openIds: [doc.id], activeId: doc.id, preferences: { measurementsThroughObjects: true } } };
  assert.deepEqual(restoreLibrary(exportLibrary(data)).documents[0].optimizedCutlist, doc.optimizedCutlist);
  assert.throws(() => restoreDocument({ ...serializeDocument(doc), optimizedCutlist: { ...doc.optimizedCutlist, panels: [] } }), /panel sizes/);
  assert.throws(() => restoreOptimizedCutlist({ ...doc.optimizedCutlist, rows: [{ ...row(1, 1), width: NaN }] }), /Invalid optimized/);
});

test('JavaScript export/import preserves optimizer inputs and source reference without duplicating metadata', async () => {
  const { doc } = fixture();
  applyCutlistLayout(doc, optimizeCutlist(doc.optimizedCutlist!.rows, doc.optimizedCutlist!.panels, doc.optimizedCutlist!.kerf));
  let exported = '';
  await saveDocumentFile(doc, { download: (source) => { exported = source; } });
  assert.match(exported, /^\/\/ blockwork-optimized-cutlist: /);
  const imported = await openDocumentFile(doc.name, exported, 'sketch', async () => ({ rectangles: doc.rectangles, measurements: [], groups: [] }));
  assert.deepEqual(imported.optimizedCutlist, doc.optimizedCutlist);
  assert.deepEqual(imported.rectangles, doc.rectangles);
  await saveDocumentFile(imported, { download: (source) => { exported = source; } });
  assert.equal(exported.match(/blockwork-optimized-cutlist:/g)?.length, 1);
});

test('kerf changes panel count and uses exact inter-piece gaps, including rotated pieces', () => {
  const rows = [row(48, 24, 'a'), row(48, 24, 'b')];
  assert.equal(optimizeCutlist(rows, [{ width: 96, height: 24 }], 0).panels.length, 1);
  assert.equal(optimizeCutlist(rows, [{ width: 96, height: 24 }], 1 / 8).panels.length, 2);
  for (const size of [{ width: 96.125, height: 24 }, { width: 24, height: 96.125 }]) {
    const layout = optimizeCutlist(rows, [size], 1 / 8);
    assert.equal(layout.panels.length, 1);
    verify(layout, rows, 1 / 8);
    assert.equal(layout.usedArea, 2 * 48 * 24, 'kerf does not shrink finished pieces');
  }
  const squares = Array.from({ length: 4 }, (_, i) => row(5, 5, String(i)));
  const layout = optimizeCutlist(squares, [{ width: 10.125, height: 10.125 }], 1 / 8);
  assert.equal(layout.panels.length, 1);
  verify(layout, squares, 1 / 8);
});

test('stock edges need no kerf margin and a narrower offcut can be removed', () => {
  for (const rows of [[row(96, 48)], [row(95.9375, 48)]]) {
    const layout = optimizeCutlist(rows, [{ width: 96, height: 48 }], 1 / 8);
    assert.equal(layout.panels.length, 1);
    verify(layout, rows, 1 / 8);
    assert.equal(layout.panels[0].placements[0].x, 0);
    assert.equal(layout.panels[0].placements[0].y, 0);
  }
});

test('kerf validation rejects invalid values and old documents restore with zero kerf', () => {
  const { doc } = fixture();
  const { kerf: _kerf, ...legacy } = doc.optimizedCutlist!;
  assert.equal(restoreOptimizedCutlist(legacy).kerf, 0);
  for (const value of [-1, NaN, Infinity, 0.001, 0.333, null, '1/8']) {
    assert.throws(() => validateSawKerf(value), /Saw kerf/);
    assert.throws(() => restoreOptimizedCutlist({ ...legacy, kerf: value }), /Saw kerf/);
  }
  for (const value of [-1, NaN, Infinity]) assert.throws(() => optimizeCutlist([row(1, 1)], [{ width: 2, height: 2 }], value), /Saw kerf/);
  assert.equal(validateSawKerf(0), 0);
  assert.equal(validateSawKerf(3 / 16), 3 / 16);
  doc.optimizedCutlist!.kerf = 3 / 16;
  assert.equal(restoreWorkspace(serializeWorkspace([doc], doc.id)).documents[0].optimizedCutlist!.kerf, 3 / 16);
});
