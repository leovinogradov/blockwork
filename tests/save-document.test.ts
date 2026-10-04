import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, restoreWorkspace, serializeWorkspace } from '../src/documents';
import { javascriptFilename, saveDocumentFile, type SaveFilePicker } from '../src/save-document';

const noFallback = {
  download: () => { throw new Error('Unexpected download'); },
};

test('native save adopts the chosen filename only after the write closes and persists it', async () => {
  const document = createDocument('Untitled.js', 'unrun source draft', 'sketch');
  const id = document.id;
  const pickFile: SaveFilePicker = async (options) => {
    assert.equal(options.suggestedName, 'Untitled.js');
    return {
      name: 'Plan.js',
      createWritable: async () => ({
        write: async (source) => {
          assert.equal(source, 'unrun source draft');
          assert.equal(document.name, 'Untitled.js');
        },
        close: async () => { assert.equal(document.name, 'Untitled.js'); },
      }),
    };
  };
  assert.equal(await saveDocumentFile(document, { ...noFallback, pickFile }), 'saved');
  const restored = restoreWorkspace(serializeWorkspace([document], id));
  assert.equal(restored.activeId, id);
  assert.equal(restored.documents[0].name, 'Plan.js');
  assert.equal(restored.documents[0].kind, 'sketch');
  assert.equal(restored.documents[0].draftDirty, true);
  assert.equal(restored.documents[0].source, 'unrun source draft');
});

test('canceling the native picker leaves the document unchanged', async () => {
  const document = createDocument('Untitled.js', 'draft');
  const before = structuredClone(document);
  const pickFile: SaveFilePicker = async () => { throw new DOMException('Canceled', 'AbortError'); };
  assert.equal(await saveDocumentFile(document, { ...noFallback, pickFile }), null);
  assert.deepEqual(document, before);
});

test('write failures leave the name unchanged and are reported instead of downloading', async () => {
  for (const step of ['create', 'write', 'close']) {
    const document = createDocument('Untitled.js', 'draft');
    const pickFile: SaveFilePicker = async () => ({
      name: 'Failed.js',
      createWritable: async () => {
        if (step === 'create') throw new Error('Save failed');
        return {
          write: async () => { if (step === 'write') throw new Error('Save failed'); },
          close: async () => { if (step === 'close') throw new Error('Save failed'); },
        };
      },
    });
    await assert.rejects(saveDocumentFile(document, { ...noFallback, pickFile }), /Save failed/);
    assert.equal(document.name, 'Untitled.js');
  }
});

test('unsupported browsers download immediately using the suggested name without renaming the tab', async () => {
  const document = createDocument('old.txt', 'source at save');
  const before = structuredClone(document);
  const downloads: string[][] = [];
  const result = await saveDocumentFile(document, {
    download: (source, filename) => { downloads.push([source, filename]); },
  });
  assert.equal(result, 'downloaded');
  assert.deepEqual(downloads, [['source at save', 'old.js']]);
  assert.deepEqual(document, before);
});

test('failing a download does not rename the document', async () => {
  const document = createDocument('Untitled.js', 'draft');
  await assert.rejects(saveDocumentFile(document, {
    download: () => { throw new Error('Download failed'); },
  }), /Download failed/);
  assert.equal(document.name, 'Untitled.js');
});

test('fallback filenames normalize source extensions and reject paths or empty names', () => {
  for (const name of ['file', 'file.js', 'file.mjs', 'file.txt', ' file.JS ']) assert.equal(javascriptFilename(name), 'file.js');
  for (const name of ['', ' ', '.', '..', '../file', 'folder\\file', 'file\nname']) assert.throws(() => javascriptFilename(name));
});
