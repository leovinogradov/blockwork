import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { StorageConflictError, type LibraryStorage, type StoredFile, type StoredFolder, type StoredLibrary, type WorkspaceState, type LibraryChanges } from './library-storage';

interface LibraryDB extends DBSchema {
  files: { key: string; value: StoredFile };
  folders: { key: string; value: StoredFolder };
  workspace: { key: string; value: WorkspaceState };
}

export class IndexedDBStorage implements LibraryStorage {
  private connection: Promise<IDBPDatabase<LibraryDB>>;
  constructor(databaseName = 'blockwork.files.v1') {
    this.connection = openDB<LibraryDB>(databaseName, 1, {
      upgrade(db) {
        db.createObjectStore('files', { keyPath: 'id' });
        db.createObjectStore('folders', { keyPath: 'id' });
        db.createObjectStore('workspace');
      },
      blocking(_current, _next, event) { (event.target as IDBDatabase).close(); },
    });
  }

  async read(): Promise<StoredLibrary | null> {
    const tx = (await this.connection).transaction(['files', 'folders', 'workspace'], 'readonly');
    // A request and the transaction can both reject. Preserve the request's cause
    // without leaving a second unhandled rejection from tx.done.
    void tx.done.catch(() => {});
    const [files, folders, workspace] = await Promise.all([
      tx.objectStore('files').getAll(), tx.objectStore('folders').getAll(), tx.objectStore('workspace').get('current'),
    ]);
    await tx.done;
    return workspace ? { files, folders, workspace } : null;
  }

  async write(changes: LibraryChanges): Promise<void> {
    const tx = (await this.connection).transaction(['files', 'folders', 'workspace'], 'readwrite');
    void tx.done.catch(() => {});
    const files = tx.objectStore('files');
    const folders = tx.objectStore('folders');
    try {
      if (changes.initialize && await tx.objectStore('workspace').get('current')) throw new StorageConflictError('workspace');
      for (const expected of changes.expectedFiles) {
        if ((await files.get(expected.id))?.revision !== expected.revision) throw new StorageConflictError(expected.id);
      }
      for (const expected of changes.expectedFolders) {
        if ((await folders.get(expected.id))?.revision !== expected.revision) throw new StorageConflictError(expected.id);
      }
      // Validate against the actual current database, including other windows' new entries.
      const [currentFiles, currentFolders] = await Promise.all([files.getAll(), folders.getAll()]);
      const nextFiles = new Map(currentFiles.map((entry) => [entry.id, entry]));
      const nextFolders = new Map(currentFolders.map((entry) => [entry.id, entry]));
      for (const id of changes.removedFiles) nextFiles.delete(id);
      for (const id of changes.removedFolders) nextFolders.delete(id);
      for (const file of changes.files) nextFiles.set(file.id, file);
      for (const folder of changes.folders) nextFolders.set(folder.id, folder);
      const locations = new Set<string>();
      for (const entry of [...nextFolders.values(), ...nextFiles.values()]) {
        const location = JSON.stringify([entry.parentId, entry.name.toLowerCase()]);
        if (locations.has(location)) throw new Error('A file or folder with that name already exists here.');
        locations.add(location);
        if (entry.parentId !== null && !nextFolders.has(entry.parentId)) throw new Error('Folder not found or not empty.');
      }
      for (const folder of nextFolders.values()) {
        const visited = new Set<string>([folder.id]);
        let ancestor = folder.parentId;
        while (ancestor !== null) {
          if (visited.has(ancestor)) throw new Error('A folder cannot be moved inside itself.');
          visited.add(ancestor); ancestor = nextFolders.get(ancestor)!.parentId;
        }
      }
      for (const id of changes.removedFiles) await files.delete(id);
      for (const id of changes.removedFolders) await folders.delete(id);
      for (const file of changes.files) await files.put(file);
      for (const folder of changes.folders) await folders.put(folder);
      await tx.objectStore('workspace').put(changes.workspace, 'current');
      await tx.done;
    } catch (error) {
      try { tx.abort(); } catch { /* Already aborted. */ }
      throw error;
    }
  }

  async close() { (await this.connection).close(); }
}
