import './style.css';
import { compileModel } from './compiler';
import { DEFAULT_SOURCE } from './example';
import { createBoxFromFace, formatInches, generateSource, parseInches, validateBoxes, type BoxSpec, type FaceName, type RelativePlacement } from './model';
import { createViewport } from './viewport';

const STORAGE_KEY = 'blockwork.project.v1';
const PALETTE = ['#d9a76e', '#86a9a3', '#bd8c79', '#8798b5', '#b5a477', '#a68fb3'];
const root = document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML = `
  <main class="app-shell">
    <header class="topbar">
      <div class="brand-lockup"><div class="brand-mark"><span></span><span></span><span></span></div><div class="brand-name">blockwork <small>WORKSHOP</small></div></div>
      <div class="project-label"><span class="live-dot"></span><span id="project-name">Untitled model</span><span class="saved-state" id="save-state">Local</span></div>
      <div class="top-actions">
        <button class="icon-button" id="undo" title="Undo (Ctrl/Cmd+Z)" aria-label="Undo">↶</button>
        <button class="icon-button" id="redo" title="Redo (Ctrl/Cmd+Shift+Z)" aria-label="Redo">↷</button>
        <span class="top-divider"></span>
        <button class="button button-quiet" id="open-file">Open .js</button>
        <button class="button button-quiet" id="download">Download .js</button>
        <input id="file-input" type="file" accept=".js,.mjs,.txt,text/javascript" hidden />
      </div>
    </header>
    <div class="workspace">
      <aside class="sidebar panel">
        <div class="panel-heading"><div><div class="eyebrow">MODEL TREE</div><div class="heading-title">Components <span class="count-pill" id="box-count">0</span></div></div><button id="add-box" class="add-button" title="Add box">＋</button></div>
        <div class="tree-caption"><span>OBJECT</span><span>SIZE · IN</span></div>
        <div id="component-list" class="component-list"></div>
        <div class="tree-empty" id="tree-empty"><div class="empty-cube">◇</div><div>No components yet</div><small>Add a box or run some model code.</small></div>
        <div class="tree-footer"><span class="key-chip">⌘</span><span>Everything here is a box.</span></div>
      </aside>
      <section class="stage panel">
        <div class="stage-toolbar">
          <div class="view-group" aria-label="Standard views">
            <button data-view="iso" class="view-button active" title="Isometric view">ISO</button>
            <button data-view="front" class="view-button" title="Front view (1)">FRONT <kbd>1</kbd></button>
            <button data-view="right" class="view-button" title="Right view (3)">RIGHT <kbd>3</kbd></button>
            <button data-view="top" class="view-button" title="Top view (7)">TOP <kbd>7</kbd></button>
          </div>
          <div class="stage-actions">
            <button id="projection" class="tool-button" title="Toggle perspective / orthographic">PERSPECTIVE</button>
            <button id="grid-toggle" class="tool-button active" title="Toggle grid">▦ <span>GRID</span></button>
            <button id="fit" class="tool-button" title="Fit model (F)">FIT <kbd>F</kbd></button>
          </div>
        </div>
        <div class="navigation-help"><span>MIDDLE DRAG</span> orbit <i>·</i> <span>SHIFT + MIDDLE</span> / right drag pan <i>·</i> wheel zoom</div><div id="viewport" class="viewport" tabindex="0" aria-label="3D model viewport"></div>
        <div class="stage-footer"><span class="status-indicator"></span><span id="status-text">Ready</span><span class="footer-spacer"></span><span>INCHES</span><span class="footer-separator">/</span><span>SNAP 1/64</span><span class="footer-separator">/</span><span id="selection-status">NO SELECTION</span></div>
      </section>
      <aside class="inspector panel">
        <div class="panel-heading inspector-heading"><div><div class="eyebrow">PROPERTIES</div><div class="heading-title">Inspector</div></div><div class="inspector-buttons"><button id="duplicate-box" class="icon-button" title="Duplicate selected">⧉</button><button id="delete-box" class="icon-button danger-button" title="Delete selected (Delete)" aria-label="Delete selected">⌫</button></div></div>
        <div id="inspector-content" class="inspector-content"><div class="inspector-empty"><div class="empty-target">⊙</div><div>Select a box</div><small>Choose a component from the tree or viewport to inspect its dimensions.</small></div></div>
        <div class="inspector-foot"><span class="snap-icon">⌁</span><span>Values snap to <b>1/64 in</b></span></div>
      </aside>
      <section class="code-panel panel">
        <div class="code-header">
          <div class="code-title"><div class="eyebrow">SOURCE</div><div class="heading-title"><span class="code-dot">●</span> model.js <span class="code-mode">JAVASCRIPT</span></div></div>
          <div class="code-header-note" id="draft-note">Edit the code, then run it to update the model.</div>
          <div class="code-actions"><button class="button button-quiet button-small" id="reset-code">Reset example</button><button class="button button-run" id="run-code"><span>▶</span> Run <kbd>⌘↵</kbd></button></div>
        </div>
        <div class="editor-wrap"><div class="line-numbers" id="line-numbers">1</div><textarea id="source-editor" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="JavaScript model source"></textarea><div id="editor-error" class="editor-error" hidden></div></div>
      </section>
    </div>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
    <div id="face-menu" class="face-menu" role="menu" aria-label="Face actions" hidden><div class="face-menu-caption" id="face-menu-caption"></div><button id="new-from-face" role="menuitem" type="button">＋ <span>New box from face</span></button><div class="face-menu-reason" id="face-menu-reason"></div></div>
  </main>`;

