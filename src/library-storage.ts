import type { serializeDocument, WorkspacePreferences } from './documents';

export type Folder = { id: string; parentId: string | null; name: string };
export type WorkspaceState = { openIds: string[]; activeId: string; preferences: WorkspacePreferences; entryOrder?: string[]; collapsedFolderIds?: string[] };
export type FileData = ReturnType<typeof serializeDocument>;
export type StoredFile = FileData & { createdAt: number; updatedAt: number; revision: number };
export type StoredFolder = Folder & { revision: number };
export type StoredLibrary = { files: StoredFile[]; folders: StoredFolder[]; workspace: WorkspaceState };
export type LibraryChanges = {
  files: StoredFile[];
  folders: StoredFolder[];
  removedFiles: string[];
  removedFolders: string[];
  expectedFiles: { id: string; revision: number | undefined }[];
  expectedFolders: { id: string; revision: number | undefined }[];
  workspace: WorkspaceState;
  initialize: boolean;
};

/** Storage boundary: adapters must apply a change set atomically, checking expected revisions.
 * Revisions detect stale writes; they do not retain content history.
 * A cloud adapter can use server-side conditional writes; a localStorage adapter can
 * serialize the complete state under one key. The editor never sees either implementation.
 */
export interface LibraryStorage {
  read(): Promise<StoredLibrary | null>;
  write(changes: LibraryChanges): Promise<void>;
  close?(): Promise<void>;
}

export class StorageConflictError extends Error {
  constructor(public fileId: string) {
    super('This file changed elsewhere. Export your work before reloading to see those changes.');
  }
}
