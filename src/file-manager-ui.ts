import type { LibraryState, Folder } from './file-library';
import type { ModelDocument } from './documents';

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
export type FileManagerActions = {
  state(): LibraryState;
  open(id: string): void;
  rename(id: string, name: string): Promise<void>;
  move(id: string, parentId: string | null): Promise<void>;
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
      <nav id="file-breadcrumbs" class="file-breadcrumbs" aria-label="Folder path"></nav>
      <div class="file-manager-toolbar"><button class="button" id="library-new">New file</button><button class="button" id="library-folder">New folder</button><button class="button" id="library-import">Import .js</button></div>
      <div id="file-manager-list" class="file-manager-list"></div><p id="file-manager-error" class="dialog-error" role="alert"></p>
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
  const path = (folder: Folder, folders: Folder[]): string => {
    const parent = folders.find((entry) => entry.id === folder.parentId);
    return parent ? `${path(parent, folders)} / ${folder.name}` : folder.name;
  };
  function render() {
    const { documents, folders, workspace } = actions.state();
    if (parentId && !folders.some((entry) => entry.id === parentId)) parentId = null;
    const ancestors: Folder[] = [];
    let ancestor = folders.find((entry) => entry.id === parentId);
    while (ancestor) { ancestors.unshift(ancestor); ancestor = folders.find((entry) => entry.id === ancestor!.parentId); }
    $('#file-breadcrumbs').innerHTML = `<button data-folder="">All files</button>` + ancestors.map((folder) => `<span>/</span><button data-folder="${escape(folder.id)}">${escape(folder.name)}</button>`).join('');
    $('#file-breadcrumbs').querySelectorAll<HTMLButtonElement>('button').forEach((button) => button.addEventListener('click', () => { parentId = button.dataset.folder || null; render(); }));
    const entries = [...folders.filter((folder) => folder.parentId === parentId).map((entry) => ({ entry, folder: true })), ...documents.filter((doc) => doc.parentId === parentId).map((entry) => ({ entry, folder: false }))].sort((a, b) => Number(b.folder) - Number(a.folder) || a.entry.name.localeCompare(b.entry.name));
    $('#file-manager-list').innerHTML = entries.length ? entries.map(({ entry, folder }) => {
      const destinations = folders.filter((candidate) => {
        let current: Folder | undefined = candidate;
        while (current) { if (current.id === entry.id) return false; current = folders.find((item) => item.id === current!.parentId); }
        return true;
      });
      return `<div class="library-row"><button class="library-entry" data-open="${escape(entry.id)}"><span class="library-kind">${folder ? '▸' : (entry as ModelDocument).kind === 'sketch' ? '□' : '◇'}</span><span>${escape(entry.name)}<small>${folder ? 'Folder' : `${(entry as ModelDocument).kind === 'sketch' ? '2D sketch' : '3D model'}${workspace.openIds.includes(entry.id) ? ' · Open' : ''}${(entry as ModelDocument).draftDirty ? ' · Draft pending' : ''}`}</small></span></button><div class="library-row-actions"><button class="button button-quiet" data-rename="${escape(entry.id)}" aria-label="Rename ${escape(entry.name)}">Rename</button><select data-move="${escape(entry.id)}" aria-label="Move ${escape(entry.name)} to folder"><option value="" ${entry.parentId === null ? 'selected' : ''}>All files</option>${destinations.map((candidate) => `<option value="${escape(candidate.id)}" ${candidate.id === entry.parentId ? 'selected' : ''}>${escape(path(candidate, folders))}</option>`).join('')}</select><button class="button button-quiet" data-delete="${escape(entry.id)}" aria-label="Delete ${escape(entry.name)}">Delete</button></div></div>`;
    }).join('') : '<div class="library-empty">This folder is empty. Create a file or import one to get started.</div>';
    $('#file-manager-list').querySelectorAll<HTMLButtonElement>('[data-open]').forEach((button) => button.addEventListener('click', () => {
      const id = button.dataset.open!;
      if (folders.some((folder) => folder.id === id)) { parentId = id; render(); }
      else { actions.open(id); dialog.close(); }
    }));
    $('#file-manager-list').querySelectorAll<HTMLButtonElement>('[data-rename]').forEach((button) => button.addEventListener('click', () => {
      const entry = [...documents, ...folders].find((entry) => entry.id === button.dataset.rename)!;
      rename(entry.id, entry.name, folders.includes(entry as Folder));
    }));
    $('#file-manager-list').querySelectorAll<HTMLSelectElement>('[data-move]').forEach((select) => select.addEventListener('change', () => void perform(() => actions.move(select.dataset.move!, select.value || null))));
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
    try { await renameAction($<HTMLInputElement>('#file-name-input').value); nameDialog.close(); render(); }
    catch (error) { $('#file-name-error').textContent = error instanceof Error ? error.message : 'Could not rename file.'; }
    finally { pendingName = false; submit.disabled = false; }
  });
  $('#file-name-cancel').addEventListener('click', () => { if (!pendingName) nameDialog.close(); });
  nameDialog.addEventListener('cancel', (event) => { if (pendingName) event.preventDefault(); });
  $('#library-folder').addEventListener('click', () => editName('New folder', '', (name) => actions.createFolder(parentId, name)));
  $('#library-new').addEventListener('click', () => { dialog.close(); actions.createFile(parentId); });
  $('#library-import').addEventListener('click', () => { dialog.close(); actions.importFiles(parentId); });
  $('#library-backup').addEventListener('click', () => actions.backup());
  $('#library-restore').addEventListener('click', () => { dialog.close(); actions.restore(); });
  $('#library-done').addEventListener('click', () => { if (!pendingAction) dialog.close(); });
  dialog.addEventListener('cancel', (event) => { if (pendingAction) event.preventDefault(); });
  $('#import-compare').addEventListener('click', () => { $('#import-comparison').hidden = !$('#import-comparison').hidden; });
  return {
    open() { render(); $('#file-manager-error').textContent = ''; dialog.showModal(); },
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