const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
const editor = $('#source-editor') as HTMLTextAreaElement;
const viewportHost = $('#viewport');
const listEl = $('#component-list');
let boxes: BoxSpec[] = [];
let selectedId: string | null = null;
let selectedFace: FaceName | null = null;
let contextFace: { boxId: string; face: FaceName; clientX: number; clientY: number } | null = null;
let draftDirty = false;
let appliedSource = '';
let runEpoch = 0;
type Snapshot = { boxes: BoxSpec[]; source: string };
let history: Snapshot[] = [];
let historyAt = -1;
let saveTimer = 0;
let toastTimer = 0;
let viewMode: 'iso' | 'front' | 'right' | 'top' = 'iso';
let projectionMode: 'perspective' | 'orthographic' = 'perspective';
let gridVisible = true;
const viewport = createViewport(viewportHost, (id, face) => { selectedId = id; selectedFace = face ?? null; renderAll(); }, (hit) => openFaceMenu(hit));

function cloneBoxes(value: BoxSpec[]) { return value.map((box) => ({ ...box, size: [...box.size] as [number, number, number], position: [...box.position] as [number, number, number], relative: box.relative ? { ...box.relative, u: box.relative.u ? { ...box.relative.u } : undefined, v: box.relative.v ? { ...box.relative.v } : undefined } : undefined })); }
function setStatus(message: string, isError = false) {
  $('#status-text').textContent = message;
  $('.status-indicator').classList.toggle('status-error', isError);
}
function notify(message: string, isError = false) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.toggle('is-error', isError); toast.classList.add('visible');
  window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2800);
}
function updateLineNumbers() { $('#line-numbers').textContent = Array.from({ length: Math.max(1, editor.value.split('\n').length) }, (_, i) => String(i + 1)).join('\n'); }
function setEditor(source: string, dirty = false) { editor.value = source; draftDirty = dirty; updateLineNumbers(); syncDraftUI(); }
function syncDraftUI() {
  $('#draft-note').textContent = draftDirty ? 'Draft pending — Run to apply. GUI editing is paused.' : 'Edit the code, then run it to update the model.';
  $('#draft-note').classList.toggle('warning-note', draftDirty);
  $('#add-box').toggleAttribute('disabled', draftDirty);
  $('#delete-box').toggleAttribute('disabled', draftDirty || !selectedBox());
  $('#duplicate-box').toggleAttribute('disabled', draftDirty || !selectedBox());
  renderList(); renderInspector();
}
function selectedBox() { return boxes.find((box) => box.id === selectedId) ?? null; }
function renderList() {
  $('#box-count').textContent = String(boxes.length);
  $('#tree-empty').classList.toggle('hidden', boxes.length > 0);
  listEl.innerHTML = boxes.map((box) => `<button class="component-row ${box.id === selectedId ? 'selected' : ''}" data-id="${escapeAttr(box.id)}"><span class="row-cube" style="--cube:${escapeAttr(box.color)}"></span><span class="row-name">${escapeHTML(box.name)}</span><span class="row-size">${box.size.map(formatInches).join(' × ')}</span></button>`).join('');
  listEl.querySelectorAll<HTMLButtonElement>('.component-row').forEach((row) => row.addEventListener('click', () => { selectedId = row.dataset.id ?? null; selectedFace = null; viewport.select(selectedId); renderAll(); }));
}
function faceTitle(face: FaceName) { return face[0].toUpperCase() + face.slice(1); }
function openFaceMenu(hit: { boxId: string; face: FaceName; clientX: number; clientY: number }) {
  contextFace = hit;
  const menu = $('#face-menu'); menu.hidden = false;
  const parent = boxes.find((box) => box.id === hit.boxId);
  $('#face-menu-caption').textContent = `${parent?.name ?? 'Box'} · ${faceTitle(hit.face)} face`;
  const action = $('#new-from-face') as HTMLButtonElement;
  action.disabled = draftDirty || !parent;
  $('#face-menu-reason').textContent = draftDirty ? 'Run or discard the source draft to edit boxes.' : '';
  menu.style.left = `${Math.max(8, Math.min(hit.clientX, innerWidth - 236))}px`;
  menu.style.top = `${Math.max(8, Math.min(hit.clientY, innerHeight - menu.offsetHeight - 8))}px`;
  action.focus();
}
function closeFaceMenu() { $('#face-menu').hidden = true; contextFace = null; }
function renderInspector() {
  const box = selectedBox();
  const host = $('#inspector-content');
  if (!box) { host.innerHTML = '<div class="inspector-empty"><div class="empty-target">⊙</div><div>Select a box</div><small>Choose a component from the tree or viewport to inspect its dimensions.</small></div><div class="source-warning">GUI edits regenerate this source as literal boxes. Undo can restore earlier source.</div>'; return; }
  const relative = box.relative;
  const refOptions = boxes.filter((candidate) => candidate.id !== box.id && !isDescendant(candidate.id, box.id)).map((candidate) => `<option value="${escapeAttr(candidate.id)}" ${candidate.id === relative?.boxId ? 'selected' : ''}>${escapeHTML(candidate.name)}</option>`).join('');
  const faceOptions = (value?: FaceName) => (['front', 'back', 'left', 'right', 'top', 'bottom'] as FaceName[]).map((face) => `<option value="${face}" ${face === value ? 'selected' : ''}>${faceTitle(face)}</option>`).join('');
  const sideOptions = (axis: 'u' | 'v', value?: { side: 'left' | 'right' | 'bottom' | 'top'; offset: number }) => {
    const choices = axis === 'u' ? ['left', 'right'] : ['bottom', 'top'];
    return `<option value="">None</option>${choices.map((side) => `<option value="${side}" ${value?.side === side ? 'selected' : ''}>${faceTitle(side as FaceName)}</option>`).join('')}`;
  };
  host.innerHTML = `<div class="source-warning">GUI edits regenerate this source as literal boxes. Undo can restore earlier source.</div><div class="object-heading"><span class="object-swatch" style="--cube:${escapeAttr(box.color)}"></span><div><div class="object-name">${escapeHTML(box.name)}</div><div class="object-id">BOX · ${escapeHTML(box.id.slice(0, 8).toUpperCase())}</div></div></div>
    <label class="field-label" for="box-name">NAME</label><input id="box-name" class="text-field" value="${escapeAttr(box.name)}" ${draftDirty ? 'disabled' : ''} />
    <div class="section-label"><span>SIZE</span><span>INCHES</span></div><div class="triple-fields">${['Width · X', 'Depth · Y', 'Height · Z'].map((label, i) => `<label class="measure-field"><span>${label}</span><span class="measure-input"><input data-kind="size" data-index="${i}" value="${formatInches(box.size[i])}" inputmode="decimal" ${draftDirty ? 'disabled' : ''}/><small>in</small></span></label>`).join('')}</div>
    <div class="section-label position-label"><span>ABSOLUTE POSITION <em>MIN CORNER</em></span><span>INCHES</span></div><div class="triple-fields">${['X', 'Y', 'Z'].map((axis, i) => `<label class="measure-field"><span>${axis}</span><span class="measure-input"><input aria-label="Absolute position ${axis}" data-kind="position" data-index="${i}" value="${formatInches(box.position[i])}" inputmode="decimal" ${draftDirty || relative ? 'disabled' : ''}/><small>in</small></span></label>`).join('')}</div>
    <section class="relative-card" aria-label="Relative placement"><div class="relative-heading"><div><div class="section-label"><span>RELATIVE PLACEMENT</span></div><div class="relative-summary">${relative ? `Linked to ${escapeHTML(boxes.find((candidate) => candidate.id === relative.boxId)?.name ?? relative.boxId)} · ${faceTitle(relative.face)}` : 'Anchor this box to another box face.'}</div></div>${relative ? '<button class="small-action" id="detach-relative" type="button">Detach</button>' : ''}</div>
      <div class="relative-grid"><label class="measure-field"><span>Reference box</span><select id="relative-reference" aria-label="Reference box" ${draftDirty || !boxes.some((candidate) => candidate.id !== box.id && !isDescendant(candidate.id, box.id)) ? 'disabled' : ''}><option value="">${boxes.length < 2 ? 'No other boxes' : 'Choose box'}</option>${refOptions}</select></label>
      <label class="measure-field"><span>Reference face</span><select id="relative-face" aria-label="Reference face" ${draftDirty || !relative ? 'disabled' : ''}>${faceOptions(relative?.face)}</select></label>
      <label class="measure-field"><span>Distance from face</span><span class="measure-input"><input id="relative-offset" aria-label="Distance from face in inches" value="${formatInches(relative?.offset ?? 0)}" inputmode="decimal" ${draftDirty || !relative ? 'disabled' : ''}/><small>in</small></span></label></div>
      <div class="relative-grid side-grid"><label class="measure-field"><span>First side · U</span><select id="relative-u-side" aria-label="First side U" ${draftDirty || !relative ? 'disabled' : ''}>${sideOptions('u', relative?.u as RelativePlacement['u'])}</select></label><label class="measure-field"><span>Inward offset</span><span class="measure-input"><input id="relative-u-offset" aria-label="First side U inward offset in inches" value="${formatInches(relative?.u?.offset ?? 0)}" inputmode="decimal" ${draftDirty || !relative?.u ? 'disabled' : ''}/><small>in</small></span></label>
      <label class="measure-field"><span>Second side · V</span><select id="relative-v-side" aria-label="Second side V" ${draftDirty || !relative ? 'disabled' : ''}>${sideOptions('v', relative?.v as RelativePlacement['v'])}</select></label><label class="measure-field"><span>Inward offset</span><span class="measure-input"><input id="relative-v-offset" aria-label="Second side V inward offset in inches" value="${formatInches(relative?.v?.offset ?? 0)}" inputmode="decimal" ${draftDirty || !relative?.v ? 'disabled' : ''}/><small>in</small></span></label></div>
      <div class="relative-help">Viewed from outside the face. Positive side offsets move inward.</div></section>
    <div class="section-label color-label"><span>FACE COLOR</span><span>CUSTOM CODE</span></div><div class="color-row"><div class="swatch-grid">${PALETTE.map((c) => `<button class="swatch ${box.color.toLowerCase() === c ? 'chosen' : ''}" data-color="${c}" style="--cube:${c}" aria-label="Color ${c}" ${draftDirty ? 'disabled' : ''}></button>`).join('')}</div><input id="box-color" type="color" value="${escapeAttr(/^#[0-9a-f]{6}$/i.test(box.color) ? box.color : '#d9a76e')}" ${draftDirty ? 'disabled' : ''}/></div>
    <div class="inspector-tip">Enter an inch value or arithmetic (for example, (20 - 3/4)); press Enter or leave the field to apply it.</div>`;
  const nameInput = host.querySelector<HTMLInputElement>('#box-name')!;
  nameInput.addEventListener('change', () => updateBox(box.id, { name: nameInput.value.trim() || box.name }));
  host.querySelectorAll<HTMLInputElement>('.measure-input input[data-kind]').forEach((input) => {
    const apply = () => { try { const v = parseInches(input.value); const kind = input.dataset.kind as 'size' | 'position'; const index = Number(input.dataset.index); updateBox(box.id, { [kind]: box[kind].map((n, i) => i === index ? v : n) as [number, number, number] }); } catch (err) { input.classList.add('invalid'); notify(err instanceof Error ? err.message : 'Invalid dimension', true); } };
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } });
    input.addEventListener('change', apply);
  });
  host.querySelectorAll<HTMLInputElement>('.measure-input input[id^="relative-"]').forEach((input) => input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } }));
  const applyRelative = (patch: Partial<RelativePlacement>) => { if (!relative) return; updateBox(box.id, { relative: { ...relative, ...patch } }); };
  host.querySelector<HTMLSelectElement>('#relative-reference')?.addEventListener('change', (event) => { const refId = (event.currentTarget as HTMLSelectElement).value; if (!refId) return; if (relative) applyRelative({ boxId: refId }); else updateBox(box.id, { relative: { boxId: refId, face: 'front', offset: 0 } }); });
  host.querySelector<HTMLSelectElement>('#relative-face')?.addEventListener('change', (event) => applyRelative({ face: (event.currentTarget as HTMLSelectElement).value as FaceName }));
  host.querySelector<HTMLInputElement>('#relative-offset')?.addEventListener('change', (event) => { try { applyRelative({ offset: parseInches((event.currentTarget as HTMLInputElement).value) }); } catch (err) { notify(err instanceof Error ? err.message : 'Invalid distance', true); renderInspector(); } });
  for (const axis of ['u', 'v'] as const) {
    host.querySelector<HTMLSelectElement>(`#relative-${axis}-side`)?.addEventListener('change', (event) => {
      if (!relative) return;
      const side = (event.currentTarget as HTMLSelectElement).value;
      const old = relative[axis];
      const next = side ? { side: side as NonNullable<RelativePlacement[typeof axis]>['side'], offset: old?.offset ?? 0 } as NonNullable<RelativePlacement[typeof axis]> : undefined;
      applyRelative({ [axis]: next }); renderInspector();
    });
    host.querySelector<HTMLInputElement>(`#relative-${axis}-offset`)?.addEventListener('change', (event) => { try { const offset = parseInches((event.currentTarget as HTMLInputElement).value); const side = relative?.[axis]?.side; if (side) applyRelative({ [axis]: { side, offset } }); } catch (err) { notify(err instanceof Error ? err.message : 'Invalid side offset', true); renderInspector(); } });
  }
  host.querySelector<HTMLButtonElement>('#detach-relative')?.addEventListener('click', () => updateBox(box.id, { relative: undefined }));
  host.querySelectorAll<HTMLButtonElement>('.swatch').forEach((button) => button.addEventListener('click', () => updateBox(box.id, { color: button.dataset.color! })));
  host.querySelector<HTMLInputElement>('#box-color')?.addEventListener('change', (event) => updateBox(box.id, { color: (event.currentTarget as HTMLInputElement).value }));
}
function isDescendant(candidateId: string, ancestorId: string) { let current = boxes.find((box) => box.id === candidateId); const seen = new Set<string>(); while (current?.relative && !seen.has(current.id)) { if (current.relative.boxId === ancestorId) return true; seen.add(current.id); current = boxes.find((box) => box.id === current!.relative!.boxId); } return false; }
function renderAll() { renderList(); renderInspector(); viewport.select(selectedId, selectedFace ?? undefined); $('#delete-box').toggleAttribute('disabled', draftDirty || !selectedBox()); $('#duplicate-box').toggleAttribute('disabled', draftDirty || !selectedBox()); $('#selection-status').textContent = selectedBox() ? `SELECTED · ${selectedBox()!.name.toUpperCase()}${selectedFace ? ` · ${faceTitle(selectedFace).toUpperCase()} FACE` : ''}` : 'NO SELECTION'; }
function escapeHTML(s: string) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }
function escapeAttr(s: string) { return escapeHTML(s); }
function scheduleSave() {
  $('#save-state').textContent = 'Saving…'; window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ boxes, source: editor.value, appliedSource, draftDirty, viewMode, projectionMode, gridVisible })); $('#save-state').textContent = 'Saved locally'; } catch { $('#save-state').textContent = 'Local only'; } }, 350);
}
function recordAfterChange() { history = history.slice(0, historyAt + 1); history.push({ boxes: cloneBoxes(boxes), source: editor.value }); historyAt = history.length - 1; if (history.length > 80) { history.shift(); historyAt--; } }
function commitBoxes(next: BoxSpec[], message: string, options?: { preserveView?: boolean }) {
  boxes = cloneBoxes(validateBoxes(next)); selectedId = boxes.some((b) => b.id === selectedId) ? selectedId : null;
  if (!selectedId) selectedFace = null;
  viewport.setBoxes(boxes, options); setEditor(generateSource(boxes)); appliedSource = editor.value; recordAfterChange(); renderAll(); setStatus(message); scheduleSave();
}
function updateBox(id: string, patch: Partial<BoxSpec>) {
  if (draftDirty) return notify('Run or discard the source draft before editing boxes.', true);
  const current = boxes.find((b) => b.id === id); if (!current) return;
  try { commitBoxes(boxes.map((b) => b.id === id ? { ...b, ...patch } : b), 'Box updated', { preserveView: true }); }
  catch (err) { notify(err instanceof Error ? err.message : 'Could not update box', true); renderInspector(); }
}
function addBox(duplicate = false) {
  if (draftDirty) return;
  const base = duplicate ? selectedBox() : null;
  if (duplicate && !base) return;
  const box: BoxSpec = base ? { ...base, relative: undefined, id: crypto.randomUUID(), name: `${base.name} copy`, position: [base.position[0] + 1, base.position[1] + 1, base.position[2]] } : { id: crypto.randomUUID(), name: `Box ${boxes.length + 1}`, size: [2, 2, 2], position: [0, 0, 0], color: PALETTE[boxes.length % PALETTE.length] };
  try { commitBoxes([...boxes, box], base ? 'Box duplicated' : 'Box added'); selectedId = box.id; renderAll(); }
  catch (err) { notify(err instanceof Error ? err.message : 'Could not add box', true); }
}
function deleteBox() {
  if (draftDirty || !selectedBox()) return;
  const deletedId = selectedId!;
  try { commitBoxes(boxes.filter((b) => b.id !== deletedId).map((b) => b.relative?.boxId === deletedId ? { ...b, relative: undefined } : b), boxes.some((b) => b.relative?.boxId === deletedId) ? 'Box deleted · dependent boxes detached at their current positions' : 'Box deleted', { preserveView: true }); }
  catch (err) { notify(err instanceof Error ? err.message : 'Could not delete box', true); }
}
function createFromFace() {
  const hit = contextFace; closeFaceMenu();
  if (draftDirty || !hit) return;
  const parent = boxes.find((box) => box.id === hit.boxId); if (!parent) return;
  try {
    const child = createBoxFromFace(parent, hit.face, crypto.randomUUID());
    child.name = `${parent.name} ${faceTitle(hit.face)} box`;
    child.color = PALETTE[boxes.length % PALETTE.length];
    commitBoxes([...boxes, child], 'Box created from face', { preserveView: true }); selectedId = child.id; selectedFace = null; renderAll();
  } catch (err) { notify(err instanceof Error ? err.message : 'Could not create box from face', true); }
}
async function runSource() {
  const epoch = ++runEpoch; const source = editor.value; $('#run-code').toggleAttribute('disabled', true); $('#editor-error').toggleAttribute('hidden', true); setStatus('Compiling…');
  try {
    const next = await compileModel(source);
    if (epoch !== runEpoch) return;
    boxes = cloneBoxes(validateBoxes(next)); appliedSource = source; selectedId = null; selectedFace = null; viewport.setBoxes(boxes); viewport.fit();
    history = history.slice(0, historyAt + 1); history.push({ boxes: cloneBoxes(boxes), source }); historyAt = history.length - 1; if (history.length > 80) { history.shift(); historyAt--; }
    if (editor.value === source) setEditor(source); else { draftDirty = true; syncDraftUI(); }
    renderAll(); setStatus(editor.value === source ? `Updated · ${boxes.length} ${boxes.length === 1 ? 'box' : 'boxes'}` : 'Model updated · newer source draft retained'); scheduleSave();
  } catch (err) {
    if (epoch !== runEpoch) return;
    const message = err instanceof Error ? err.message : 'Could not compile model'; const errorEl = $('#editor-error'); errorEl.textContent = message; errorEl.hidden = false; setStatus('Source has errors · last good model kept', true); notify('Model unchanged. Fix the source error and run again.', true);
  } finally { if (epoch === runEpoch) $('#run-code').toggleAttribute('disabled', false); }
}
function undoRedo(delta: number) {
  if (draftDirty) return notify('Run or discard the source draft before undoing.', true);
  const next = historyAt + delta; if (next < 0 || next >= history.length) return;
  historyAt = next; boxes = cloneBoxes(validateBoxes(history[historyAt].boxes)); appliedSource = history[historyAt].source; selectedId = null; selectedFace = null; viewport.setBoxes(boxes, { preserveView: true }); setEditor(history[historyAt].source); renderAll(); setStatus(delta < 0 ? 'Undo' : 'Redo'); scheduleSave();
}

