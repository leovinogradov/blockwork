import './style.css';
import Picker from 'vanilla-picker';
import { compileModel } from './compiler';
import { DEFAULT_SOURCE } from './example';
import { createBoxFromFace, formatInches, generateSource, parseInches, removeVariable, resolveModel, validateBoxes, type BoxSpec, type FaceName, type RelativePlacement, type VariableSpec, type NumericField } from './model';
import { createViewport } from './viewport';

const STORAGE_KEY = 'blockwork.project.v1';
const TRANSPARENT_COLOR = 'transparent';
const PALETTE = ['#d9a76e', '#86a9a3', '#bd8c79', '#8798b5', '#b5a477', '#a68fb3'];
const COLOR_OPTIONS = [...PALETTE, TRANSPARENT_COLOR];
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
        <div class="panel-heading"><div><div class="eyebrow">MODEL TREE</div><div class="heading-title">Components <span class="count-pill" id="box-count">0</span></div></div><div class="tree-actions"><button id="add-variable" class="add-variable" title="Add variable" aria-label="Add variable">ƒ</button><button id="add-box" class="add-button" title="Add box">＋</button></div></div>
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
    <div id="face-color-picker-anchor" class="face-color-picker-anchor"></div>
    <dialog id="variable-dialog" class="variable-dialog"><form id="variable-form"><div class="eyebrow">MODEL VARIABLE</div><h2 id="variable-dialog-title">Add variable</h2><label class="field-label" for="variable-name">NAME</label><input id="variable-name" class="text-field" autocomplete="off" required/><label class="field-label" for="variable-value">VALUE · INCHES</label><input id="variable-value" class="text-field" autocomplete="off" required/><div id="variable-error" class="dialog-error" role="alert"></div><div class="dialog-actions"><button type="button" class="button button-quiet" id="variable-cancel">Cancel</button><button type="submit" class="button button-run" id="variable-submit">Create variable</button></div></form></dialog>
    <dialog id="delete-variable-dialog" class="variable-dialog"><form method="dialog"><div class="eyebrow">VARIABLE IN USE</div><h2>Replace references?</h2><p id="delete-variable-message" class="delete-variable-message"></p><div class="dialog-actions"><button value="cancel" class="button button-quiet">Cancel</button><button value="delete" class="button button-run">Delete and replace</button></div></form></dialog>
    <div id="face-menu" class="face-menu" role="menu" aria-label="Box actions" hidden><div class="face-menu-caption" id="face-menu-caption"></div><div class="face-menu-actions"><button id="new-from-face" class="face-menu-action" role="menuitem" type="button"><span aria-hidden="true">＋</span><span>New box from face</span></button><button id="duplicate-from-menu" class="face-menu-action" role="menuitem" type="button"><span aria-hidden="true">⧉</span><span>Duplicate</span></button></div><div class="face-menu-reason" id="face-menu-reason"></div></div>
  </main>`;

const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
const editor = $('#source-editor') as HTMLTextAreaElement;
const viewportHost = $('#viewport');
const listEl = $('#component-list');
let boxes: BoxSpec[] = [];
let variables: VariableSpec[] = [];
let selectedId: string | null = null;
let selectedVariable: string | null = null;
let selectedFace: FaceName | null = null;
let contextFace: { boxId: string; face: FaceName; clientX: number; clientY: number } | null = null;
let draftDirty = false;
let appliedSource = '';
let runEpoch = 0;
type Snapshot = { boxes: BoxSpec[]; variables: VariableSpec[]; source: string; hiddenIds: string[] };
let history: Snapshot[] = [];
let historyAt = -1;
let saveTimer = 0;
let toastTimer = 0;
let viewMode: 'iso' | 'front' | 'right' | 'top' = 'iso';
let projectionMode: 'perspective' | 'orthographic' = 'perspective';
let gridVisible = true;
let hiddenBoxIds = new Set<string>();
let offsetsOpenBoxId: string | null = null;
let offsetsOpen = false;
let faceColorPicker: Picker | null = null;
const viewport = createViewport(viewportHost, (id, face) => { selectedId = id; selectedVariable = null; selectedFace = face ?? null; renderAll(); }, (hit) => openFaceMenu(hit));

function closeFaceColorPicker() { faceColorPicker?.hide(); }
function openFaceColorPicker(trigger: HTMLElement) {
  const picker = faceColorPicker; if (!picker || draftDirty) return;
  const rect = trigger.getBoundingClientRect();
  const anchor = $('#face-color-picker-anchor');
  anchor.style.left = `${rect.left}px`;
  anchor.style.top = `${rect.top}px`;
  picker.show();
  const popup = anchor.querySelector<HTMLElement>('.picker_wrapper');
  if (!popup) return;
  const bounds = popup.getBoundingClientRect(); const margin = 8;
  anchor.style.left = `${rect.left + Math.max(margin - bounds.left, Math.min(0, innerWidth - margin - bounds.right))}px`;
  anchor.style.top = `${rect.top + Math.max(margin - bounds.top, Math.min(0, innerHeight - margin - bounds.bottom))}px`;
  popup.focus();
}

function cloneBoxes(value: BoxSpec[]) { return value.map((box) => ({ ...box, expressions: box.expressions ? { ...box.expressions } : undefined, size: [...box.size] as [number, number, number], position: [...box.position] as [number, number, number], relative: box.relative ? { ...box.relative, u: box.relative.u ? { ...box.relative.u } : undefined, v: box.relative.v ? { ...box.relative.v } : undefined } : undefined })); }
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
  $('#add-variable').toggleAttribute('disabled', draftDirty);
  $('#delete-box').toggleAttribute('disabled', draftDirty || !selectedBox());
  $('#duplicate-box').toggleAttribute('disabled', draftDirty || !selectedBox());
  renderList(); renderInspector();
}
function selectedBox() { return boxes.find((box) => box.id === selectedId) ?? null; }
type VariableDialogResult = { name: string; value: number; expression?: string } | null;
async function askVariable(name = '', title = 'Create missing variable'): Promise<VariableDialogResult> {
  const dialog = $('#variable-dialog') as HTMLDialogElement; const form = $('#variable-form') as HTMLFormElement;
  const nameInput = $('#variable-name') as HTMLInputElement; const valueInput = $('#variable-value') as HTMLInputElement;
  $('#variable-dialog-title').textContent = title; $('#variable-submit').textContent = title === 'Add variable' ? 'Add variable' : 'Create and apply';
  nameInput.value = name; nameInput.readOnly = !!name; valueInput.value = ''; $('#variable-error').textContent = '';
  const priorFocus = document.activeElement as HTMLElement | null;
  return await new Promise((resolve) => {
    const finish = (result: VariableDialogResult) => { dialog.close(); form.removeEventListener('submit', submit); $('#variable-cancel').removeEventListener('click', cancel); dialog.removeEventListener('cancel', cancelEvent); priorFocus?.focus(); resolve(result); };
    const cancel = () => finish(null); const cancelEvent = (event: Event) => { event.preventDefault(); cancel(); };
    const submit = (event: Event) => { event.preventDefault(); const variableName = nameInput.value.trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variableName)) { $('#variable-error').textContent = 'Use letters, numbers, and underscores; start with a letter or underscore.'; nameInput.focus(); return; }
      if (variables.some((item) => item.name === variableName)) { $('#variable-error').textContent = `“${variableName}” already exists.`; nameInput.focus(); return; }
      try { const value = parseInches(valueInput.value, resolverFor(variables)); finish({ name: variableName, value, expression: /\bvar\s*\(/.test(valueInput.value) ? valueInput.value : undefined }); }
      catch (error) { $('#variable-error').textContent = error instanceof Error ? error.message : 'Enter a valid inch value.'; valueInput.focus(); }
    };
    form.addEventListener('submit', submit); $('#variable-cancel').addEventListener('click', cancel); dialog.addEventListener('cancel', cancelEvent); dialog.showModal(); (nameInput.readOnly ? valueInput : nameInput).focus();
  });
}
function resolverFor(items: VariableSpec[]) { const map: Record<string, number> = Object.create(null); items.forEach((item) => { map[item.name] = item.value; }); return map; }
async function parseWithMissingVariables(text: string): Promise<{ value: number; variables: VariableSpec[] }> {
  const staged = cloneVariables(variables);
  for (let attempts = 0; attempts < 32; attempts++) {
    try { return { value: parseInches(text, resolverFor(staged)), variables: staged }; }
    catch (error) {
      const missing = error as Error & { variableName?: string };
      if (!missing.variableName) throw error;
      const created = await askVariable(missing.variableName);
      if (!created) throw new Error('Variable creation cancelled.');
      staged.push(created);
    }
  }
  throw new Error('Too many missing variables in this expression.');
}
async function changeVariableValue(name: string, text: string, isExpression: boolean, input: HTMLInputElement) {
  try {
    const parsed = await parseWithMissingVariables(text);
    const updated = parsed.variables.map((item) => item.name === name ? { ...item, value: parsed.value, expression: isExpression || /\bvar\s*\(/.test(text) ? text : undefined } : item);
    const next = resolveModelFromUI(boxes, updated);
    commitBoxes(next, 'Variable updated', { preserveView: true }, updated);
  } catch (error) { if (error instanceof Error && error.message === 'Variable creation cancelled.') { renderInspector(); return; } input.classList.add('invalid'); notify(error instanceof Error ? error.message : 'Invalid variable value', true); }
}
function resolveModelFromUI(input: BoxSpec[], vars: VariableSpec[]) { return validateBoxes(input, vars); }
function renderList() {
  $('#box-count').textContent = String(boxes.length);
  $('#tree-empty').classList.toggle('hidden', boxes.length + variables.length > 0);
  listEl.innerHTML = `${variables.map((variable) => `<button class="component-row variable-row ${variable.name === selectedVariable ? 'selected' : ''}" data-variable="${escapeAttr(variable.name)}"><span class="variable-symbol">ƒ</span><span class="row-name">${escapeHTML(variable.name)}</span><span class="row-size">${formatInches(variable.value)} in</span></button>`).join('')}${boxes.map((box) => { const hidden = hiddenBoxIds.has(box.id); return `<div class="component-row box-row ${box.id === selectedId && !selectedVariable ? 'selected' : ''} ${hidden ? 'hidden-object' : ''}"><button type="button" class="component-select" data-id="${escapeAttr(box.id)}" ${hidden ? 'disabled' : ''} aria-label="${escapeAttr(hidden ? `${box.name} is hidden` : `Select ${box.name}`)}"><span class="row-cube" style="--cube:${escapeAttr(box.color)}"></span><span class="row-name">${escapeHTML(box.name)}</span><span class="row-size">${box.size.map(formatInches).join(' × ')}</span></button><button type="button" class="visibility-toggle" data-visibility-id="${escapeAttr(box.id)}" aria-label="${escapeAttr(hidden ? `Show ${box.name}` : `Hide ${box.name}`)}" title="${escapeAttr(hidden ? `Show ${box.name}` : `Hide ${box.name}`)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z"></path><circle cx="12" cy="12" r="2.5"></circle>${hidden ? '<path d="m4 4 16 16"></path>' : ''}</svg></button></div>`; }).join('')}`;
  listEl.querySelectorAll<HTMLButtonElement>('.component-select[data-id]').forEach((row) => row.addEventListener('click', () => { if (hiddenBoxIds.has(row.dataset.id ?? '')) return; selectedId = row.dataset.id ?? null; selectedVariable = null; selectedFace = null; viewport.select(selectedId); renderAll(); }));
  listEl.querySelectorAll<HTMLButtonElement>('[data-visibility-id]').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); toggleBoxVisibility(button.dataset.visibilityId!); }));
  listEl.querySelectorAll<HTMLButtonElement>('[data-variable]').forEach((row) => row.addEventListener('click', () => { selectedVariable = row.dataset.variable ?? null; selectedId = null; selectedFace = null; viewport.select(null); renderAll(); }));
}
function faceTitle(face: FaceName) { return face[0].toUpperCase() + face.slice(1); }
const faceDirection: Record<FaceName, string> = {
  front: 'Y-', back: 'Y+', left: 'X-', right: 'X+', top: 'Z+', bottom: 'Z-',
};
function referenceFaceTitle(face: FaceName) { return `${faceTitle(face)} ${faceDirection[face]}`; }
function openFaceMenu(hit: { boxId: string; face: FaceName; clientX: number; clientY: number }) {
  contextFace = hit;
  const menu = $('#face-menu'); menu.hidden = false;
  const parent = boxes.find((box) => box.id === hit.boxId);
  $('#face-menu-caption').textContent = `${parent?.name ?? 'Box'} · ${faceTitle(hit.face)} face`;
  const duplicate = $('#duplicate-from-menu') as HTMLButtonElement;
  const newFromFace = $('#new-from-face') as HTMLButtonElement;
  duplicate.disabled = draftDirty || !parent;
  newFromFace.disabled = draftDirty || !parent;
  $('#face-menu-reason').textContent = draftDirty ? 'Run or discard the source draft to edit boxes.' : '';
  menu.style.left = `${Math.max(8, Math.min(hit.clientX, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(hit.clientY, innerHeight - menu.offsetHeight - 8))}px`;
  newFromFace.focus();
}
function closeFaceMenu() { $('#face-menu').hidden = true; contextFace = null; }
function renderInspector() {
  faceColorPicker?.hide();
  faceColorPicker?.destroy();
  faceColorPicker = null;
  const box = selectedBox();
  const host = $('#inspector-content');
  const variable = variables.find((item) => item.name === selectedVariable);
  $('#delete-box').toggleAttribute('disabled', draftDirty || (!box && !variable));
  $('#duplicate-box').toggleAttribute('disabled', draftDirty || !box);
  if (offsetsOpenBoxId !== box?.id) {
    offsetsOpenBoxId = box?.id ?? null;
    offsetsOpen = false;
  }
  if (variable) {
    const usedBy = boxes.filter((item) => Object.values(item.expressions ?? {}).some((expr) => expr.includes(`var(${variable.name})`))).length;
    host.innerHTML = `<div class="source-warning">Variables drive any numeric box dimension, position, or placement offset using <code>var(${escapeHTML(variable.name)})</code>.</div><div class="object-heading"><span class="variable-symbol large">ƒ</span><div><div class="object-name">${escapeHTML(variable.name)}</div><div class="object-id">VARIABLE · INCHES</div></div></div><label class="field-label" for="variable-inspector-value">VALUE</label><div class="measure-input variable-value-input"><input id="variable-inspector-value" value="${formatInches(variable.value)}" ${draftDirty ? 'disabled' : ''}/><small>in</small></div>${variable.expression ? `<label class="field-label expression-label" for="variable-inspector-expression">EXPRESSION</label><input id="variable-inspector-expression" class="text-field" value="${escapeAttr(variable.expression)}" ${draftDirty ? 'disabled' : ''}/>` : ''}<div class="inspector-tip">Used by ${usedBy} ${usedBy === 1 ? 'box' : 'boxes'}. Variable names stay fixed after creation.</div>`;
    host.querySelector<HTMLInputElement>('#variable-inspector-value')?.addEventListener('change', (event) => { const input = event.currentTarget as HTMLInputElement; void changeVariableValue(variable.name, input.value, false, input); });
    host.querySelector<HTMLInputElement>('#variable-inspector-expression')?.addEventListener('change', (event) => { const input = event.currentTarget as HTMLInputElement; void changeVariableValue(variable.name, input.value, true, input); });
    return;
  }
  if (!box) { host.innerHTML = '<div class="inspector-empty"><div class="empty-target">⊙</div><div>Select a box or variable</div><small>Choose an item from the model tree to inspect it.</small></div><div class="source-warning">GUI edits regenerate this source. Undo can restore earlier source.</div>'; return; }
  const boxId = box.id;
  const relative = box.relative;
  const refOptions = boxes.filter((candidate) => candidate.id !== box.id && !isDescendant(candidate.id, box.id)).map((candidate) => `<option value="${escapeAttr(candidate.id)}" ${candidate.id === relative?.boxId ? 'selected' : ''}>${escapeHTML(candidate.name)}</option>`).join('');
  const faceOptions = (value?: FaceName) => (['front', 'back', 'left', 'right', 'top', 'bottom'] as FaceName[]).map((face) => `<option value="${face}" ${face === value ? 'selected' : ''}>${referenceFaceTitle(face)}</option>`).join('');
  const sideOptions = (axis: 'u' | 'v', value?: { side: 'left' | 'right' | 'bottom' | 'top'; offset: number }) => {
    const choices = axis === 'u' ? ['left', 'right'] : ['bottom', 'top'];
    return `<option value="">None</option>${choices.map((side) => `<option value="${side}" ${value?.side === side ? 'selected' : ''}>${faceTitle(side as FaceName)}</option>`).join('')}`;
  };
  host.innerHTML = `<div class="source-warning">GUI edits regenerate this source as literal boxes. Undo can restore earlier source.</div><div class="object-heading"><span class="object-swatch" style="--cube:${escapeAttr(box.color)}"></span><div><div class="object-name">${escapeHTML(box.name)}</div><div class="object-id">BOX · ${escapeHTML(box.id.slice(0, 8).toUpperCase())}</div></div></div>
    <label class="field-label" for="box-name">NAME</label><input id="box-name" class="text-field" value="${escapeAttr(box.name)}" ${draftDirty ? 'disabled' : ''} />
    <div class="section-label"><span>SIZE</span><span>INCHES</span></div><div class="triple-fields">${['Width · X', 'Depth · Y', 'Height · Z'].map((label, i) => `<label class="measure-field"><span>${label}</span><span class="measure-input"><input data-kind="size" data-index="${i}" value="${escapeAttr(box.expressions?.[`size.${i}` as NumericField] ?? formatInches(box.size[i]))}" title="${box.expressions?.[`size.${i}` as NumericField] ? `Resolved: ${formatInches(box.size[i])} in` : ''}" inputmode="decimal" ${draftDirty ? 'disabled' : ''}/><small>in</small></span></label>`).join('')}</div>
    <div class="section-label position-label"><span>ABSOLUTE POSITION <em>MIN CORNER</em></span><span>INCHES</span></div><div class="triple-fields">${['X', 'Y', 'Z'].map((axis, i) => `<label class="measure-field"><span>${axis}</span><span class="measure-input"><input aria-label="Absolute position ${axis}" data-kind="position" data-index="${i}" value="${escapeAttr(box.expressions?.[`position.${i}` as NumericField] ?? formatInches(box.position[i]))}" title="${box.expressions?.[`position.${i}` as NumericField] ? `Resolved: ${formatInches(box.position[i])} in` : ''}" inputmode="decimal" ${draftDirty || relative ? 'disabled' : ''}/><small>in</small></span></label>`).join('')}</div>
    <section class="relative-card" aria-label="Relative placement"><div class="relative-heading"><div><div class="section-label"><span>RELATIVE PLACEMENT</span></div><div class="relative-summary">${relative ? `Linked to ${escapeHTML(boxes.find((candidate) => candidate.id === relative.boxId)?.name ?? relative.boxId)} · ${referenceFaceTitle(relative.face)}` : 'Anchor this box to another box face.'}</div></div>${relative ? '<button class="small-action" id="detach-relative" type="button">Detach</button>' : ''}</div>
      <div class="relative-grid"><label class="measure-field"><span>Reference box</span><select id="relative-reference" aria-label="Reference box" ${draftDirty || !boxes.some((candidate) => candidate.id !== box.id && !isDescendant(candidate.id, box.id)) ? 'disabled' : ''}><option value="">${boxes.length < 2 ? 'No other boxes' : 'Choose box'}</option>${refOptions}</select></label>
      <label class="measure-field"><span>Reference face</span><select id="relative-face" aria-label="Reference face" ${draftDirty || !relative ? 'disabled' : ''}>${faceOptions(relative?.face)}</select></label></div>
      <div class="relative-grid side-grid"><label class="measure-field"><span>First side · U</span><select id="relative-u-side" aria-label="First side U" ${draftDirty || !relative ? 'disabled' : ''}>${sideOptions('u', relative?.u as RelativePlacement['u'])}</select></label>
      <label class="measure-field"><span>Second side · V</span><select id="relative-v-side" aria-label="Second side V" ${draftDirty || !relative ? 'disabled' : ''}>${sideOptions('v', relative?.v as RelativePlacement['v'])}</select></label></div>
      <details class="relative-offsets" ${offsetsOpen ? 'open' : ''}><summary>Offsets</summary><div class="relative-grid"><label class="measure-field relative-distance-field"><span>Distance from face</span><span class="measure-input"><input id="relative-offset" aria-label="Distance from face in inches" value="${escapeAttr(box.expressions?.['relative.offset'] ?? formatInches(relative?.offset ?? 0))}" title="${box.expressions?.['relative.offset'] ? `Resolved: ${formatInches(relative?.offset ?? 0)} in` : ''}" inputmode="decimal" ${draftDirty || !relative ? 'disabled' : ''}/><small>in</small></span></label>
      <label class="measure-field"><span>First side · U inward offset</span><span class="measure-input"><input id="relative-u-offset" aria-label="First side U inward offset in inches" value="${escapeAttr(box.expressions?.['relative.u.offset'] ?? formatInches(relative?.u?.offset ?? 0))}" title="${box.expressions?.['relative.u.offset'] ? `Resolved: ${formatInches(relative?.u?.offset ?? 0)} in` : ''}" inputmode="decimal" ${draftDirty || !relative?.u ? 'disabled' : ''}/><small>in</small></span></label>
      <label class="measure-field"><span>Second side · V inward offset</span><span class="measure-input"><input id="relative-v-offset" aria-label="Second side V inward offset in inches" value="${escapeAttr(box.expressions?.['relative.v.offset'] ?? formatInches(relative?.v?.offset ?? 0))}" title="${box.expressions?.['relative.v.offset'] ? `Resolved: ${formatInches(relative?.v?.offset ?? 0)} in` : ''}" inputmode="decimal" ${draftDirty || !relative?.v ? 'disabled' : ''}/><small>in</small></span></label></div><div class="relative-help">Viewed from outside the face. Positive side offsets move inward.</div></details></section>
    <div class="section-label color-label"><span>FACE COLOR</span><span>${box.color.trim().toLowerCase() === TRANSPARENT_COLOR ? 'TRANSPARENT' : 'CUSTOM CODE'}</span></div><div class="color-row"><div class="swatch-grid">${COLOR_OPTIONS.map((c) => { const transparent = c === TRANSPARENT_COLOR; const chosen = box.color.trim().toLowerCase() === c; const swatchStyle = transparent ? `--cube:#1c2932;background-color:#1c2932;background-image:linear-gradient(45deg,#aab7be 25%,transparent 25%,transparent 75%,#aab7be 75%),linear-gradient(45deg,#aab7be 25%,transparent 25%,transparent 75%,#aab7be 75%);background-position:0 0,4px 4px;background-size:8px 8px;${chosen ? 'border:1px solid #f0c27e;box-shadow:none;position:relative' : ''}` : `--cube:${c}`; const check = transparent && chosen ? '<span aria-hidden="true" style="position:absolute;inset:0;display:grid;place-items:center;color:#17222b;font-size:10px;font-weight:800;line-height:1">✓</span>' : ''; return `<button class="swatch ${transparent ? 'swatch-transparent ' : ''}${chosen ? 'chosen' : ''}" data-color="${c}" style="${swatchStyle}" aria-label="${transparent ? `Transparent${chosen ? ' (selected)' : ''}` : `Color ${c}`}" aria-pressed="${chosen}" ${draftDirty ? 'disabled' : ''}>${check}</button>`; }).join('')}</div><input id="box-color" type="color" value="${escapeAttr(/^#[0-9a-f]{6}$/i.test(box.color) ? box.color : '#d9a76e')}" ${draftDirty ? 'disabled' : ''}/></div>
    <div class="inspector-tip">Enter an inch value or arithmetic (for example, (20 - 3/4)); press Enter or leave the field to apply it.</div>`;
  const nameInput = host.querySelector<HTMLInputElement>('#box-name')!;
  host.querySelector<HTMLDetailsElement>('.relative-offsets')?.addEventListener('toggle', (event) => { offsetsOpen = (event.currentTarget as HTMLDetailsElement).open; });
  nameInput.addEventListener('change', () => updateBox(box.id, { name: nameInput.value.trim() || box.name }));
  host.querySelectorAll<HTMLInputElement>('.measure-input input[data-kind]').forEach((input) => {
    const apply = async () => { try { const parsed = await parseWithMissingVariables(input.value); const kind = input.dataset.kind as 'size' | 'position'; const index = Number(input.dataset.index); const field = `${kind}.${index}` as NumericField; const expressions = { ...(box.expressions ?? {}) }; if (/\bvar\s*\(/.test(input.value)) expressions[field] = input.value; else delete expressions[field]; const next = boxes.map((item) => item.id === box.id ? { ...item, [kind]: item[kind].map((n, i) => i === index ? parsed.value : n) as [number, number, number], expressions } : item); commitBoxes(next, 'Dimension updated', { preserveView: true }, parsed.variables); } catch (err) { if (err instanceof Error && err.message === 'Variable creation cancelled.') { renderInspector(); return; } input.classList.add('invalid'); notify(err instanceof Error ? err.message : 'Invalid dimension', true); } };
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } });
    input.addEventListener('change', apply);
  });
  host.querySelectorAll<HTMLInputElement>('.measure-input input[id^="relative-"]').forEach((input) => input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } }));
  const applyRelative = (patch: Partial<RelativePlacement>) => { if (!relative) return; updateBox(box.id, { relative: { ...relative, ...patch } }); };
  host.querySelector<HTMLSelectElement>('#relative-reference')?.addEventListener('change', (event) => { const refId = (event.currentTarget as HTMLSelectElement).value; if (!refId) return; if (relative) applyRelative({ boxId: refId }); else updateBox(box.id, { relative: { boxId: refId, face: 'front', offset: 0 } }); });
  host.querySelector<HTMLSelectElement>('#relative-face')?.addEventListener('change', (event) => applyRelative({ face: (event.currentTarget as HTMLSelectElement).value as FaceName }));
  host.querySelector<HTMLInputElement>('#relative-offset')?.addEventListener('change', (event) => { void applyRelativeValue(event.currentTarget as HTMLInputElement, 'relative.offset'); });
  for (const axis of ['u', 'v'] as const) {
    host.querySelector<HTMLSelectElement>(`#relative-${axis}-side`)?.addEventListener('change', (event) => {
      if (!relative) return;
      const side = (event.currentTarget as HTMLSelectElement).value;
      const old = relative[axis];
      const next = side ? { side: side as NonNullable<RelativePlacement[typeof axis]>['side'], offset: old?.offset ?? 0 } as NonNullable<RelativePlacement[typeof axis]> : undefined;
      if (!side) { const expressions = { ...(box.expressions ?? {}) }; delete expressions[`relative.${axis}.offset` as NumericField]; updateBox(box.id, { relative: { ...relative, [axis]: undefined }, expressions }); }
      else applyRelative({ [axis]: next });
      renderInspector();
    });
    host.querySelector<HTMLInputElement>(`#relative-${axis}-offset`)?.addEventListener('change', (event) => { void applyRelativeValue(event.currentTarget as HTMLInputElement, `relative.${axis}.offset`); });
  }
  async function applyRelativeValue(input: HTMLInputElement, field: NumericField) {
    try {
      const parsed = await parseWithMissingVariables(input.value);
      const nextBox = cloneBoxes(boxes).find((item) => item.id === boxId)!;
      if (field === 'relative.offset' && nextBox.relative) nextBox.relative.offset = parsed.value;
      else if (field === 'relative.u.offset' && nextBox.relative?.u) nextBox.relative.u.offset = parsed.value;
      else if (field === 'relative.v.offset' && nextBox.relative?.v) nextBox.relative.v.offset = parsed.value;
      nextBox.expressions = { ...(nextBox.expressions ?? {}) };
      if (/\bvar\s*\(/.test(input.value)) nextBox.expressions[field] = input.value; else delete nextBox.expressions[field];
      commitBoxes(boxes.map((item) => item.id === boxId ? nextBox : item), 'Placement offset updated', { preserveView: true }, parsed.variables);
    } catch (error) { if (error instanceof Error && error.message === 'Variable creation cancelled.') { renderInspector(); return; } input.classList.add('invalid'); notify(error instanceof Error ? error.message : 'Invalid offset', true); }
  }
  host.querySelector<HTMLButtonElement>('#detach-relative')?.addEventListener('click', () => { const expressions = { ...(box.expressions ?? {}) }; delete expressions['relative.offset']; delete expressions['relative.u.offset']; delete expressions['relative.v.offset']; delete expressions['position.0']; delete expressions['position.1']; delete expressions['position.2']; updateBox(box.id, { relative: undefined, expressions }); });
  host.querySelectorAll<HTMLButtonElement>('.swatch').forEach((button) => button.addEventListener('click', () => updateBox(box.id, { color: button.dataset.color! })));
  const colorInput = host.querySelector<HTMLInputElement>('#box-color');
  if (colorInput) {
    const colorTrigger = document.createElement('button');
    colorTrigger.type = 'button'; colorTrigger.id = 'box-color'; colorTrigger.className = 'face-color-trigger'; colorTrigger.disabled = colorInput.disabled;
    colorTrigger.style.setProperty('--face-color', box.color.trim().toLowerCase() === TRANSPARENT_COLOR ? '#8795a133' : box.color); colorTrigger.setAttribute('aria-label', 'Choose a custom face color'); colorTrigger.setAttribute('aria-haspopup', 'dialog');
    colorInput.replaceWith(colorTrigger);
    faceColorPicker = new Picker({
      parent: $('#face-color-picker-anchor'), popup: 'left', alpha: true, editor: true, cancelButton: true,
      color: box.color.trim().toLowerCase() === TRANSPARENT_COLOR ? '#8795a133' : box.color,
      onDone: (color) => updateBox(box.id, { color: color.hex.toLowerCase() }),
    });
    colorTrigger.addEventListener('click', () => openFaceColorPicker(colorTrigger));
  }
}
function isDescendant(candidateId: string, ancestorId: string) { let current = boxes.find((box) => box.id === candidateId); const seen = new Set<string>(); while (current?.relative && !seen.has(current.id)) { if (current.relative.boxId === ancestorId) return true; seen.add(current.id); current = boxes.find((box) => box.id === current!.relative!.boxId); } return false; }
function renderAll() { if (selectedId && hiddenBoxIds.has(selectedId)) { selectedId = null; selectedFace = null; } renderList(); renderInspector(); viewport.select(selectedId, selectedFace ?? undefined); $('#delete-box').toggleAttribute('disabled', draftDirty || (!selectedBox() && !selectedVariable)); $('#duplicate-box').toggleAttribute('disabled', draftDirty || !selectedBox()); $('#selection-status').textContent = selectedVariable ? `VARIABLE · ${selectedVariable.toUpperCase()}` : selectedBox() ? `SELECTED · ${selectedBox()!.name.toUpperCase()}${selectedFace ? ` · ${faceTitle(selectedFace).toUpperCase()} FACE` : ''}` : 'NO SELECTION'; }
function escapeHTML(s: string) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }
function escapeAttr(s: string) { return escapeHTML(s); }
function scheduleSave() {
  $('#save-state').textContent = 'Saving…'; window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ boxes, variables, source: editor.value, appliedSource, draftDirty, viewMode, projectionMode, gridVisible, hiddenBoxIds: [...hiddenBoxIds] })); $('#save-state').textContent = 'Saved locally'; } catch { $('#save-state').textContent = 'Local only'; } }, 350);
}
function cloneVariables(value: VariableSpec[]) { return value.map((item) => ({ ...item })); }
function recordAfterChange() { history = history.slice(0, historyAt + 1); history.push({ boxes: cloneBoxes(boxes), variables: cloneVariables(variables), source: editor.value, hiddenIds: [...hiddenBoxIds] }); historyAt = history.length - 1; if (history.length > 80) { history.shift(); historyAt--; } }
function commitBoxes(next: BoxSpec[], message: string, options?: { preserveView?: boolean }, nextVariables = variables) {
  const resolved = resolveModel(next, nextVariables);
  const source = generateSource(resolved.boxes, resolved.variables);
  boxes = cloneBoxes(resolved.boxes); variables = cloneVariables(resolved.variables); hiddenBoxIds = new Set([...hiddenBoxIds].filter((id) => boxes.some((box) => box.id === id))); selectedId = boxes.some((b) => b.id === selectedId) && !hiddenBoxIds.has(selectedId!) ? selectedId : null;
  if (!selectedId) selectedFace = null;
  viewport.setBoxes(boxes, { ...options, hiddenIds: hiddenBoxIds }); setEditor(source); appliedSource = editor.value; recordAfterChange(); renderAll(); setStatus(message); scheduleSave();
}
function toggleBoxVisibility(id: string) {
  if (draftDirty || !boxes.some((box) => box.id === id)) return;
  const hidden = hiddenBoxIds.has(id);
  if (hidden) hiddenBoxIds.delete(id); else hiddenBoxIds.add(id);
  if (hidden && selectedId === id) { selectedId = null; selectedFace = null; }
  viewport.setVisibility(id, hidden);
  recordAfterChange(); renderAll(); setStatus(hidden ? 'Box shown' : 'Box hidden'); scheduleSave();
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
  const box: BoxSpec = base ? { ...base, expressions: base.expressions ? { ...base.expressions } : undefined, relative: base.relative ? { ...base.relative, u: base.relative.u ? { ...base.relative.u } : undefined, v: base.relative.v ? { ...base.relative.v } : undefined } : undefined, id: crypto.randomUUID(), name: `${base.name} copy`, position: [base.position[0] + 1, base.position[1] + 1, base.position[2]] } : { id: crypto.randomUUID(), name: `Box ${boxes.length + 1}`, size: [2, 2, 2], position: [0, 0, 0], color: PALETTE[boxes.length % PALETTE.length] };
  try { commitBoxes([...boxes, box], base ? 'Box duplicated' : 'Box added'); selectedId = box.id; selectedVariable = null; renderAll(); }
  catch (err) { notify(err instanceof Error ? err.message : 'Could not add box', true); }
}
function deleteBox() {
  if (draftDirty) return;
  if (selectedVariable) { deleteVariable(selectedVariable); return; }
  if (!selectedBox()) return;
  const deletedId = selectedId!;
  try { const detached = boxes.filter((b) => b.relative?.boxId === deletedId).map((b) => b.id); const next = boxes.filter((b) => b.id !== deletedId).map((b) => { if (!detached.includes(b.id)) return b; const expressions = { ...(b.expressions ?? {}) }; delete expressions['relative.offset']; delete expressions['relative.u.offset']; delete expressions['relative.v.offset']; delete expressions['position.0']; delete expressions['position.1']; delete expressions['position.2']; return { ...b, relative: undefined, expressions }; }); commitBoxes(next, detached.length ? 'Box deleted · dependent boxes detached at their current positions' : 'Box deleted', { preserveView: true }); }
  catch (err) { notify(err instanceof Error ? err.message : 'Could not delete box', true); }
}
async function addVariable() {
  if (draftDirty) return;
  const item = await askVariable('', 'Add variable'); if (!item) return;
  try { commitBoxes(boxes, 'Variable added', { preserveView: true }, [...variables, item]); selectedVariable = item.name; selectedId = null; renderAll(); }
  catch (error) { notify(error instanceof Error ? error.message : 'Could not add variable', true); }
}
function deleteVariable(name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const refPattern = new RegExp(`\\bvar\\s*\\(\\s*${escaped}\\s*\\)`);
  const boxRefs = boxes.filter((box) => Object.values(box.expressions ?? {}).some((expr) => refPattern.test(expr)));
  const variableRefs = variables.filter((item) => item.name !== name && item.expression && refPattern.test(item.expression));
  const item = variables.find((entry) => entry.name === name); if (!item) return;
  if (boxRefs.length || variableRefs.length) {
    const dialog = $('#delete-variable-dialog') as HTMLDialogElement;
    const refs = [...boxRefs.map((box) => box.name), ...variableRefs.map((entry) => `Variable ${entry.name}`)];
    $('#delete-variable-message').innerHTML = `<b>${escapeHTML(name)}</b> is used by ${refs.map(escapeHTML).join(', ')}. Deleting it replaces those references with <b>${formatInches(item.value)} in</b>, preserving the current geometry.`;
    if (!dialog.open) dialog.showModal();
    const proceed = awaitDialogResult(dialog);
    void proceed.then((confirmed) => { if (confirmed) replaceAndDeleteVariable(name); });
    return;
  }
  replaceAndDeleteVariable(name);
}
function awaitDialogResult(dialog: HTMLDialogElement): Promise<boolean> {
  return new Promise((resolve) => { const done = () => { dialog.removeEventListener('close', done); resolve(dialog.returnValue === 'delete'); }; dialog.addEventListener('close', done, { once: true }); });
}
function replaceAndDeleteVariable(name: string) {
  try {
    const next = removeVariable(boxes, variables, name);
    commitBoxes(next.boxes, 'Variable deleted · references replaced', { preserveView: true }, next.variables); selectedVariable = null; renderAll();
  }
  catch (error) { notify(error instanceof Error ? error.message : 'Could not delete variable', true); }
}
function createFromFace() {
  const hit = contextFace; closeFaceMenu();
  if (draftDirty || !hit) return;
  const parent = boxes.find((box) => box.id === hit.boxId); if (!parent) return;
  try {
    const child = createBoxFromFace(parent, hit.face, crypto.randomUUID());
    child.name = `${parent.name} ${faceTitle(hit.face)} box`;
    child.color = PALETTE[boxes.length % PALETTE.length];
    commitBoxes([...boxes, child], 'Box created from face', { preserveView: true }); selectedId = child.id; selectedVariable = null; selectedFace = null; renderAll();
  } catch (err) { notify(err instanceof Error ? err.message : 'Could not create box from face', true); }
}
function duplicateFromMenu() {
  const hit = contextFace;
  closeFaceMenu();
  if (draftDirty || !hit) return;
  selectedId = hit.boxId;
  selectedVariable = null;
  selectedFace = null;
  addBox(true);
}
async function runSource() {
  const epoch = ++runEpoch; const source = editor.value; $('#run-code').toggleAttribute('disabled', true); $('#editor-error').toggleAttribute('hidden', true); setStatus('Compiling…');
  try {
    const compiled = await compileModel(source);
    if (epoch !== runEpoch) return;
    boxes = cloneBoxes(validateBoxes(compiled.boxes, compiled.variables)); variables = cloneVariables(compiled.variables); hiddenBoxIds = new Set([...hiddenBoxIds].filter((id) => boxes.some((box) => box.id === id))); selectedId = null; selectedVariable = null; selectedFace = null; viewport.setBoxes(boxes, { hiddenIds: hiddenBoxIds }); viewport.fit();
    appliedSource = source; history = history.slice(0, historyAt + 1); history.push({ boxes: cloneBoxes(boxes), variables: cloneVariables(variables), source, hiddenIds: [...hiddenBoxIds] }); historyAt = history.length - 1; if (history.length > 80) { history.shift(); historyAt--; }
    if (editor.value === source) setEditor(source); else { draftDirty = true; syncDraftUI(); }
    renderAll(); setStatus(editor.value === source ? `Updated · ${boxes.length} ${boxes.length === 1 ? 'box' : 'boxes'} · ${variables.length} variables` : 'Model updated · newer source draft retained'); scheduleSave();
  } catch (err) {
    if (epoch !== runEpoch) return;
    const message = err instanceof Error ? err.message : 'Could not compile model'; const errorEl = $('#editor-error'); errorEl.textContent = message; errorEl.hidden = false; setStatus('Source has errors · last good model kept', true); notify('Model unchanged. Fix the source error and run again.', true);
  } finally { if (epoch === runEpoch) $('#run-code').toggleAttribute('disabled', false); }
}
function undoRedo(delta: number) {
  if (draftDirty) return notify('Run or discard the source draft before undoing.', true);
  const next = historyAt + delta; if (next < 0 || next >= history.length) return;
  historyAt = next; variables = cloneVariables(history[historyAt].variables ?? []); boxes = cloneBoxes(validateBoxes(history[historyAt].boxes, variables)); hiddenBoxIds = new Set((history[historyAt].hiddenIds ?? []).filter((id) => boxes.some((box) => box.id === id))); appliedSource = history[historyAt].source; selectedId = null; selectedVariable = null; selectedFace = null; viewport.setBoxes(boxes, { preserveView: true, hiddenIds: hiddenBoxIds }); setEditor(history[historyAt].source); renderAll(); setStatus(delta < 0 ? 'Undo' : 'Redo'); scheduleSave();
}

