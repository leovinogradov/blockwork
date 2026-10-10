import test from 'node:test';
import assert from 'node:assert/strict';
import { openDocumentFile } from '../src/open-document';
import { restoreWorkspace, serializeWorkspace } from '../src/documents';

test('imported models are compiled, ready, and recoverable with an independent undo snapshot', async () => {
  const source = 'box({ id: "panel", size: [12, 8, 1] });';
  const document = await openDocumentFile('panel.js', source, 'model', async (text, kind) => {
    assert.equal(text, source);
    assert.equal(kind, 'model');
    return { boxes: [{ id: 'panel', name: 'Panel', size: [12, 8, 1], position: [0, 0, 0], color: '#ffffff' }], variables: [] };
  });
  assert.equal(document.draftDirty, false);
  assert.equal(document.appliedSource, source);
  assert.equal(document.error, '');
  assert.deepEqual(document.treeOrder, ['panel']);
  assert.equal(document.historyAt, 0);
  const restored = restoreWorkspace(serializeWorkspace([document], document.id)).documents[0];
  assert.deepEqual(restored.boxes, document.boxes);
  assert.equal(restored.draftDirty, false);
  document.boxes[0].size[0] = 20;
  assert.equal(document.history[0].boxes[0].size[0], 12);
});

test('imported sketches compile as sketches and retain their initial geometry', async () => {
  const document = await openDocumentFile('outline.js', 'rectangle({ size: [12, 8] });', 'sketch', async (_, kind) => {
    assert.equal(kind, 'sketch');
    return { groups: [], measurements: [], rectangles: [{ id: 'outline', name: 'Outline', size: [12, 8], position: [0, 0], color: '#ffffff' }] };
  });
  assert.equal(document.draftDirty, false);
  assert.equal(document.rectangles.length, 1);
  assert.deepEqual(document.boxes, []);
  assert.equal(document.viewMode, 'top');
  assert.equal(document.projectionMode, 'orthographic');
  assert.deepEqual(document.history[0].rectangles, document.rectangles);
});

test('a compilation failure keeps editable source and does not prevent other files from opening', async () => {
  const failed = await openDocumentFile('broken.js', 'broken source', 'model', async () => { throw new Error('Syntax error'); });
  const valid = await openDocumentFile('empty.js', '', 'model', async () => ({ boxes: [], variables: [] }));
  assert.equal(failed.source, 'broken source');
  assert.equal(failed.draftDirty, true);
  assert.equal(failed.error, 'Syntax error');
  assert.equal(failed.appliedSource, '');
  assert.deepEqual(failed.history, []);
  assert.equal(valid.draftDirty, false);
  assert.equal(valid.error, '');
});
