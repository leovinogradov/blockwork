import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankDocument, createDocument, serializeWorkspace } from '../src/documents';
import { FileLibrary, migrateWorkspace, importCollision, exportLibrary, restoreLibrary, validateLibrary, StorageConflictError, type LibraryStorage } from '../src/file-library';
import { IndexedDBStorage } from '../src/indexeddb-storage';
import type { LibraryChanges } from '../src/library-storage';
import { fileName, uniqueFileName } from '../src/file-names';
import { openSketchEditor, synchronizeSketchReferences } from '../src/sketch-editor';

const workspace = (openIds: string[] = [], activeId = openIds[0] ?? '') => ({ openIds, activeId, preferences: { measurementsThroughObjects: false } });
function fixture() {
  const adapter = new IndexedDBStorage(`test-${crypto.randomUUID()}`);
  const manager = new FileLibrary(adapter);
  return { manager, adapter };
}

test('migration preserves duplicate named files, IDs, active tab, drafts, geometry, and legacy data', async () => {
  const first = createBlankDocument([]); first.name = 'Plan.js'; first.source = 'broken draft'; first.draftDirty = true;
  first.boxes = [{ id: 'box', name: 'Box', size: [2, 3, 4], position: [0, 0, 0], color: '#ffffff' }];
  first.appliedSource = 'last good source';
  const other = createBlankDocument([]); other.name = 'plan.JS';
  const raw = serializeWorkspace([first, other], other.id, { measurementsThroughObjects: false });
  const original = JSON.parse(raw);
  const migrated = migrateWorkspace(raw);
  assert.deepEqual(migrated.documents.map((doc) => doc.name), ['Plan', 'plan 2']);
  assert.equal(migrated.workspace.activeId, other.id);
  const { manager, adapter } = fixture();
  await manager.save(migrated.documents, [], migrated.workspace);
  const restored = await manager.load();
  assert.deepEqual(restored!.documents.find((doc) => doc.id === first.id)!.boxes, first.boxes);
  assert.equal(restored!.documents.find((doc) => doc.id === first.id)!.source, 'broken draft');
  assert.equal(restored!.documents.find((doc) => doc.id === first.id)!.appliedSource, 'last good source');
  assert.equal(restored!.workspace.preferences.measurementsThroughObjects, false);
  assert.deepEqual(JSON.parse(raw), original);
  assert.equal((await adapter.read())!.files.length, 2);
  await manager.close();
});

test('closing every tab keeps all files and linked sketches available after reload', async () => {
  const model = createBlankDocument([]);
  model.sketches = [{ id: 'panel', name: 'Panel', axis: 'z', position: [0, 0, 0], size: [3, 4], color: '#fff', shapes: [] }];
  const documents = [model]; const sketch = openSketchEditor(documents, model, 'panel');
  sketch.rectangles = [{ id: 'outline', name: 'Outline', position: [0, 0], size: [3, 4], color: '#fff' }];
  synchronizeSketchReferences(documents, sketch);
  sketch.source = 'unfinished sketch'; sketch.draftDirty = true;
  const { manager } = fixture();
  await manager.save(documents, [], workspace(documents.map((doc) => doc.id), sketch.id));
  await manager.save(documents, [], workspace());
  const restored = await manager.load();
  assert.deepEqual(restored!.workspace.openIds, []);
  assert.equal(restored!.workspace.activeId, '');
  const reopened = openSketchEditor(restored!.documents, restored!.documents.find((doc) => doc.id === model.id)!, 'panel');
  assert.equal(reopened.id, sketch.id);
  assert.equal(reopened.source, 'unfinished sketch');
  assert.equal(reopened.draftDirty, true);
  await manager.close();
});

test('queued autosaves snapshot their input and commit in order; unchanged files are not rewritten', async () => {
  const { manager, adapter } = fixture();
  const a = createBlankDocument([]); const b = createBlankDocument([a]);
  const documents = [a, b];
  await manager.save(documents, [], workspace([a.id]));
  const initial = (await adapter.read())!.files;
  a.source = 'older draft'; a.draftDirty = true;
  const older = manager.save(documents, [], workspace([a.id]));
  a.source = 'latest draft';
  const latest = manager.save(documents, [], workspace([a.id]));
  a.source = 'not saved yet';
  await Promise.all([older, latest]);
  const saved = (await adapter.read())!.files;
  assert.equal(saved.find((doc) => doc.id === a.id)!.source, 'latest draft');
  assert.equal(saved.find((doc) => doc.id === a.id)!.revision, 3);
  assert.deepEqual(saved.find((doc) => doc.id === b.id), initial.find((doc) => doc.id === b.id));
  await manager.close();
});

test('rename and move preserve identity, timestamps, source, drafts, and links', async () => {
  const { manager, adapter } = fixture();
  const doc = createDocument('myfile.js', 'draft');
  const folder = { id: 'folder', name: 'Models', parentId: null };
  await manager.save([doc], [folder], workspace([doc.id]));
  const createdAt = (await adapter.read())!.files[0].createdAt;
  doc.name = fileName('my renamed file.js'); doc.parentId = folder.id;
  await manager.save([doc], [folder], workspace([doc.id]));
  const saved = (await manager.load())!.documents[0];
  assert.equal(saved.id, doc.id); assert.equal(saved.name, 'my renamed file');
  assert.equal(saved.parentId, folder.id); assert.equal(saved.source, 'draft');
  assert.equal(saved.draftDirty, true);
  assert.equal((await adapter.read())!.files[0].createdAt, createdAt);
  await manager.close();
});