$('#add-box').addEventListener('click', () => addBox());
$('#add-variable').addEventListener('click', () => void addVariable());
$('#delete-box').addEventListener('click', deleteBox);
$('#duplicate-box').addEventListener('click', () => addBox(true));
$('#duplicate-from-menu').addEventListener('click', duplicateFromMenu);
$('#new-from-face').addEventListener('click', createFromFace);
document.addEventListener('pointerdown', (event) => {
  const target = event.target as Node;
  if (!$('#face-menu').hidden && !$('#face-menu').contains(target)) closeFaceMenu();
});
window.addEventListener('resize', () => { closeFaceMenu(); closeFaceColorPicker(); });
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
  if (($('#variable-dialog') as HTMLDialogElement).open || ($('#delete-variable-dialog') as HTMLDialogElement).open) return;
  const target = event.target as HTMLElement; const textEditing = target instanceof HTMLTextAreaElement || target.isContentEditable; const editing = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || textEditing;
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void runSource(); }
  else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !editing) { event.preventDefault(); undoRedo(event.shiftKey ? 1 : -1); }
  else if (!editing && event.key.toLowerCase() === 'f') viewport.fit();
  else if (!editing && ['1', '3', '7'].includes(event.key)) { const view = ({ '1': 'front', '3': 'right', '7': 'top' } as const)[event.key as '1' | '3' | '7']; viewMode = view; viewport.setView(view); root.querySelector(`[data-view="${view}"]`)?.classList.add('active'); root.querySelectorAll(`[data-view]:not([data-view="${view}"])`).forEach((b) => b.classList.remove('active')); }
  else if (!editing && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); deleteBox(); }
});

