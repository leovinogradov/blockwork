import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { IndexedDBStorage } from '../src/indexeddb-storage';

test('an aborted read reports its cause without leaking a second transaction rejection', async () => {
  const databaseName = `aborted-read-${crypto.randomUUID()}`;
  const storage = new IndexedDBStorage(databaseName);
  assert.equal(await storage.read(), null);
  const nativeTransaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (...args) {
    const transaction = nativeTransaction.apply(this, args);
    if (this.name === databaseName && args[1] === 'readonly') queueMicrotask(() => transaction.abort());
    return transaction;
  };
  try { await assert.rejects(storage.read(), { name: 'AbortError' }); }
  finally { IDBDatabase.prototype.transaction = nativeTransaction; }
  assert.equal(await storage.read(), null);
  await storage.close();
});
