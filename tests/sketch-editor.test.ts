import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankDocument, resolveSnapshot, restoreWorkspace, serializeWorkspace } from '../src/documents';
import { generateSource } from '../src/model';
import type { ModelSketch } from '../src/model-sketch';
import { findSketchEditor, linkSketchEditor, openSketchEditor, resolveLinkedSketches, synchronizeSketchReferences } from '../src/sketch-editor';
import { generateSketchSource } from '../src/sketch';

const drawing: ModelSketch = { id: 'drawing', name: 'Panel', axis: 'y', position: [4, 5, 6], size: [12, 8], color: '#86a9a3', shapes: [
  { id: 'outline', name: 'Outline', size: [12, 8], position: [0, 0], color: '#ffffff' },
  { id: 'diagonal', name: 'Diagonal', kind: 'line', position: [6, 2], size: [-4, 3], color: '#d9a76e' },
] };
function fixture() {
  const model = createBlankDocument([]);
  model.name = 'model.js';
  model.sketches = [structuredClone(drawing)];
  model.source = model.appliedSource = generateSource([], [], [], [], model.sketches);
  model.history = [{ boxes: [], sketches: structuredClone(model.sketches), variables: [], source: model.source, hiddenIds: [] }];
  const documents = [model];
  return { documents, model };
}

test('Edit contents reuses the linked tab and preserves its draft, history, and selection', () => {
  const { documents, model } = fixture();
  const editor = openSketchEditor(documents, model, drawing.id);
  assert.deepEqual(editor.rectangles, drawing.shapes);
  assert.equal(editor.draftDirty, false);
  editor.source = 'unfinished source'; editor.draftDirty = true;
  editor.selectedId = 'outline'; editor.scrollTop = 80;
  const history = editor.history;
  model.sketches[0].name = 'Renamed panel'; editor.name = 'Renamed editor.js';
  const reopened = openSketchEditor(documents, model, drawing.id);
  assert.equal(reopened, editor);
  assert.equal(documents.length, 2);
  assert.equal(reopened.source, 'unfinished source');
  assert.equal(reopened.selectedId, 'outline');
  assert.equal(reopened.scrollTop, 80);
  assert.equal(reopened.history, history);
  assert.equal(findSketchEditor(documents, model.id, drawing.id), editor);
});

test('applied edits replace referenced shapes and source while retaining model placement and frame', () => {
  const { documents, model } = fixture();
  const editor = openSketchEditor(documents, model, drawing.id);
  editor.rectangles[0].size = [16, 10]; editor.rectangles[0].position = [3, -2];
  editor.rectangles[1].size = [-6, 5]; editor.rectangles[1].color = '#8798b5';
  const before = structuredClone(model.history[0]);
  assert.deepEqual(synchronizeSketchReferences(documents, editor), [model.id]);
  assert.deepEqual(model.sketches[0].shapes, editor.rectangles);
  assert.deepEqual(model.sketches[0].position, drawing.position);
  assert.deepEqual(model.sketches[0].size, drawing.size);
  assert.equal(model.sketches[0].axis, 'y');
  assert.match(model.source, /inch\("16"\)/);
  assert.equal(model.source, model.appliedSource);
  assert.deepEqual(model.history[0], before);
  assert.deepEqual(resolveSnapshot(model.history.at(-1)!, 'model').sketches, model.sketches);
  model.sketches[0].shapes[0].size[0] = 1;
  assert.equal(editor.rectangles[0].size[0], 16);
});

test('linked references keep their initial origin when shapes or sketch groups move', () => {
  const { documents, model } = fixture();
  const editor = createBlankDocument(documents, 'sketch'); documents.push(editor);
  editor.groups = [{ id: 'detail', name: 'Detail', position: [10, 20, 0] }];
  editor.rectangles = drawing.shapes.map((shape) => ({ ...structuredClone(shape), groupId: 'detail' }));
  linkSketchEditor(documents, model.id, drawing.id, editor.id, [10, 20]);
  synchronizeSketchReferences(documents, editor);
  assert.deepEqual(model.sketches[0].shapes[0].position, [0, 0]);
  editor.groups[0].position = [13, 18, 0];
  synchronizeSketchReferences(documents, editor);
  assert.deepEqual(model.sketches[0].shapes[0].position, [3, -2]);
  assert.ok(model.sketches[0].shapes.every((shape) => !shape.groupId));
  assert.deepEqual(model.sketches[0].position, drawing.position);
});