$('#add-box').addEventListener('click', () => addBox());
$('#delete-box').addEventListener('click', deleteBox);
$('#duplicate-box').addEventListener('click', () => addBox(true));
$('#new-from-face').addEventListener('click', createFromFace);
document.addEventListener('pointerdown', (event) => { if (!$('#face-menu').hidden && !$('#face-menu').contains(event.target as Node)) closeFaceMenu(); });
window.addEventListener('resize', closeFaceMenu);
$('#run-code').addEventListener('click', runSource);
$('#reset-code').addEventListener('click', () => { if (draftDirty && !window.confirm('Discard this unrun source draft and load the example?')) return; setEditor(DEFAULT_SOURCE, true); $('#project-name').textContent = 'Workbench example'; void runSource(); });
$('#open-file').addEventListener('click', () => ($('#file-input') as HTMLInputElement).click());
$('#file-input').addEventListener('change', async (event) => { const input = event.currentTarget as HTMLInputElement; const file = input.files?.[0]; if (!file) return; if (draftDirty && !window.confirm('Replace the pending source draft?')) { input.value = ''; return; } const source = await file.text(); setEditor(source, true); $('#project-name').textContent = file.name.replace(/\.(m?js|txt)$/i, '') || 'Opened model'; setStatus(`Loaded ${file.name} · press Run`); scheduleSave(); input.value = ''; });
$('#download').addEventListener('click', () => { const blob = new Blob([editor.value], { type: 'text/javascript' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${($('#project-name').textContent || 'model').trim().replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'model'}.js`; document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1500); notify('Download requested'); });
$('#undo').addEventListener('click', () => undoRedo(-1)); $('#redo').addEventListener('click', () => undoRedo(1));
editor.addEventListener('input', () => { draftDirty = true; updateLineNumbers(); syncDraftUI(); setStatus('Draft changed · run to update model'); scheduleSave(); });
editor.addEventListener('scroll', () => { $('#line-numbers').scrollTop = editor.scrollTop; });
root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => button.addEventListener('click', () => { viewMode = button.dataset.view as typeof viewMode; viewport.setView(viewMode); root.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b === button)); scheduleSave(); }));
$('#fit').addEventListener('click', () => viewport.fit());
$('#projection').addEventListener('click', () => { projectionMode = projectionMode === 'perspective' ? 'orthographic' : 'perspective'; viewport.setProjection(projectionMode); $('#projection').textContent = projectionMode === 'perspective' ? 'PERSPECTIVE' : 'ORTHOGRAPHIC'; scheduleSave(); });
$('#grid-toggle').addEventListener('click', () => { gridVisible = !gridVisible; viewport.setGrid(gridVisible); $('#grid-toggle').classList.toggle('active', gridVisible); scheduleSave(); });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('#face-menu').hidden) { event.preventDefault(); event.stopPropagation(); closeFaceMenu(); return; }
  const target = event.target as HTMLElement; const textEditing = target instanceof HTMLTextAreaElement || target.isContentEditable; const editing = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || textEditing;
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void runSource(); }
  else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !editing) { event.preventDefault(); undoRedo(event.shiftKey ? 1 : -1); }
  else if (!editing && event.key.toLowerCase() === 'f') viewport.fit();
  else if (!editing && ['1', '3', '7'].includes(event.key)) { const view = ({ '1': 'front', '3': 'right', '7': 'top' } as const)[event.key as '1' | '3' | '7']; viewMode = view; viewport.setView(view); root.querySelector(`[data-view="${view}"]`)?.classList.add('active'); root.querySelectorAll(`[data-view]:not([data-view="${view}"])`).forEach((b) => b.classList.remove('active')); }
  else if (!editing && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); deleteBox(); }
});

function restoreLocal() {
  try { const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return false; const data = JSON.parse(raw) as { boxes?: BoxSpec[]; source?: string; appliedSource?: string; draftDirty?: boolean; viewMode?: typeof viewMode; projectionMode?: typeof projectionMode; gridVisible?: boolean };
    if (typeof data.source !== 'string' || !Array.isArray(data.boxes)) return false; boxes = cloneBoxes(validateBoxes(data.boxes)); selectedId = null; selectedFace = null; setEditor(data.source, data.draftDirty === true); appliedSource = typeof data.appliedSource === 'string' ? data.appliedSource : (data.draftDirty ? generateSource(boxes) : data.source); viewport.setBoxes(boxes); history = [{ boxes: cloneBoxes(boxes), source: appliedSource }]; historyAt = 0;
    if (data.viewMode) { viewMode = data.viewMode; viewport.setView(viewMode); root.querySelector(`[data-view="${viewMode}"]`)?.classList.add('active'); root.querySelectorAll(`[data-view]:not([data-view="${viewMode}"])`).forEach((b) => b.classList.remove('active')); }
    if (data.projectionMode) { projectionMode = data.projectionMode; viewport.setProjection(projectionMode); $('#projection').textContent = projectionMode.toUpperCase(); }
    if (typeof data.gridVisible === 'boolean') { gridVisible = data.gridVisible; viewport.setGrid(gridVisible); $('#grid-toggle').classList.toggle('active', gridVisible); }
    $('#project-name').textContent = 'Recovered local model'; $('#save-state').textContent = 'Recovered'; return true;
  } catch { return false; }
}
if (!restoreLocal()) { setEditor(DEFAULT_SOURCE, true); $('#project-name').textContent = 'Workbench example'; void runSource(); }
renderAll();
window.addEventListener('beforeunload', () => viewport.dispose());
