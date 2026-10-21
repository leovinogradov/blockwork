import { createBlankDocument, type ModelDocument } from './documents';
import type { CutlistExportResult } from './cutlist-export';
import { uniqueFileName } from './file-names';
import { formatInches, parseInches } from './model';
import { restoreOptimizedCutlist, type CutlistLayout } from './optimized-cutlist';
import { generateSketchSource, sketchShapeOrigin, validateSketchShapes, type SketchShape } from './sketch';
import { sketchTextSize } from './sketch-text';

/** Create a regular 2D document with encapsulated optimizer inputs. No download. */
export function createOptimizedCutlistDocument(documents: ModelDocument[], source: ModelDocument, cutlist: CutlistExportResult, maxThickness: number): ModelDocument {
  const doc = createBlankDocument(documents, 'sketch');
  doc.name = uniqueFileName(`${source.name} optimized cutlist`, documents.filter((item) => item.parentId === source.parentId).map((item) => item.name));
  doc.parentId = source.parentId;
  doc.optimizedCutlist = restoreOptimizedCutlist({ version: 1, source: { documentId: source.id, name: source.name }, rows: cutlist.rows, ignored: cutlist.ignored, maxThickness, panels: [{ width: 96, height: 48 }], kerf: 1 / 8 });
  return doc;
}

/** Native sketch geometry keeps Fit, pan, zoom, selection and persistence working. */
export function cutlistLayoutShapes(layout: CutlistLayout, rows: CutlistExportResult['rows'], measureText = sketchTextSize): SketchShape[] {
  if (!layout || !Array.isArray(layout.panels) || !layout.panels.length || !Number.isFinite(layout.usedArea) || layout.usedArea <= 0 || !Number.isFinite(layout.totalArea) || layout.totalArea <= 0) {
    throw new Error('No valid panel layout was generated. Check panel sizes and pieces before optimizing.');
  }
  const panels: SketchShape[] = [], pieces: SketchShape[] = [], panelLabels: SketchShape[] = [], pieceLabels: SketchShape[] = [];
  const colors = ['#d9a76e', '#86a9a3', '#bd8c79', '#8798b5', '#b5a477', '#a68fb3'];
  const columns = Math.ceil(Math.sqrt(layout.panels.length));
  const maxWidth = Math.max(...layout.panels.map((panel) => panel.width));
  const maxHeight = Math.max(...layout.panels.map((panel) => panel.height));
  const gap = Math.max(10, Math.min(maxWidth, maxHeight) * 0.12);
  const cellWidth = maxWidth + gap;
  const cellHeight = maxHeight + gap;
  const labelSize = (text: string, height: number, maxWidth: number, maxHeight: number) => {
    const initial = measureText(text, height);
    const scale = Math.min(1, maxWidth / initial[0], maxHeight / initial[1]);
    const textHeight = Math.max(1 / 64, Math.floor(height * scale * 64) / 64);
    return { textHeight, size: measureText(text, textHeight) };
  };
  layout.panels.forEach((panel, index) => {
    const x = index % columns * cellWidth, y = -Math.floor(index / columns) * cellHeight;
    const labelHeight = Math.max(2, Math.min(panel.width, panel.height) * 0.075);
    panels.push({ id: `stock-${index}`, name: `Panel ${index + 1} · ${formatInches(panel.width)} × ${formatInches(panel.height)} in`, position: [x, y], size: [panel.width, panel.height], color: '#ffffff' });
    const title = `Panel ${index + 1} · ${formatInches(panel.width)} × ${formatInches(panel.height)} in`;
    const stockLabel = labelSize(title, labelHeight, panel.width, labelHeight);
    panelLabels.push({ id: `stock-label-${index}`, name: `Panel ${index + 1} label`, kind: 'text', text: title, position: [x, y + panel.height + 1 + stockLabel.size[1]], ...stockLabel, color: '#ffffff' });
    for (const part of panel.placements) {
      const row = rows[part.rowIndex], number = part.rowIndex + 1;
      pieces[part.rowIndex] = { id: `cut-${part.rowIndex}`, name: `${number}. ${row.name} · ${formatInches(row.length)} × ${formatInches(row.width)} in${part.rotated ? ' · rotated' : ''}`, position: [x + part.x, y + part.y], size: [part.width, part.height], color: colors[part.rowIndex % colors.length] };
      const height = Math.min(labelHeight, part.height * 0.45, part.width / (String(number).length + 1));
      const label = labelSize(String(number), height, part.width * 0.9, part.height * 0.45);
      pieceLabels[part.rowIndex] = { id: `cut-label-${part.rowIndex}`, name: `Piece ${number} label`, kind: 'text', text: String(number), position: [x + part.x + (part.width - label.size[0]) / 2, y + part.y + (part.height + label.size[1]) / 2], ...label, color: colors[part.rowIndex % colors.length] };
    }
  });
  // Emit panels first, then numbered pieces with their labels, then panel labels.
  const rectangles = validateSketchShapes([...panels, ...pieces.flatMap((piece, index) => [piece, pieceLabels[index]]), ...panelLabels]);
  const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
  for (const shape of rectangles) {
    const origin = sketchShapeOrigin(shape);
    for (const axis of [0, 1] as const) {
      min[axis] = Math.min(min[axis], origin[axis]);
      max[axis] = Math.max(max[axis], origin[axis] + shape.size[axis]);
    }
  }
  // Center the complete drawing, including text, with a shared grid-aligned shift.
  const offset = min.map((value, axis) => parseInches((value + max[axis]) / 2));
  for (const shape of rectangles) {
    shape.position = [shape.position[0] - offset[0], shape.position[1] - offset[1]];
  }
  return rectangles;
}

/** Replace the drawing atomically after successful packing/validation, retaining undo. */
export function applyCutlistLayout(doc: ModelDocument, layout: CutlistLayout, measureText = sketchTextSize) {
  if (!doc.optimizedCutlist || doc.kind !== 'sketch') throw new Error('Choose an optimized cutlist document.');
  if (doc.draftDirty) throw new Error('Run or discard the source draft before optimizing.');
  const rectangles = cutlistLayoutShapes(layout, doc.optimizedCutlist.rows, measureText);
  const source = generateSketchSource(rectangles);
  Object.assign(doc, { rectangles, groups: [], treeOrder: rectangles.map((shape) => shape.id), measurements: [], hiddenBoxIds: [], collapsedGroupIds: [], selectedId: null, selectedSketchIds: [], source, appliedSource: source, draftDirty: false, error: '' });
  doc.history = doc.history.slice(0, doc.historyAt + 1);
  doc.history.push({ boxes: [], rectangles: structuredClone(rectangles), variables: [], source, hiddenIds: [] });
  if (doc.history.length > 80) doc.history.shift();
  doc.historyAt = doc.history.length - 1;
}