test('last applied geometry transfers while both source and model have pending drafts', () => {
  const { documents, model } = fixture();
  const editor = openSketchEditor(documents, model, drawing.id);
  model.draftDirty = true; model.source = 'model draft must survive';
  editor.draftDirty = true; editor.source = 'newer sketch draft';
  editor.rectangles[0].size[0] = 18;
  synchronizeSketchReferences(documents, editor);
  assert.equal(model.source, 'model draft must survive');
  assert.equal(model.draftDirty, true);
  assert.match(model.appliedSource, /inch\("18"\)/);
  assert.equal(model.sketches[0].shapes[0].size[0], 18);
  assert.equal(editor.source, 'newer sketch draft');
  const oldDraftSketches = [structuredClone(drawing)];
  assert.equal(resolveLinkedSketches(documents, model.id, oldDraftSketches)[0].shapes[0].size[0], 18);
  assert.equal(oldDraftSketches[0].shapes[0].size[0], 12);
});

test('every model reference updates together and switching references detaches the previous tab', () => {
  const { documents, model } = fixture();
  const other = createBlankDocument(documents); other.sketches = [{ ...structuredClone(drawing), id: 'other' }]; documents.push(other);
  model.sketches.push({ ...structuredClone(drawing), id: 'copy' });
  const editor = openSketchEditor(documents, model, drawing.id);
  linkSketchEditor(documents, model.id, 'copy', editor.id);
  linkSketchEditor(documents, other.id, 'other', editor.id);
  editor.rectangles[0].size[0] = 20;
  assert.deepEqual(synchronizeSketchReferences(documents, editor), [model.id, other.id]);
  assert.deepEqual(model.sketches.map((sketch) => sketch.shapes[0].size[0]), [20, 20]);
  assert.equal(other.sketches[0].shapes[0].size[0], 20);
  const replacement = createBlankDocument(documents, 'sketch'); replacement.rectangles = structuredClone(drawing.shapes); documents.push(replacement);
  linkSketchEditor(documents, model.id, drawing.id, replacement.id);
  editor.rectangles[0].size[0] = 24; synchronizeSketchReferences(documents, editor);
  assert.equal(model.sketches[0].shapes[0].size[0], 20);
  assert.equal(model.sketches[1].shapes[0].size[0], 24);
  replacement.rectangles[0].size[0] = 15; synchronizeSketchReferences(documents, replacement);
  assert.equal(model.sketches[0].shapes[0].size[0], 15);
  assert.equal(openSketchEditor(documents, model, drawing.id), replacement);
  linkSketchEditor(documents, model.id, drawing.id);
  assert.equal(findSketchEditor(documents, model.id, drawing.id), undefined);
});

test('undo and redo in the 2D document propagate and discard model redo history after new edits', () => {
  const { documents, model } = fixture();
  const editor = openSketchEditor(documents, model, drawing.id);
  synchronizeSketchReferences(documents, editor);
  const previous = structuredClone(editor.rectangles);
  editor.rectangles[0].size[0] = 18; synchronizeSketchReferences(documents, editor);
  const next = structuredClone(editor.rectangles);
  editor.rectangles = previous; synchronizeSketchReferences(documents, editor);
  assert.equal(model.sketches[0].shapes[0].size[0], 12);
  editor.rectangles = next; synchronizeSketchReferences(documents, editor);
  assert.equal(model.sketches[0].shapes[0].size[0], 18);
  model.historyAt--;
  const redoSource = model.history.at(-1)!.source;
  editor.rectangles[0].size[0] = 22; synchronizeSketchReferences(documents, editor);
  assert.notEqual(model.history.at(-1)!.source, redoSource);
  assert.equal(model.historyAt, model.history.length - 1);
  const count = model.history.length;
  assert.deepEqual(synchronizeSketchReferences(documents, editor), []);
  assert.equal(model.history.length, count);
});

