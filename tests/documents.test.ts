import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankDocument, createDocument, restoreWorkspace, serializeWorkspace } from '../src/documents';
import { generateSource, type BoxSpec } from '../src/model';

const box: BoxSpec = { id: 'top', name: 'Top', size: [24, 12, 1], position: [0, 0, 0], color: '#d9a76e' };

test('opening files with the same name creates independent documents', () => {
  const a = createDocument('model.js', 'first source');
  const b = createDocument('model.js', 'second source');
  assert.notEqual(a.id, b.id);
  a.boxes.push(structuredClone(box));
  a.hiddenBoxIds.push('top');
  a.history.push({ boxes: a.boxes, variables: [], source: a.source, hiddenIds: [] });
  assert.deepEqual(b.boxes, []);
  assert.deepEqual(b.hiddenBoxIds, []);
  assert.deepEqual(b.history, []);
  assert.equal(b.source, 'second source');
});

test('new blank tabs get unique names and start ready for editing', () => {
  const existing = createDocument('Untitled.js', 'existing');
  const first = createBlankDocument([existing]);
  const second = createBlankDocument([existing, first]);
  assert.equal(first.name, 'Untitled 2.js');
  assert.equal(second.name, 'Untitled 3.js');
  assert.equal(first.source, '');
  assert.equal(first.draftDirty, false);
  assert.deepEqual(first.history, [{ boxes: [], variables: [], source: '', hiddenIds: [] }]);
  assert.equal(first.historyAt, 0);
});

test('reload retains every file, active tab, pending draft, last good model, and view settings', () => {
  const a = createDocument('workbench.js', 'broken draft');
  a.boxes = [structuredClone(box)];
  a.appliedSource = generateSource(a.boxes);
  a.hiddenBoxIds = ['top'];
  a.viewMode = 'top';
  a.projectionMode = 'orthographic';
  a.gridVisible = false;
  a.error = 'Invalid source';
  const b = createDocument('panel.js', 'new draft');
  const restored = restoreWorkspace(serializeWorkspace([a, b], b.id));
  assert.equal(restored.activeId, b.id);
  assert.deepEqual(restored.documents.map((document) => document.name), ['workbench.js', 'panel.js']);
  const saved = restored.documents[0];
  assert.equal(saved.source, 'broken draft');
  assert.equal(saved.draftDirty, true);
  assert.equal(saved.appliedSource, a.appliedSource);
  assert.deepEqual(saved.boxes, a.boxes);
  assert.deepEqual(saved.hiddenBoxIds, ['top']);
  assert.equal(saved.viewMode, 'top');
  assert.equal(saved.projectionMode, 'orthographic');
  assert.equal(saved.gridVisible, false);
  assert.equal(saved.error, 'Invalid source');
  assert.equal(saved.history[0].source, a.appliedSource);
  saved.history[0].boxes[0].size[0] = 99;
  assert.equal(saved.boxes[0].size[0], 24);
});

test('reload retains both measurement see-through choices across workspace tabs', () => {
  const model = createDocument('model.js', '');
  const sketch = createDocument('sketch.js', '', 'sketch');
  for (const measurementsThroughObjects of [false, true]) {
    for (const activeId of [model.id, sketch.id]) {
      const restored = restoreWorkspace(serializeWorkspace([model, sketch], activeId, { measurementsThroughObjects }));
      assert.equal(restored.preferences.measurementsThroughObjects, measurementsThroughObjects);
      assert.equal(restored.activeId, activeId);
    }
  }
});

test('older or invalid measurement see-through preferences use the existing default', () => {
  const document = createDocument('model.js', '');
  const saved = JSON.parse(serializeWorkspace([document], document.id));
  for (const preferences of [undefined, null, {}, { measurementsThroughObjects: 'false' }, { measurementsThroughObjects: 0 }]) {
    assert.equal(restoreWorkspace(JSON.stringify({ ...saved, preferences })).preferences.measurementsThroughObjects, true);
  }
  assert.equal(restoreWorkspace(JSON.stringify({ source: '', boxes: [] })).preferences.measurementsThroughObjects, true);
});

test('migrates original single-model saves without discarding their draft or variables', () => {
  const source = 'unfinished draft';
  const savedBox = { ...box, expressions: { 'size.0': 'var(width)' } };
  const restored = restoreWorkspace(JSON.stringify({
    source, boxes: [savedBox], variables: [{ name: 'width', value: 36 }], draftDirty: true,
    hiddenBoxIds: ['top', 'deleted'], viewMode: 'front', gridVisible: false,
  }));
  assert.equal(restored.documents.length, 1);
  const saved = restored.documents[0];
  assert.equal(restored.activeId, saved.id);
  assert.equal(saved.source, source);
  assert.equal(saved.boxes[0].size[0], 36);
  assert.deepEqual(saved.hiddenBoxIds, ['top']);
  assert.match(saved.appliedSource, /variable\(/);
  assert.equal(saved.draftDirty, true);
});

test('variable descriptions survive workspace recovery and its initial undo snapshot', () => {
  const document = createDocument('described.js', '');
  document.variables = [{ name: 'width', value: 24, description: 'Finished width\nIncludes trim' }, { name: 'depth', value: 12 }];
  document.source = document.appliedSource = generateSource([], document.variables);
  document.draftDirty = false;
  const saved = restoreWorkspace(serializeWorkspace([document], document.id)).documents[0];
  assert.deepEqual(saved.variables, document.variables);
  assert.deepEqual(saved.history[0].variables, document.variables);
  assert.equal(saved.appliedSource, document.appliedSource);
});

test('falls back to the first tab for a missing active ID and rejects corrupt workspaces', () => {
  const document = createDocument('model.js', '');
  assert.equal(restoreWorkspace(serializeWorkspace([document], 'missing')).activeId, document.id);
  assert.throws(() => restoreWorkspace('{'));
  assert.throws(() => restoreWorkspace('{"documents":[]}'));
  assert.throws(() => restoreWorkspace('{"documents":[{"source":"draft"}]}'));
  assert.throws(() => restoreWorkspace(serializeWorkspace([document, document], document.id)));
});
