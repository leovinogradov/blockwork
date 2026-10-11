import { createBlankDocument, type ModelDocument } from './documents';
import { pruneMeasurements } from './measurements';
import { generateSource, resolveModel } from './model';
import { flattenSketchShapes, sketchReferenceOrigin, type ModelSketch } from './model-sketch';
import { generateSketchSource } from './sketch';
import { fileName, uniqueFileName } from './file-names';

function sketchFileName(name: string): string {
  try { return fileName(name.replace(/[\\/\x00-\x1f]/g, ' ')); }
  catch { return 'Sketch'; }
}

export function findSketchEditor(documents: ModelDocument[], modelId: string, sketchId: string): ModelDocument | undefined {
  return documents.find((doc) => doc.kind === 'sketch' && doc.sketchTargets?.some((target) => target.documentId === modelId && target.sketchId === sketchId));
}

export function linkSketchEditor(documents: ModelDocument[], modelId: string, sketchId: string, editorId?: string, origin: [number, number] = [0, 0]) {
  for (const doc of documents) {
    if (doc.sketchTargets) doc.sketchTargets = doc.sketchTargets.filter((target) => target.documentId !== modelId || target.sketchId !== sketchId);
  }
  const editor = documents.find((doc) => doc.id === editorId && doc.kind === 'sketch');
  if (editor) (editor.sketchTargets ??= []).push({ documentId: modelId, sketchId, origin: [...origin] });
}

export function resolveLinkedSketches(documents: ModelDocument[], modelId: string, sketches: ModelSketch[]): ModelSketch[] {
  return sketches.map((sketch) => {
    const editor = findSketchEditor(documents, modelId, sketch.id);
    const target = editor?.sketchTargets?.find((item) => item.documentId === modelId && item.sketchId === sketch.id);
    return editor && target ? { ...sketch, shapes: flattenSketchShapes(editor.rectangles, editor.groups, target.origin), referenceName: editor.name } : sketch;
  });
}

/** Reuse the exact linked document, retaining its draft, selection, and undo history. */
export function openSketchEditor(documents: ModelDocument[], model: ModelDocument, sketchId: string): ModelDocument {
  const sketch = model.sketches.find((item) => item.id === sketchId);
  if (model.kind !== 'model' || !sketch) throw new Error('Choose a model sketch to edit.');
  const existing = findSketchEditor(documents, model.id, sketchId);
  if (existing) return existing;
  // Adopt an unambiguous tab created by the original copy-based workflow.
  const legacy = documents.filter((doc) => doc.kind === 'sketch' && !doc.sketchTargets?.length && fileName(doc.name) === sketchFileName(sketch.referenceName ?? sketch.name));
  if (legacy.length === 1) {
    linkSketchEditor(documents, model.id, sketchId, legacy[0].id, sketch.referenceName ? sketchReferenceOrigin(legacy[0].rectangles, legacy[0].groups) : [0, 0]);
    return legacy[0];
  }
  const doc = createBlankDocument(documents, 'sketch');
  doc.parentId = model.parentId;
  doc.name = uniqueFileName(sketchFileName(sketch.name), documents.filter((item) => item.parentId === doc.parentId).map((item) => item.name));
  doc.rectangles = structuredClone(sketch.shapes);
  doc.source = doc.appliedSource = generateSketchSource(doc.rectangles);
  doc.history = [{ boxes: [], rectangles: structuredClone(doc.rectangles), variables: [], source: doc.source, hiddenIds: [] }];
  documents.push(doc);
  linkSketchEditor(documents, model.id, sketchId, doc.id);
  return doc;
}

/** Update every mounted reference from applied geometry, without discarding model drafts. */
export function synchronizeSketchReferences(documents: ModelDocument[], editor: ModelDocument): string[] {
  if (editor.kind !== 'sketch') return [];
  const changed: string[] = [];
  for (const model of documents) {
    if (model.kind !== 'model') continue;
    const targets = editor.sketchTargets?.filter((target) => target.documentId === model.id) ?? [];
    if (!targets.length) continue;
    const nextSketches = resolveLinkedSketches([editor], model.id, model.sketches);
    if (JSON.stringify(nextSketches) === JSON.stringify(model.sketches)) continue;
    const measurements = pruneMeasurements(model.measurements, { boxes: model.boxes, sketches: nextSketches });
    const resolved = resolveModel(model.boxes, model.variables, model.groups, nextSketches, measurements);
    const source = generateSource(resolved.boxes, resolved.variables, model.groups, model.treeOrder, resolved.sketches, measurements);
    model.sketches = structuredClone(resolved.sketches ?? []);
    model.measurements = measurements;
    model.appliedSource = source;
    if (!model.draftDirty) model.source = source;
    model.history = model.history.slice(0, model.historyAt + 1);
    model.history.push({ boxes: structuredClone(model.boxes), sketches: structuredClone(model.sketches), groups: structuredClone(model.groups), treeOrder: [...model.treeOrder], variables: structuredClone(model.variables), measurements: structuredClone(measurements), source, hiddenIds: [...model.hiddenBoxIds] });
    if (model.history.length > 80) model.history.shift();
    model.historyAt = model.history.length - 1;
    changed.push(model.id);
  }
  return changed;
}
