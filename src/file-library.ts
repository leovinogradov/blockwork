import type { LibraryStorage, StoredFile, StoredFolder, FileData } from './library-storage';
import type { Folder, WorkspaceState } from './library-storage';
import { LibraryDataError } from './library-storage';
export type { Folder, WorkspaceState, LibraryStorage } from './library-storage';
import { restoreDocument, restoreWorkspace, serializeDocument, type ModelDocument } from './documents';
import { fileName, nameKey, uniqueFileName } from './file-names';

export type LibraryState = { documents: ModelDocument[]; folders: Folder[]; workspace: WorkspaceState };
const defaultPreferences = { measurementsThroughObjects: true };

export { StorageConflictError } from './library-storage';

/** Validate the hierarchy and the shared file/folder namespace before any writes. */
export function validateLibrary(documents: Pick<ModelDocument, 'id' | 'parentId' | 'name'>[], folders: Folder[]) {
  const ids = new Set<string>();
  const locations = new Set<string>();
  for (const entry of [...folders, ...documents]) {
    if (!entry.id || ids.has(entry.id)) throw new Error('Duplicate file or folder ID.');
    ids.add(entry.id);
    const key = JSON.stringify([entry.parentId, nameKey(entry.name)]);
    if (locations.has(key)) throw new Error('A file or folder with that name already exists here.');
    locations.add(key);
    if (entry.parentId !== null && !folders.some((folder) => folder.id === entry.parentId)) throw new Error('Folder not found.');
  }
  for (const folder of folders) {
    const visited = new Set<string>([folder.id]);
    let ancestor = folder.parentId;
    while (ancestor !== null) {
      if (visited.has(ancestor)) throw new Error('A folder cannot be moved inside itself.');
      visited.add(ancestor);
      ancestor = folders.find((entry) => entry.id === ancestor)!.parentId;
    }
  }
}

export function siblingNames(documents: ModelDocument[], folders: Folder[], parentId: string | null, exceptId?: string): string[] {
  return [...documents, ...folders].filter((entry) => entry.parentId === parentId && entry.id !== exceptId).map((entry) => entry.name);
}

/** Name is only a collision candidate. Compare the current buffer, not applied geometry. */
export function importCollision(documents: ModelDocument[], parentId: string | null, name: string, source: string, kind: ModelDocument['kind']) {
  const existing = documents.find((doc) => doc.parentId === parentId && nameKey(doc.name) === nameKey(name));
  return { existing, identical: !!existing && existing.kind === kind && existing.source === source };
}

export function migrateWorkspace(raw: string): LibraryState {
  const restored = restoreWorkspace(raw);
  const names: string[] = [];
  for (const doc of restored.documents) {
    doc.parentId = null;
    doc.name = uniqueFileName(doc.name, names);
    names.push(doc.name);
  }
  return { documents: restored.documents, folders: [], workspace: {
    openIds: restored.documents.map((doc) => doc.id), activeId: restored.activeId, preferences: restored.preferences,
  } };
}

/** One cached connection. Calls capture their inputs and commit in order, even after a failed save. */
export class FileLibrary {
  private files = new Map<string, StoredFile>();
  private folders = new Map<string, StoredFolder>();
  private queue: Promise<void> = Promise.resolve();
  private initialized = false;

  constructor(private storage: LibraryStorage) {}

  async load(): Promise<LibraryState | null> {
    const stored = await this.storage.read();
    if (!stored) return null;
    const { files, folders, workspace } = stored;
    const documents = files.map((file) => {
      try { return restoreDocument(file); }
      catch (cause) { throw new LibraryDataError(`Could not open saved file “${file?.name || file?.id || 'unnamed file'}”: ${cause instanceof Error ? cause.message : String(cause)}`, cause); }
    });
    try { validateLibrary(documents, folders); }
    catch (cause) { throw new LibraryDataError(`Could not restore the saved library: ${cause instanceof Error ? cause.message : String(cause)}`, cause); }
    this.files = new Map(files.map((file) => [file.id, file]));
    this.folders = new Map(folders.map((folder) => [folder.id, folder]));
    this.initialized = true;
    const openIds = [...new Set(workspace.openIds)].filter((id) => documents.some((doc) => doc.id === id));
    return { documents, folders: folders.map(({ id, name, parentId }) => ({ id, name, parentId })), workspace: {
      openIds, activeId: openIds.includes(workspace.activeId) ? workspace.activeId : openIds[0] ?? '',
      preferences: workspace.preferences ?? defaultPreferences,
      ...(workspace.entryOrder !== undefined ? { entryOrder: workspace.entryOrder } : {}),
      ...(Array.isArray(workspace.collapsedFolderIds) ? { collapsedFolderIds: workspace.collapsedFolderIds.filter((id) => folders.some((folder) => folder.id === id)) } : {}),
    } };
  }

