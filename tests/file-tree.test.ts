import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankDocument, serializeDocument } from '../src/documents';
import { FileLibrary, exportLibrary, restoreLibrary, type LibraryState } from '../src/file-library';
import { IndexedDBStorage } from '../src/indexeddb-storage';
import { normalizeLibraryOrder, planLibraryMove } from '../src/file-tree';

function fixture(): LibraryState {
  const a = createBlankDocument([]); a.id = 'a'; a.name = 'Alpha';
  const b = createBlankDocument([a]); b.id = 'b'; b.name = 'Beta';
  return { documents: [a, b], folders: [{ id: 'folder', name: 'Models', parentId: null }], workspace: { openIds: ['a'], activeId: 'a', preferences: { measurementsThroughObjects: true } } };
}

test('library rows reorder beside files or folders, preserve explicit mixed order, and detect no-ops', () => {
  const state = fixture();
  assert.deepEqual(normalizeLibraryOrder(undefined, state.documents, state.folders), ['folder', 'a', 'b']);
  const plan = planLibraryMove(state, 'b', { targetId: 'folder', placement: 'before' });
  assert.equal(plan.parentId, null);
  assert.equal(plan.changed, true);
  assert.deepEqual(plan.order, ['b', 'folder', 'a']);
  state.workspace.entryOrder = plan.order;
  assert.equal(planLibraryMove(state, 'b', { targetId: 'folder', placement: 'before' }).changed, false);
  assert.equal(planLibraryMove(state, 'a', { placement: 'inside' }).changed, false);
  assert.deepEqual(planLibraryMove(state, 'b', { targetId: 'a', placement: 'after' }).order, ['folder', 'a', 'b']);
});

test('folder and breadcrumb drops preserve subtree ownership and all document contents', () => {
  const state = fixture();
  state.folders.push({ id: 'child', name: 'Details', parentId: 'folder' }, { id: 'destination', name: 'Projects', parentId: null });
  state.documents[0].parentId = 'child';
  const before = structuredClone(state);
  const plan = planLibraryMove(state, 'folder', { targetId: 'destination', placement: 'inside' });
  assert.equal(plan.parentId, 'destination');
  assert.equal(plan.changed, true);
  assert.deepEqual(state, before, 'planning is immutable');
  state.folders[0].parentId = plan.parentId;
  assert.equal(state.folders.find((folder) => folder.id === 'child')?.parentId, 'folder');
  assert.equal(state.documents[0].parentId, 'child');
  const up = planLibraryMove(state, 'a', { targetId: 'folder', placement: 'inside' });
  assert.equal(up.parentId, 'folder');
  assert.equal(planLibraryMove(state, 'a', { placement: 'inside' }).parentId, null);
});

test('invalid moves reject self drops, folder cycles, files as containers, and destination name collisions', () => {
  const state = fixture();
  state.folders.push({ id: 'child', name: 'Details', parentId: 'folder' });
  state.documents[1].parentId = 'folder'; state.documents[1].name = 'ALPHA';
  const before = structuredClone(state);
  assert.throws(() => planLibraryMove(state, 'a', { targetId: 'a', placement: 'after' }), /itself/);
  assert.throws(() => planLibraryMove(state, 'folder', { targetId: 'child', placement: 'inside' }), /inside itself/);
  assert.throws(() => planLibraryMove(state, 'a', { targetId: 'b', placement: 'inside' }), /Only folders/);
  assert.throws(() => planLibraryMove(state, 'a', { targetId: 'folder', placement: 'inside' }), /already exists/);
  assert.throws(() => planLibraryMove(state, 'missing', { placement: 'inside' }), /not found/);
  assert.deepEqual(state, before);
});

test('saved order cleans malformed or stale IDs and appends new entries without sorting existing rows', () => {
  const state = fixture();
  assert.deepEqual(normalizeLibraryOrder(['b', 'a', 'b', 'deleted', 3], state.documents, state.folders), ['b', 'a', 'folder']);
  assert.deepEqual(normalizeLibraryOrder('invalid', state.documents, state.folders), ['folder', 'a', 'b']);
});

test('arrangement and folder moves survive IndexedDB reload and backup while preserving drafts and identity', async () => {
  const state = fixture();
  state.documents[0].source = 'unrun draft'; state.documents[0].draftDirty = true;
  const original = structuredClone(state.documents[0]);
  const library = new FileLibrary(new IndexedDBStorage(`file-tree-${crypto.randomUUID()}`));
  await library.save(state.documents, state.folders, state.workspace);
  const plan = planLibraryMove(state, 'a', { targetId: 'folder', placement: 'inside' });
  state.documents[0].parentId = plan.parentId; state.workspace.entryOrder = plan.order;
  state.workspace.collapsedFolderIds = ['folder', 'deleted-folder'];
  await library.save(state.documents, state.folders, state.workspace);
  const reloaded = (await library.load())!;
  assert.deepEqual(reloaded.workspace.entryOrder, plan.order);
  assert.deepEqual(reloaded.workspace.collapsedFolderIds, ['folder']);
  assert.deepEqual(serializeDocument(reloaded.documents.find((doc) => doc.id === 'a')!), serializeDocument({ ...original, parentId: 'folder' }));
  const backup = restoreLibrary(exportLibrary(reloaded));
  assert.deepEqual(backup.workspace.entryOrder, plan.order);
  assert.deepEqual(backup.workspace.collapsedFolderIds, ['folder']);
  assert.equal(backup.documents.find((doc) => doc.id === 'a')?.parentId, 'folder');
  await library.close();
});