test('workspace recovery restores editor identity and live updates, without external IDs in saved model source', () => {
  const { documents, model } = fixture();
  const editor = openSketchEditor(documents, model, drawing.id);
  synchronizeSketchReferences(documents, editor);
  const restored = restoreWorkspace(serializeWorkspace(documents, editor.id));
  const recoveredModel = restored.documents.find((doc) => doc.id === model.id)!;
  const reopened = openSketchEditor(restored.documents, recoveredModel, drawing.id);
  assert.equal(reopened.id, editor.id);
  assert.equal(restored.documents.length, 2);
  reopened.rectangles[0].size[0] = 24;
  synchronizeSketchReferences(restored.documents, reopened);
  assert.equal(recoveredModel.sketches[0].shapes[0].size[0], 24);
  assert.ok(!recoveredModel.source.includes(editor.id));
  assert.ok(!recoveredModel.source.includes(model.id));
});

test('closing an editor creates a new one from the latest embedded geometry', () => {
  const { documents, model } = fixture();
  const editor = openSketchEditor(documents, model, drawing.id);
  editor.rectangles[0].size[0] = 17; synchronizeSketchReferences(documents, editor);
  documents.splice(documents.indexOf(editor), 1);
  const replacement = openSketchEditor(documents, model, drawing.id);
  assert.notEqual(replacement.id, editor.id);
  assert.equal(replacement.rectangles[0].size[0], 17);
  assert.equal(documents.length, 2);
});

test('legacy editor reuse is unambiguous and separately created sketches with the same name stay independent', () => {
  const { documents, model } = fixture();
  const old = createBlankDocument(documents, 'sketch'); old.name = 'Panel.js'; old.rectangles = structuredClone(drawing.shapes);
  old.source = old.appliedSource = generateSketchSource(old.rectangles); documents.push(old);
  assert.equal(openSketchEditor(documents, model, drawing.id), old);
  model.sketches.push({ ...structuredClone(drawing), id: 'second' });
  const second = openSketchEditor(documents, model, 'second');
  assert.notEqual(second.id, old.id);
  assert.equal(second.name, 'Panel 2.js');
  assert.equal(findSketchEditor(documents, model.id, drawing.id), old);
  assert.equal(findSketchEditor(documents, model.id, 'second'), second);
});

test('deleted shapes remove dependent model measurements, while missing targets are ignored', () => {
  const { documents, model } = fixture();
  const editor = openSketchEditor(documents, model, drawing.id);
  model.measurements = [{ id: 'diagonal-length', start: { objectId: drawing.id, shapeId: 'diagonal', coordinates: [0] }, end: { objectId: drawing.id, shapeId: 'diagonal', coordinates: [1] } }];
  editor.rectangles = editor.rectangles.filter((shape) => shape.id !== 'diagonal');
  synchronizeSketchReferences(documents, editor);
  assert.deepEqual(model.measurements, []);
  model.sketches = [];
  assert.doesNotThrow(() => synchronizeSketchReferences(documents, editor));
  const orphan = createBlankDocument(documents, 'sketch'); documents.push(orphan);
  orphan.sketchTargets = [{ documentId: 'missing', sketchId: 'missing', origin: [0, 0] }];
  const recovered = restoreWorkspace(serializeWorkspace(documents, model.id));
  assert.ok(recovered.documents.filter((doc) => doc.kind === 'sketch').every((doc) => !doc.sketchTargets?.length));
});

test('invalid accumulated sketch content leaves each model unchanged', () => {
  const { documents, model } = fixture();
  const editor = openSketchEditor(documents, model, drawing.id);
  editor.rectangles[0].size[0] = 0;
  const before = structuredClone(model);
  assert.throws(() => synchronizeSketchReferences(documents, editor), /positive/);
  assert.deepEqual(model, before);
});