function restoreLocal() {
  try { const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return false; const data = JSON.parse(raw) as { boxes?: BoxSpec[]; variables?: VariableSpec[]; source?: string; appliedSource?: string; draftDirty?: boolean; viewMode?: typeof viewMode; projectionMode?: typeof projectionMode; gridVisible?: boolean; hiddenBoxIds?: string[] };
    if (typeof data.source !== 'string' || !Array.isArray(data.boxes)) return false; variables = Array.isArray(data.variables) ? cloneVariables(data.variables) : []; boxes = cloneBoxes(validateBoxes(data.boxes, variables)); hiddenBoxIds = new Set((Array.isArray(data.hiddenBoxIds) ? data.hiddenBoxIds : []).filter((id) => boxes.some((box) => box.id === id))); selectedId = null; selectedVariable = null; selectedFace = null; setEditor(data.source, data.draftDirty === true); appliedSource = typeof data.appliedSource === 'string' ? data.appliedSource : (data.draftDirty ? generateSource(boxes, variables) : data.source); viewport.setBoxes(boxes, { hiddenIds: hiddenBoxIds }); history = [{ boxes: cloneBoxes(boxes), variables: cloneVariables(variables), source: appliedSource, hiddenIds: [...hiddenBoxIds] }]; historyAt = 0;
    if (data.viewMode) { viewMode = data.viewMode; viewport.setView(viewMode); root.querySelector(`[data-view="${viewMode}"]`)?.classList.add('active'); root.querySelectorAll(`[data-view]:not([data-view="${viewMode}"])`).forEach((b) => b.classList.remove('active')); }
    if (data.projectionMode) { projectionMode = data.projectionMode; viewport.setProjection(projectionMode); $('#projection').textContent = projectionMode.toUpperCase(); }
    if (typeof data.gridVisible === 'boolean') { gridVisible = data.gridVisible; viewport.setGrid(gridVisible); $('#grid-toggle').classList.toggle('active', gridVisible); }
    $('#project-name').textContent = 'Recovered local model'; $('#save-state').textContent = 'Recovered'; return true;
  } catch { return false; }
}
if (!restoreLocal()) { setEditor(DEFAULT_SOURCE, true); $('#project-name').textContent = 'Workbench example'; void runSource(); }
renderAll();
window.addEventListener('beforeunload', () => viewport.dispose());