test('invalid names, sibling collisions, folder cycles, and deleting a nonempty folder fail atomically', async () => {
  const { manager, adapter } = fixture();
  const doc = createBlankDocument([]); doc.name = 'Part';
  const a = { id: 'a', name: 'Models', parentId: null }; const b = { id: 'b', name: 'Nested', parentId: a.id };
  await manager.save([doc], [a, b], workspace([doc.id]));
  const before = await adapter.read();
  const duplicate = { ...doc, id: 'second', name: 'part.js' };
  await assert.rejects(manager.save([doc, duplicate], [a, b], workspace()), /already exists/);
  await assert.rejects(manager.save([doc], [{ ...a, parentId: b.id }, b], workspace()), /inside itself/);
  await assert.rejects(manager.save([doc], [b], workspace()), /Folder not found/);
  assert.deepEqual(await adapter.read(), before);
  assert.throws(() => validateLibrary([doc], [{ id: 'x', name: 'PART', parentId: null }]), /already exists/);
  await manager.close();
});

test('another window cannot overwrite a newer file, including partial multi-file saves', async () => {
  const name = `test-${crypto.randomUUID()}`;
  const first = new FileLibrary(new IndexedDBStorage(name)); const second = new FileLibrary(new IndexedDBStorage(name));
  const a = createBlankDocument([]); const b = createBlankDocument([a]);
  await first.save([a, b], [], workspace([a.id]));
  const stale = (await second.load())!;
  a.source = 'new version'; await first.save([a, b], [], workspace([a.id]));
  stale.documents.find((doc) => doc.id === a.id)!.source = 'stale version';
  stale.documents.find((doc) => doc.id === b.id)!.source = 'must not partially commit';
  await assert.rejects(second.save(stale.documents, [], stale.workspace), StorageConflictError);
  const actual = (await first.load())!;
  assert.equal(actual.documents.find((doc) => doc.id === a.id)!.source, 'new version');
  assert.equal(actual.documents.find((doc) => doc.id === b.id)!.source, '');
  await first.close(); await second.close();
});

test('a failed adapter write does not advance saved state or poison the save queue', async () => {
  const adapter = new IndexedDBStorage(`test-${crypto.randomUUID()}`);
  let fail = true;
  const storage: LibraryStorage = { read: () => adapter.read(), write: (changes) => {
    if (fail) { fail = false; return Promise.reject(new Error('Disk full')); }
    return adapter.write(changes);
  }, close: () => adapter.close() };
  const manager = new FileLibrary(storage); const doc = createBlankDocument([]);
  await assert.rejects(manager.save([doc], [], workspace([doc.id])), /Disk full/);
  assert.equal(await adapter.read(), null);
  doc.source = 'retry kept'; await manager.save([doc], [], workspace([doc.id]));
  assert.equal((await manager.load())!.documents[0].source, 'retry kept');
  await manager.close();
});

test('file manager also works with a storage adapter that has no browser database', async () => {
  let saved: LibraryChanges | null = null;
  const manager = new FileLibrary({ read: async () => null, write: async (changes) => { saved = changes; } });
  const doc = createBlankDocument([]);
  await manager.save([doc], [], workspace([doc.id]));
  assert.equal((saved as LibraryChanges | null)!.files[0].name, 'Untitled');
  await manager.save([doc], [], workspace());
  assert.deepEqual((saved as LibraryChanges | null)!.files, []);
  assert.deepEqual((saved as LibraryChanges | null)!.workspace.openIds, []);
  await manager.close();
});

test('import comparisons use current draft and file kind within the destination folder', () => {
  const doc = createDocument('myfile', 'pending draft'); doc.appliedSource = 'last good source';
  assert.equal(importCollision([doc], null, 'myfile.js', 'pending draft', 'model').identical, true);
  assert.equal(importCollision([doc], null, 'myfile.js', 'last good source', 'model').identical, false);
  assert.equal(importCollision([doc], null, 'myfile.js', 'pending draft', 'sketch').identical, false);
  assert.equal(importCollision([doc], 'folder', 'myfile', 'pending draft', 'model').existing, undefined);
  assert.equal(uniqueFileName('myfile (imported)', ['myfile (imported)', 'myfile (imported) 2']), 'myfile (imported) 3');
});

test('portable backup restores closed files, folders, drafts, and tab state and rejects invalid hierarchies', () => {
  const doc = createDocument('myfile', 'unfinished draft'); doc.parentId = 'folder';
  const original = { documents: [doc], folders: [{ id: 'folder', name: 'Models', parentId: null }], workspace: workspace() };
  const restored = restoreLibrary(exportLibrary(original));
  assert.equal(restored.documents[0].id, doc.id);
  assert.equal(restored.documents[0].source, 'unfinished draft');
  assert.equal(restored.documents[0].draftDirty, true);
  assert.deepEqual(restored.folders, original.folders);
  assert.deepEqual(restored.workspace, original.workspace);
  assert.throws(() => restoreLibrary('{}'), /Invalid/);
  assert.throws(() => restoreLibrary(exportLibrary({ ...original, folders: [] })), /Folder not found/);
});