  save(documents: ModelDocument[], folders: Folder[], workspace: WorkspaceState): Promise<void> {
    const state = structuredClone({ files: documents.map(serializeDocument), folders, workspace });
    const save = this.queue.then(() => this.commit(state));
    this.queue = save.catch(() => {});
    return save;
  }

  private async commit(state: { files: FileData[]; folders: Folder[]; workspace: WorkspaceState }) {
    validateLibrary(state.files, state.folders);
    const changedFiles = state.files.filter((file) => {
      const previous = this.files.get(file.id);
      return !previous || JSON.stringify(serializeDocument(previous)) !== JSON.stringify(file);
    });
    const changedFolders = state.folders.filter((folder) => {
      const previous = this.folders.get(folder.id);
      return !previous || previous.name !== folder.name || previous.parentId !== folder.parentId;
    });
    const removedFiles = [...this.files.keys()].filter((id) => !state.files.some((file) => file.id === id));
    const removedFolders = [...this.folders.keys()].filter((id) => !state.folders.some((folder) => folder.id === id));
    const now = Date.now();
    const files: StoredFile[] = changedFiles.map((file) => {
      const previous = this.files.get(file.id);
      return { ...file, name: fileName(file.name), createdAt: previous?.createdAt ?? now, updatedAt: now, revision: (previous?.revision ?? 0) + 1 };
    });
    const folders: StoredFolder[] = changedFolders.map((folder) => ({ ...folder, revision: (this.folders.get(folder.id)?.revision ?? 0) + 1 }));
    await this.storage.write({
      files, folders, removedFiles, removedFolders, workspace: state.workspace, initialize: !this.initialized,
      expectedFiles: [...changedFiles.map((file) => file.id), ...removedFiles].map((id) => ({ id, revision: this.files.get(id)?.revision })),
      expectedFolders: [...changedFolders.map((folder) => folder.id), ...removedFolders].map((id) => ({ id, revision: this.folders.get(id)?.revision })),
    });
    for (const id of removedFiles) this.files.delete(id);
    for (const id of removedFolders) this.folders.delete(id);
    for (const file of files) this.files.set(file.id, file);
    for (const folder of folders) this.folders.set(folder.id, folder);
    this.initialized = true;
  }

  async close() { await this.queue; await this.storage.close?.(); }
}

/** A portable JSON backup includes closed files, drafts, geometry, folders, and tab state. */
export function exportLibrary(state: LibraryState): string {
  return JSON.stringify({ format: 'blockwork-library', version: 1, documents: state.documents.map(serializeDocument), folders: state.folders, workspace: state.workspace }, null, 2);
}

export function restoreLibrary(raw: string): LibraryState {
  const data = JSON.parse(raw);
  if (data?.format !== 'blockwork-library' || data.version !== 1 || !Array.isArray(data.documents) || !Array.isArray(data.folders) || !data.workspace || !Array.isArray(data.workspace.openIds)) throw new Error('Invalid library backup.');
  const documents = data.documents.map((value: unknown) => restoreDocument(value));
  const folders: Folder[] = data.folders.map((folder: Folder) => {
    if (!folder || typeof folder.id !== 'string' || (folder.parentId !== null && typeof folder.parentId !== 'string') || typeof folder.name !== 'string') throw new Error('Invalid folder.');
    return { id: folder.id, parentId: folder.parentId, name: fileName(folder.name) };
  });
  validateLibrary(documents, folders);
  const openIds = [...new Set<string>(data.workspace.openIds)].filter((id) => documents.some((doc: ModelDocument) => doc.id === id));
  return { documents, folders, workspace: { openIds, activeId: openIds.includes(data.workspace.activeId) ? data.workspace.activeId : openIds[0] ?? '', ...(data.workspace.entryOrder !== undefined ? { entryOrder: data.workspace.entryOrder } : {}),
    ...(Array.isArray(data.workspace.collapsedFolderIds) ? { collapsedFolderIds: data.workspace.collapsedFolderIds.filter((id: unknown) => folders.some((folder) => folder.id === id)) } : {}), preferences: {
    measurementsThroughObjects: typeof data.workspace.preferences?.measurementsThroughObjects === 'boolean' ? data.workspace.preferences.measurementsThroughObjects : true,
  } } };
}
