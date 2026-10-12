import type { TreeDrop } from './component-tree';
import { validateLibrary, type LibraryState, type Folder } from './file-library';

type Entry = { id: string; name: string; parentId: string | null };

/** Old libraries start folders-first alphabetically; explicit order survives new entries. */
export function normalizeLibraryOrder(order: unknown, documents: Entry[], folders: Folder[]): string[] {
  const entries = [...folders, ...documents];
  const folderIds = new Set(folders.map((folder) => folder.id));
  const defaults = entries.sort((a, b) => Number(folderIds.has(b.id)) - Number(folderIds.has(a.id)) || a.name.localeCompare(b.name)).map((entry) => entry.id);
  const valid = new Set(defaults);
  return [...new Set([...(Array.isArray(order) ? order.filter((id): id is string => typeof id === 'string' && valid.has(id)) : []), ...defaults])];
}

/** Plan one atomic sibling reorder or folder move, including namespace/cycle checks. */
export function planLibraryMove(state: LibraryState, id: string, drop: TreeDrop) {
  const entries = [...state.folders, ...state.documents];
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) throw new Error('File or folder not found.');
  if (id === drop.targetId) throw new Error('An item cannot be dropped onto itself.');
  const target = entries.find((candidate) => candidate.id === drop.targetId);
  if (drop.targetId && !target) throw new Error('Drop target not found.');
  if (drop.placement === 'inside' && target && !state.folders.some((folder) => folder.id === target.id)) throw new Error('Only folders can contain files.');
  if (drop.placement !== 'inside' && !target) throw new Error('Choose a file or folder to reorder beside.');
  const parentId = drop.placement === 'inside' ? target?.id ?? null : target!.parentId;
  validateLibrary(state.documents.map((doc) => doc.id === id ? { ...doc, parentId } : doc), state.folders.map((folder) => folder.id === id ? { ...folder, parentId } : folder));
  const before = normalizeLibraryOrder(state.workspace.entryOrder, state.documents, state.folders);
  const order = before.filter((entryId) => entryId !== id);
  const siblings = entries.filter((candidate) => candidate.id !== id && candidate.parentId === parentId).map((candidate) => candidate.id);
  const lastSibling = order.reduce((last, entryId, i) => siblings.includes(entryId) ? i : last, -1);
  const index = drop.placement === 'inside' ? lastSibling < 0 ? order.length : lastSibling + 1
    : order.indexOf(target!.id) + (drop.placement === 'after' ? 1 : 0);
  order.splice(index, 0, id);
  const oldSiblings = before.filter((entryId) => entries.find((candidate) => candidate.id === entryId)?.parentId === entry.parentId);
  const nextSiblings = order.filter((entryId) => entries.find((candidate) => candidate.id === entryId)?.parentId === entry.parentId);
  return { parentId, order, changed: entry.parentId !== parentId || oldSiblings.some((entryId, i) => entryId !== nextSiblings[i]) };
}
