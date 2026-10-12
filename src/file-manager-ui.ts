import type { LibraryState, Folder } from './file-library';
import type { ModelDocument } from './documents';
import { bindTreeDrag } from './component-tree-drag';
import type { TreeDrop } from './component-tree';
import { normalizeLibraryOrder, planLibraryMove } from './file-tree';

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
export type FileManagerActions = {
  state(): LibraryState;
  setFolderCollapsed(id: string, collapsed: boolean): void;
  open(id: string): void;
  rename(id: string, name: string): Promise<void>;
  move(id: string, drop: TreeDrop): Promise<void>;
  remove(id: string): Promise<void>;
  createFolder(parentId: string | null, name: string): Promise<void>;
  createFile(parentId: string | null): void;
  importFiles(parentId: string | null): void;
  backup(): void;
  restore(): void;
};

/** UI depends on file-manager actions, never on the storage implementation. */
export function createFileManager(host: HTMLElement, actions: FileManagerActions) {
  host.insertAdjacentHTML('beforeend', `
    <dialog id="file-manager-dialog" class="variable-dialog file-manager-dialog" aria-labelledby="file-manager-title">
      <div class="eyebrow">ON THIS DEVICE</div><h2 id="file-manager-title">Files</h2>
      <nav id="file-breadcrumbs" class="file-breadcrumbs" aria-label="New item folder"></nav>
      <div class="file-manager-toolbar"><button class="button" id="library-new">New file</button><button class="button" id="library-folder">New folder</button><button class="button" id="library-import">Import .js</button></div>
      <div id="file-manager-list" class="file-manager-list"></div><p class="file-drag-help">Use arrows to expand folders. Select a folder for new files. Drag between rows to reorder, onto folders to move in, or onto All files to move out.</p><p id="file-manager-error" class="dialog-error" role="alert"></p>
      <div class="dialog-actions"><button id="library-backup" class="button button-quiet">Back up library</button><button id="library-restore" class="button button-quiet">Restore backup</button><button id="library-done" class="button button-run">Done</button></div>
    </dialog>
    <dialog id="file-name-dialog" class="variable-dialog" aria-labelledby="file-name-title"><form id="file-name-form">
      <div class="eyebrow">FILES</div><h2 id="file-name-title">Rename file</h2><label class="field-label" for="file-name-input">NAME</label><input id="file-name-input" class="text-field" autocomplete="off" required maxlength="160"/>
      <p class="file-name-help">Use a name such as “myfile”. JavaScript exports add .js automatically.</p><div id="file-name-error" class="dialog-error" role="alert"></div>
      <div class="dialog-actions"><button id="file-name-cancel" type="button" class="button button-quiet">Cancel</button><button type="submit" class="button button-run">Save</button></div>
    </form></dialog>
    <dialog id="import-collision-dialog" class="variable-dialog import-collision-dialog" aria-labelledby="import-collision-title"><form method="dialog">
      <div class="eyebrow">FILE ALREADY EXISTS</div><h2 id="import-collision-title">Choose which file to keep</h2><p id="import-collision-message"></p>
      <button id="import-compare" class="button button-quiet" type="button">Compare source</button>
      <div id="import-comparison" class="import-comparison" hidden><label>Browser file<textarea id="import-browser-source" readonly></textarea></label><label>Imported file<textarea id="import-disk-source" readonly></textarea></label></div>
      <div class="dialog-actions"><button value="cancel" class="button button-quiet">Cancel</button><button value="replace" class="button">Replace browser file</button><button value="both" class="button button-run" autofocus>Keep both</button></div>
    </form></dialog>
    <dialog id="library-delete-dialog" class="variable-dialog" aria-labelledby="library-delete-title"><form method="dialog"><div class="eyebrow">DELETE</div><h2 id="library-delete-title">Delete file?</h2><p id="library-delete-message"></p><div class="dialog-actions"><button value="cancel" class="button button-quiet" autofocus>Cancel</button><button value="delete" class="button button-danger">Delete</button></div></form></dialog>
  `);
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
  const dialog = $<HTMLDialogElement>('#file-manager-dialog');
  const nameDialog = $<HTMLDialogElement>('#file-name-dialog');
  let parentId: string | null = null;
  let renameAction: ((name: string) => Promise<void>) | null = null;
  let pendingName = false;
  let pendingAction = false;
  let dragCleanup = () => {};
  function render() {
    dragCleanup();
    const state = actions.state();
    const { documents, folders, workspace } = state;
    if (parentId && !folders.some((entry) => entry.id === parentId)) parentId = null;
    const ancestors: Folder[] = [];
    let ancestor = folders.find((entry) => entry.id === parentId);
    while (ancestor) { ancestors.unshift(ancestor); ancestor = folders.find((entry) => entry.id === ancestor!.parentId); }
    $('#file-breadcrumbs').innerHTML = `<span>New items in:</span><button data-folder="" ${parentId === null ? 'aria-current="location"' : ''}>All files</button>` + ancestors.map((folder) => `<span>/</span><button data-folder="${escape(folder.id)}" ${parentId === folder.id ? 'aria-current="location"' : ''}>${escape(folder.name)}</button>`).join('');
    $('#file-breadcrumbs').querySelectorAll<HTMLButtonElement>('button').forEach((button) => button.addEventListener('click', () => { parentId = button.dataset.folder || null; render(); }));
    const order = normalizeLibraryOrder(workspace.entryOrder, documents, folders);
    const entries = [...folders.map((entry) => ({ entry, folder: true })), ...documents.map((entry) => ({ entry, folder: false }))].sort((a, b) => order.indexOf(a.entry.id) - order.indexOf(b.entry.id));
    const collapsed = new Set(workspace.collapsedFolderIds ?? []);
    const branch = (containerId: string | null, depth: number): string => entries.filter(({ entry }) => entry.parentId === containerId).map(({ entry, folder }) => {
      const count = entries.filter((candidate) => candidate.entry.parentId === entry.id).length;
      const collapseButton = folder ? `<button class="group-collapse library-collapse" data-folder-collapse="${escape(entry.id)}" aria-expanded="${!collapsed.has(entry.id)}" aria-label="${collapsed.has(entry.id) ? 'Expand' : 'Collapse'} ${escape(entry.name)}">${collapsed.has(entry.id) ? '▸' : '▾'}</button>` : '<span class="library-collapse-spacer" aria-hidden="true"></span>';
      const icon = folder ? '<svg class="library-kind" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 7V5h6l2 2h10v12H3Z"/></svg>' : `<span class="library-kind" aria-hidden="true">${(entry as ModelDocument).kind === 'sketch' ? '□' : '◇'}</span>`;
      const row = `<div class="library-row${folder ? ' library-folder' : ''}${folder && parentId === entry.id ? ' selected' : ''}" data-tree-id="${escape(entry.id)}" draggable="true" style="--tree-depth:${depth}">${collapseButton}<button class="library-entry" data-open="${escape(entry.id)}" ${folder && parentId === entry.id ? 'aria-current="location"' : ''} title="${folder ? 'Select folder for new items · Drag to move or reorder' : 'Open file · Drag to move or reorder'}">${icon}<span>${escape(entry.name)}<small>${folder ? `Folder · ${count} ${count === 1 ? 'item' : 'items'}` : `${(entry as ModelDocument).kind === 'sketch' ? '2D sketch' : '3D model'}${workspace.openIds.includes(entry.id) ? ' · Open' : ''}${(entry as ModelDocument).draftDirty ? ' · Draft pending' : ''}`}</small></span></button><div class="library-row-actions"><button class="button button-quiet" data-rename="${escape(entry.id)}" aria-label="Rename ${escape(entry.name)}">Rename</button><button class="button button-quiet" data-delete="${escape(entry.id)}" aria-label="Delete ${escape(entry.name)}">Delete</button></div></div>`;
      return row + (folder && !collapsed.has(entry.id) ? branch(entry.id, depth + 1) : '');
    }).join('');
    $('#file-manager-list').innerHTML = entries.length ? branch(null, 0) : '<div class="library-empty">No files yet. Create a file or import one to get started.</div>';
    $('#file-manager-list').insertAdjacentHTML('beforeend', '<div class="tree-root-drop" data-tree-root>Drop here to place last in All files</div>');
    $('#file-manager-list').querySelectorAll<HTMLButtonElement>('[data-folder-collapse]').forEach((button) => button.addEventListener('click', () => {
      const id = button.dataset.folderCollapse!;
      actions.setFolderCollapsed(id, !collapsed.has(id)); render();
      Array.from($('#file-manager-list').querySelectorAll<HTMLButtonElement>('[data-folder-collapse]')).find((next) => next.dataset.folderCollapse === id)?.focus();
    }));
    $('#file-manager-list').querySelectorAll<HTMLButtonElement>('[data-open]').forEach((button) => button.addEventListener('click', () => {
      const id = button.dataset.open!;
      if (folders.some((folder) => folder.id === id)) { parentId = id; if (collapsed.has(id)) actions.setFolderCollapsed(id, false); render(); }
      else { actions.open(id); dialog.close(); }
    }));
    $('#file-manager-list').querySelectorAll<HTMLButtonElement>('[data-rename]').forEach((button) => button.addEventListener('click', () => {
      const entry = [...documents, ...folders].find((entry) => entry.id === button.dataset.rename)!;
      rename(entry.id, entry.name, folders.includes(entry as Folder));
    }));
    $('#file-manager-list').querySelectorAll<HTMLButtonElement>('[data-delete]').forEach((button) => button.addEventListener('click', async () => {
      const entry = [...documents, ...folders].find((entry) => entry.id === button.dataset.delete)!;
      const folder = folders.some((folder) => folder.id === entry.id);
      const confirmation = $<HTMLDialogElement>('#library-delete-dialog');
      $('#library-delete-title').textContent = `Delete ${entry.name}?`;
      $('#library-delete-message').textContent = folder ? 'The folder must be empty before it can be deleted.' : 'This removes the browser file and closes its tab. Export or back up the file first if you want to keep a copy.';
      confirmation.returnValue = 'cancel'; confirmation.showModal();
      await new Promise<void>((resolve) => confirmation.addEventListener('close', () => resolve(), { once: true }));
      if (confirmation.returnValue === 'delete') void perform(() => actions.remove(entry.id));
    }));
    dragCleanup = bindTreeDrag({
      element: $('#file-manager-list'), handleSelector: '.library-entry', isContainer: (row) => row.classList.contains('library-folder'),
      canEdit: () => dialog.open && !pendingAction && !pendingName,
      canMove: (id, drop) => { try { return planLibraryMove(state, id, drop).changed; } catch { return false; } },
      onMove: (id, drop) => { void perform(() => actions.move(id, drop)); },
      rootTargets: [
        { element: $('#file-manager-list [data-tree-root]') },
        ...Array.from($('#file-breadcrumbs').querySelectorAll<HTMLButtonElement>('[data-folder]')).map((element) => ({ element, targetId: element.dataset.folder || undefined })),
      ],
    });
  }
  async function perform(action: () => Promise<void>) {
    if (pendingAction) return;
    pendingAction = true;
    dialog.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button, select').forEach((control) => { control.disabled = true; });
    $('#file-manager-error').textContent = '';
    try { await action(); } catch (error) { $('#file-manager-error').textContent = error instanceof Error ? error.message : 'Could not update files.'; }
    finally {
      pendingAction = false; render();
      dialog.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button, select').forEach((control) => { control.disabled = false; });
    }
  }
  function editName(title: string, name: string, action: (name: string) => Promise<void>) {
    if (nameDialog.open) return;
    renameAction = action;
    $('#file-name-title').textContent = title;
    const input = $<HTMLInputElement>('#file-name-input'); input.value = name;
    $('#file-name-error').textContent = ''; nameDialog.showModal(); input.focus(); input.select();
  }
  function rename(id: string, name: string, folder = false) { editName(folder ? 'Rename folder' : 'Rename file', name, (value) => actions.rename(id, value)); }
  $('#file-name-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pendingName || !renameAction) return;
    pendingName = true; const submit = $<HTMLButtonElement>('#file-name-form button[type=submit]'); submit.disabled = true;
    try { await renameAction($<HTMLInputElement>('#file-name-input').value); nameDialog.close(); }
    catch (error) { $('#file-name-error').textContent = error instanceof Error ? error.message : 'Could not rename file.'; }
    finally { pendingName = false; submit.disabled = false; if (!nameDialog.open) render(); }
  });
  $('#file-name-cancel').addEventListener('click', () => { if (!pendingName) nameDialog.close(); });
  nameDialog.addEventListener('cancel', (event) => { if (pendingName) event.preventDefault(); });
  function expandDestination() { if (parentId) actions.setFolderCollapsed(parentId, false); }
  $('#library-folder').addEventListener('click', () => editName('New folder', '', async (name) => { expandDestination(); await actions.createFolder(parentId, name); }));
  $('#library-new').addEventListener('click', () => { expandDestination(); dialog.close(); actions.createFile(parentId); });
  $('#library-import').addEventListener('click', () => { expandDestination(); dialog.close(); actions.importFiles(parentId); });
  $('#library-backup').addEventListener('click', () => actions.backup());
  $('#library-restore').addEventListener('click', () => { dialog.close(); actions.restore(); });
  $('#library-done').addEventListener('click', () => { if (!pendingAction) dialog.close(); });
  dialog.addEventListener('cancel', (event) => { if (pendingAction) event.preventDefault(); });
  dialog.addEventListener('close', () => { if (!dialog.open) dragCleanup(); });
  $('#import-compare').addEventListener('click', () => { $('#import-comparison').hidden = !$('#import-comparison').hidden; });
  return {
    open() { dialog.showModal(); render(); $('#file-manager-error').textContent = ''; },
    rename,
    folder: () => parentId,
    async collision(name: string, browserSource: string, diskSource: string): Promise<'both' | 'replace' | 'cancel'> {
      const collision = $<HTMLDialogElement>('#import-collision-dialog');
      $('#import-collision-message').textContent = `“${name}” already exists in your browser files and has different contents or a different file type.`;
      $<HTMLTextAreaElement>('#import-browser-source').value = browserSource;
      $<HTMLTextAreaElement>('#import-disk-source').value = diskSource;
      $('#import-comparison').hidden = true;
      collision.returnValue = 'cancel'; collision.showModal();
      await new Promise<void>((resolve) => collision.addEventListener('close', () => resolve(), { once: true }));
      return collision.returnValue === 'both' || collision.returnValue === 'replace' ? collision.returnValue : 'cancel';
    },
  };
}
