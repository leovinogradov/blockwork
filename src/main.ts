import './style.css';
import Picker from 'vanilla-picker';
import { Box, Circle, Cylinder, createIcons, Eye, EyeOff, FolderOpen, Group, MousePointer2, RectangleHorizontal, Ruler, Slash, Square } from 'lucide';
import { groupDescendants, groupOffset, reparentPosition, validateGroups, worldPosition, type GroupSpec, type Vector3 } from './groups';
import { normalizeTreeOrder, planTreeMove, type TreeDrop } from './component-tree';
import { duplicateGroupBranch, effectiveHiddenIds } from './group-actions';
import { bindComponentTreeDrag } from './component-tree-drag';
import { bindPanelResize } from './panel-resize';
import { compileModel, type CompiledSketch } from './compiler';
import { DEFAULT_SOURCE } from './example';
import { createBoxFromFace, createCylinderFromFace, cylinderAxes, cylinderAxisOrder, cylinderSize, reorientCylinder, formatInches, generateSource, getFaceFrame, parseInches, removeVariable, reparentBox, resolveModel, validateBoxes, type BoxSpec, type CylinderAxis, type FaceName, type RelativePlacement, type VariableSpec, type NumericField } from './model';
import { createViewport, type SketchTool } from './viewport';
import { updateSketchSelection, type SelectionAction } from './sketch-selection';
import { createBlankDocument, createDocument, resolveSnapshot, type DocumentKind, type ModelDocument, type Snapshot } from './documents';
import { circleFromCenter, generateSketchSource, lineDisplacement, lineFromPoints, lineMeasurements, parseLineAngle, rectangleFromCorners, validateSketchShapes, type SketchShape } from './sketch';
import { sketchReference, sketchReferenceOrigin, type ModelSketch, type SketchAxis } from './model-sketch';
import { findSketchEditor, linkSketchEditor, openSketchEditor, resolveLinkedSketches, synchronizeSketchReferences } from './sketch-editor';
import { DEFAULT_MEASUREMENT_OFFSET, defaultMeasurementLineHeight, pruneMeasurements, resolveMeasurement, validateMeasurements, type Measurement, type MeasurementAxis, type MeasurementAxisChoice } from './measurements';
import { saveDocumentFile, type SaveFilePicker } from './save-document';
import { openDocumentFile } from './open-document';
import { FileLibrary, exportLibrary, restoreLibrary, migrateWorkspace, importCollision, siblingNames, validateLibrary, type Folder, type LibraryState } from './file-library';
import { IndexedDBStorage } from './indexeddb-storage';
import { createFileManager } from './file-manager-ui';
import { fileName, uniqueFileName } from './file-names';

const STORAGE_KEY = 'blockwork.workspace.v2';
const LEGACY_STORAGE_KEY = 'blockwork.project.v1';
const TRANSPARENT_COLOR = 'transparent';
const PALETTE = ['#d9a76e', '#86a9a3', '#bd8c79', '#8798b5', '#b5a477', '#a68fb3'];
const SKETCH_DEFAULT_COLOR = '#ffffff';
const SKETCH_COLOR_OPTIONS = [SKETCH_DEFAULT_COLOR, ...PALETTE];
const COLOR_OPTIONS = [...PALETTE, TRANSPARENT_COLOR];
const root = document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML = `
  <main class="app-shell">
    <header class="topbar">
      <div class="brand-lockup"><div class="brand-mark"><span></span><span></span><span></span></div><div class="brand-name">blockwork <small>WORKSHOP</small></div></div>
      <div class="header-documents">
        <nav id="document-tabs" class="document-tabs" aria-label="Open files"></nav>
        <button class="new-tab" id="new-tab" type="button" title="New file (Ctrl/Cmd+N)" aria-label="New file">＋</button>
      </div>
      <div class="top-actions">
        <span class="saved-state" id="save-state">Local</span>
        <button class="icon-button" id="undo" title="Undo (Ctrl/Cmd+Z)" aria-label="Undo">↶</button>
        <button class="icon-button" id="redo" title="Redo (Ctrl/Cmd+Shift+Z)" aria-label="Redo">↷</button>
        <span class="top-divider"></span>
        <button class="button button-quiet" id="files">Files</button><button class="button button-quiet" id="open-file">Import .js</button>
        <button class="button button-quiet" id="download" title="Export .js (Ctrl/Cmd+S)">Export .js</button>
        <button class="button button-quiet" id="export-glb" type="button" title="Export applied visible boxes and cylinders for Blender">Export .glb</button>
        <input id="backup-input" type="file" accept=".json,application/json" hidden /><input id="file-input" type="file" accept=".js,.mjs,.txt,text/javascript" multiple hidden />
      </div>
    </header>
    <div id="empty-workspace" class="empty-workspace" hidden>No file is open. Choose <b>Files</b> to reopen a saved file, or <b>＋</b> to create one.</div>
    <div class="workspace">
      <aside id="tools-panel" class="sidebar panel">
        <section class="sketch-tools-section" aria-labelledby="sketch-tools-title">
          <h2 id="sketch-tools-title" class="eyebrow">DRAWING TOOLS</h2>
          <div class="sketch-tool-group" role="group" aria-label="Sketch tools">
            <button id="select-sketch-tool" class="sketch-tool-button active" type="button" aria-pressed="true" title="Select sketch shapes (Escape)"><i data-lucide="mouse-pointer-2" aria-hidden="true"></i><span>Select</span><kbd>Esc</kbd></button>
            <button id="rectangle-sketch-tool" class="sketch-tool-button" type="button" aria-pressed="false" title="Draw rectangle (R)"><i data-lucide="rectangle-horizontal" aria-hidden="true"></i><span>Rectangle</span><kbd>R</kbd></button>
            <button id="line-sketch-tool" class="sketch-tool-button" type="button" aria-pressed="false" title="Draw line (L)"><i data-lucide="slash" aria-hidden="true"></i><span>Line</span><kbd>L</kbd></button>
            <button id="circle-sketch-tool" class="sketch-tool-button" type="button" aria-pressed="false" title="Draw circle (C)"><i data-lucide="circle" aria-hidden="true"></i><span>Circle</span><kbd>C</kbd></button>
            <button data-measure-tool class="sketch-tool-button" type="button" aria-pressed="false" title="Measure between corners, edges or centers (M)"><i data-lucide="ruler" aria-hidden="true"></i><span>Measurement</span><kbd>M</kbd></button>
          </div>
        </section>
        <section class="model-tools-section" aria-labelledby="model-tools-title">
          <h2 id="model-tools-title" class="eyebrow">TOOLS</h2>
          <div class="tree-actions model-tool-actions" role="group" aria-label="Model tools">
            <button id="add-group" class="add-variable" title="Create group" aria-label="Create group"><i data-lucide="group" aria-hidden="true"></i></button>
            <button id="add-variable" class="add-variable" title="Add variable" aria-label="Add variable">ƒ</button>
            <button id="add-model-sketch" class="add-variable" title="Add sketch" aria-label="Add sketch"><i data-lucide="square" aria-hidden="true"></i></button>
            <button id="add-cylinder" class="add-variable" title="Add cylinder" aria-label="Add cylinder"><i data-lucide="cylinder" aria-hidden="true"></i></button>
            <button data-measure-tool class="add-variable" type="button" aria-pressed="false" title="Measure between corners, edges or centers (M)" aria-label="Measurement"><i data-lucide="ruler" aria-hidden="true"></i></button>
            <button id="add-box" class="add-button" title="Add box" aria-label="Add box">＋</button>
          </div>
        </section>
        <section id="measurement-axis-tool" class="measurement-axis-tool hidden"><label class="field-label" for="new-measurement-axis">LABEL FACING AXIS</label><select id="new-measurement-axis" class="text-field" aria-label="New measurement facing axis"><option value="auto">Auto · from view</option><option value="x">X</option><option value="y">Y</option><option value="z">Z · Up</option></select></section>
        <div class="panel-heading"><div><div class="eyebrow">MODEL TREE</div><div class="heading-title">Components <span class="count-pill" id="box-count">0</span></div></div><button id="add-sketch-group" class="add-variable" title="Create group" aria-label="Create group"><i data-lucide="group" aria-hidden="true"></i></button></div>
        <div class="tree-caption"><span>OBJECT</span><span>SIZE · IN</span></div>
        <div id="component-list" class="component-list"></div>
        <div class="tree-empty" id="tree-empty"><div class="empty-cube"><i data-lucide="box" aria-hidden="true"></i></div><div>No components yet</div><small>Add a box or run some model code.</small></div>
        <div class="tree-footer"><span class="key-chip">⌘</span><span>Boxes and sketches build your model.</span></div>
      </aside>
      <div class="panel-resizer sidebar-resizer" data-resize-panel="sidebar" role="separator" tabindex="0" aria-label="Resize tools and component tree" aria-orientation="vertical" aria-controls="tools-panel" title="Drag to resize · Arrow keys to adjust · Double-click to reset"></div>
      <section class="stage panel">
        <div class="stage-toolbar">
          <div class="view-group" aria-label="Standard views">
            <button data-view="iso" class="view-button active" title="Isometric view">ISO</button>
            <button data-view="front" class="view-button" title="Front view (1)">FRONT <kbd>1</kbd></button>
            <button data-view="right" class="view-button" title="Right view (3)">RIGHT <kbd>3</kbd></button>
            <button data-view="top" class="view-button" title="Top view (7)">TOP <kbd>7</kbd></button>
          </div>
          <div class="stage-actions">
            <button id="measurement-through-toggle" class="tool-button active" type="button" aria-pressed="true" title="Toggle measurements through objects" aria-label="Show measurements through objects"><i data-lucide="ruler" aria-hidden="true"></i> THROUGH</button>
            <button id="projection" class="tool-button" title="Toggle perspective / orthographic">PERSPECTIVE</button>
            <button id="grid-toggle" class="tool-button active" title="Toggle grid">▦ <span>GRID</span></button>
            <button id="fit" class="tool-button" title="Fit model (F)">FIT <kbd>F</kbd></button>
          </div>
        </div>
        <div class="navigation-help"><span>LEFT DRAG</span> multi-select <i>·</i> <span>SHIFT</span> add <i>·</i> <span title="Two-finger touchpad drag rotates when configured to send the middle mouse button; secondary clicks pan.">MIDDLE / TWO-FINGER DRAG</span> rotate <i>·</i> <span>RIGHT DRAG / SHIFT + MIDDLE</span> pan <i>·</i> wheel zoom</div><div id="viewport" class="viewport" tabindex="0" aria-label="3D model viewport"></div>
        <div class="stage-footer"><span class="status-indicator"></span><span id="status-text">Ready</span><span class="footer-spacer"></span><span>INCHES</span><span class="footer-separator">/</span><span>SNAP 1/64</span><span class="footer-separator">/</span><span id="selection-status">NO SELECTION</span></div>
      </section>
      <div class="panel-resizer inspector-resizer" data-resize-panel="inspector" role="separator" tabindex="0" aria-label="Resize inspector" aria-orientation="vertical" aria-controls="inspector-panel" title="Drag to resize · Arrow keys to adjust · Double-click to reset"></div>
      <aside id="inspector-panel" class="inspector panel">
        <div class="panel-heading inspector-heading"><div><div class="eyebrow">PROPERTIES</div><div class="heading-title">Inspector</div></div><div class="inspector-buttons"><button id="duplicate-box" class="icon-button" title="Duplicate selected" aria-label="Duplicate selected">⧉</button><button id="delete-box" class="icon-button danger-button" title="Delete selected (Delete)" aria-label="Delete selected">⌫</button></div></div>
        <div id="inspector-content" class="inspector-content"><div class="inspector-empty"><div class="empty-target">⊙</div><div>Select a box</div><small>Choose a component from the tree or viewport to inspect its dimensions.</small></div></div>
        <div class="inspector-foot"><span class="snap-icon">⌁</span><span>Values snap to <b>1/64 in</b></span></div>
      </aside>
      <section class="code-panel panel">
        <div class="code-header">
          <div class="code-title"><div class="eyebrow">SOURCE</div><div class="heading-title"><span class="code-dot">●</span> <button id="source-name" class="source-name-button" type="button" title="Rename file">model</button> <span class="code-mode">JAVASCRIPT</span></div></div>
          <div class="code-header-note" id="draft-note">Edit the code, then run it to update the model.</div>
          <div class="code-actions"><button class="button button-quiet button-small" id="reset-code">Reset example</button><button class="button button-run" id="run-code"><span>▶</span> Run <kbd>⌘↵</kbd></button></div>
        </div>
        <div class="editor-wrap"><div class="line-numbers" id="line-numbers">1</div><textarea id="source-editor" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="JavaScript model source"></textarea><div id="editor-error" class="editor-error" hidden></div></div>
      </section>
    </div>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
    <div id="face-color-picker-anchor" class="face-color-picker-anchor"></div>
    <dialog id="document-kind-dialog" class="variable-dialog document-kind-dialog" aria-labelledby="document-kind-title">
      <form method="dialog">
        <div class="eyebrow">FILES</div>
        <h2 id="document-kind-title">Open or create a file</h2>
        <section id="document-open-group" class="document-open-group" aria-label="Open file" hidden>
          <button id="open-existing-file" type="button" class="document-kind-option"><strong><i data-lucide="folder-open" aria-hidden="true"></i>Open existing file</strong><span>Choose one or more files from your computer.</span></button>
        </section>
        <section class="document-create-group" aria-label="File type">
          <div class="document-kind-options">
            <button type="submit" value="model" class="document-kind-option"><strong><i data-lucide="box" aria-hidden="true"></i><span id="document-model-label">New 3D model</span></strong><span>Build with boxes and cylinders in three dimensions.</span></button>
            <button type="submit" value="sketch" class="document-kind-option"><strong><i data-lucide="square" aria-hidden="true"></i><span id="document-sketch-label">New 2D sketch</span></strong><span>Draw lines, rectangles and circles on a flat plane.</span></button>
          </div>
        </section>
        <div class="dialog-actions"><button type="submit" value="cancel" class="button button-quiet">Cancel</button></div>
      </form>
    </dialog>
    <dialog id="cylinder-dialog" class="variable-dialog" aria-labelledby="cylinder-dialog-title"><form id="cylinder-form"><div class="eyebrow">3D COMPONENT</div><h2 id="cylinder-dialog-title">Add cylinder</h2><label class="field-label" for="cylinder-radius">RADIUS · INCHES</label><input id="cylinder-radius" class="text-field" inputmode="decimal" autocomplete="off" required/><label class="field-label expression-label" for="cylinder-length">LENGTH · INCHES</label><input id="cylinder-length" class="text-field" inputmode="decimal" autocomplete="off" required/><label class="field-label expression-label" for="cylinder-axis">LENGTH AXIS</label><select id="cylinder-axis" class="text-field"><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select><div id="cylinder-error" class="dialog-error" role="alert"></div><div class="dialog-actions"><button type="button" class="button button-quiet" id="cylinder-cancel">Cancel</button><button type="submit" class="button button-run">Add cylinder</button></div></form></dialog>
    <dialog id="variable-dialog" class="variable-dialog"><form id="variable-form"><div class="eyebrow">MODEL VARIABLE</div><h2 id="variable-dialog-title">Add variable</h2><label class="field-label" for="variable-name">NAME</label><input id="variable-name" class="text-field" autocomplete="off" required/><label class="field-label" for="variable-value">VALUE · INCHES</label><input id="variable-value" class="text-field" autocomplete="off" required/><label class="field-label" for="variable-description">DESCRIPTION · OPTIONAL</label><textarea id="variable-description" class="text-field variable-description" rows="3"></textarea><div id="variable-error" class="dialog-error" role="alert"></div><div class="dialog-actions"><button type="button" class="button button-quiet" id="variable-cancel">Cancel</button><button type="submit" class="button button-run" id="variable-submit">Create variable</button></div></form></dialog>
    <dialog id="delete-variable-dialog" class="variable-dialog"><form method="dialog"><div class="eyebrow">VARIABLE IN USE</div><h2>Replace references?</h2><p id="delete-variable-message" class="delete-variable-message"></p><div class="dialog-actions"><button value="cancel" class="button button-quiet">Cancel</button><button value="delete" class="button button-run">Delete and replace</button></div></form></dialog>
    <dialog id="close-document-dialog" class="variable-dialog close-document-dialog" aria-labelledby="close-document-title" aria-describedby="close-document-message"><form method="dialog"><div class="eyebrow">CLOSE FILE</div><h2 id="close-document-title">Close <span id="close-document-name"></span>?</h2><p id="close-document-message">Closing keeps this file and its current draft in your browser library. Export and close also saves a .js copy to your computer.</p><p id="close-document-draft" class="close-document-draft" hidden>This tab has an unrun source draft. The draft is kept in your browser library.</p><div class="dialog-actions close-document-actions"><button id="close-document-cancel" value="cancel" class="button button-quiet">Cancel</button><button id="close-document-save" type="button" class="button button-run">Export and close</button><button value="close" class="button button-danger">Close tab</button></div></form></dialog>
    <div id="face-menu" class="face-menu" role="menu" aria-label="Component face actions" hidden><div class="face-menu-caption" id="face-menu-caption"></div><div class="face-menu-actions"><button id="new-from-face" class="face-menu-action" role="menuitem" type="button"><span aria-hidden="true">＋</span><span>New box from face</span></button><button id="new-cylinder-from-face" class="face-menu-action" role="menuitem" type="button"><span aria-hidden="true">＋</span><span>New cylinder from face</span></button><button id="duplicate-from-menu" class="face-menu-action" role="menuitem" type="button"><span aria-hidden="true">⧉</span><span>Duplicate</span></button></div><div class="face-menu-reason" id="face-menu-reason"></div></div>
    <div id="group-member-menu" class="face-menu" role="menu" aria-label="Group member actions" hidden><div class="face-menu-caption" id="group-member-menu-caption"></div><div class="face-menu-actions"><button id="remove-group-member" class="face-menu-action" role="menuitem" type="button">Remove from group</button></div><div class="face-menu-reason">Removes this item from all groups and keeps it in place.</div></div>
  </main>`;

const lucideIcons = { Box, Circle, Cylinder, FolderOpen, Group, Square, Eye, EyeOff, MousePointer2, RectangleHorizontal, Ruler, Slash };
function renderIcons(scope: HTMLElement) { createIcons({ icons: lucideIcons, root: scope }); }
renderIcons(root);

const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
bindPanelResize($('.workspace'));
const editor = $('#source-editor') as HTMLTextAreaElement;
const viewportHost = $('#viewport');
const listEl = $('#component-list');
let groups: GroupSpec[] = [];
let collapsedGroupIds = new Set<string>();
let treeOrder: string[] = [];
let treeDragCleanup = () => {};
let boxes: BoxSpec[] = [];
let rectangles: SketchShape[] = [];
let sketches: ModelSketch[] = [];
let measurements: Measurement[] = [];
let measuring = false;
let measurementsThroughObjects = true;
let measurementAxis: MeasurementAxisChoice = 'auto';
let measurementAxisMode = false;
let documentKind: DocumentKind = 'model';
let sketchTool: SketchTool = 'select';
let variables: VariableSpec[] = [];
let selectedId: string | null = null;
let selectedComponentIds = new Set<string>();
let selectedVariable: string | null = null;
let selectedFace: FaceName | null = null;
let cylinderFacePlacement: { boxId: string; face: FaceName } | null = null;
let contextFace: { boxId: string; face: FaceName; clientX: number; clientY: number } | null = null;
let contextGroupMemberId: string | null = null;
let draftDirty = false;
let exportingGlb = false;
let appliedSource = '';
let runEpoch = 0;
let documents: ModelDocument[] = [];
let openDocumentIds: string[] = [];
let folders: Folder[] = [];
let library: FileLibrary | null = null;
let storageReady = false;
let persistenceGeneration = 0;
let importParentId: string | null = null;
const emptyDocument = createBlankDocument([]);
let activeDocumentId = '';
let pendingCloseDocumentId: string | null = null;
let history: Snapshot[] = [];
let historyAt = -1;
let saveTimer = 0;
let toastTimer = 0;
let viewMode: 'iso' | 'front' | 'right' | 'top' = 'iso';
let projectionMode: 'perspective' | 'orthographic' = 'perspective';
let gridVisible = true;
let hiddenBoxIds = new Set<string>();
let relativeOpenBoxId: string | null = null;
let relativeOpen = true;
let faceColorPicker: Picker | null = null;
const viewport = createViewport(
  viewportHost,
  (id, face) => { if (documentKind === 'sketch' && !measurements.some((measurement) => measurement.id === id)) { selectSketchShapes(id ? [id] : [], 'replace'); return; } selectedId = id; selectedComponentIds.clear(); selectedVariable = null; selectedFace = face ?? null; renderAll(); },
  (hit) => openFaceMenu(hit),
  (first, opposite, tool) => {
    if (documentKind !== 'sketch' || draftDirty) return;
    try {
      const name = `${tool === 'circle' ? 'Circle' : tool === 'line' ? 'Line' : 'Rectangle'} ${rectangles.length + 1}`;
      const id = crypto.randomUUID();
      const rectangle = tool === 'circle'
        ? circleFromCenter(first, Math.hypot(opposite[0] - first[0], opposite[1] - first[1]), id, name, SKETCH_DEFAULT_COLOR)
        : (tool === 'line' ? lineFromPoints : rectangleFromCorners)(first, opposite, id, name, SKETCH_DEFAULT_COLOR);
      const targetGroup = selectedGroup();
      if (targetGroup) { rectangle.position = reparentPosition(rectangle.position, groups, undefined, targetGroup.id).slice(0, 2) as [number, number]; rectangle.groupId = targetGroup.id; }
      commitRectangles([...rectangles, rectangle], `${tool === 'circle' ? 'Circle' : tool === 'line' ? 'Line' : 'Rectangle'} drawn · click to draw another`, { preserveView: true });
      selectSketchShapes([rectangle.id], 'replace');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not draw sketch shape', true); }
  },
  (stage) => {
    if (documentKind !== 'sketch' || draftDirty) return;
    if (stage === 'first') setStatus(sketchTool === 'circle' ? 'Circle tool · click the center' : sketchTool === 'line' ? 'Line tool · click the start point' : 'Rectangle tool · click the first corner');
    else if (stage === 'opposite') setStatus(sketchTool === 'circle' ? 'Move to set radius · click to draw, or Tab for an exact radius · Enter to draw' : sketchTool === 'line' ? 'Click end point · Tab: length, angle, ΔX, ΔY · Enter to draw' : 'Click the opposite corner, or press Tab for width, then height');
    else { sketchTool = 'select'; renderSketchToolUI(); setStatus('Select shapes · Shift-click to add · drag to select'); }
  },
  (ids, action) => selectSketchShapes(ids, action),
  (start, end, offset, axis, distanceAxis) => {
    if (draftDirty) return;
    try {
      const measurement: Measurement = { id: crypto.randomUUID(), start, end, offset, axis, ...(distanceAxis ? { distanceAxis } : {}), ...(selectedGroup() ? { groupId: selectedGroup()!.id } : {}) };
      commitMeasurements([...measurements, measurement], 'Measurement added');
      selectedId = measurement.id; selectedComponentIds.clear(); selectedVariable = null; selectedFace = null; renderAll();
    }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not add measurement', true); }
  },
  (stage, axis) => {
    if (!measuring) return;
    const field = $('#new-measurement-axis') as HTMLSelectElement;
    if (stage === 'second' && axis) { field.value = axis; field.querySelector<HTMLOptionElement>('[value=auto]')!.disabled = true; }
    else if (stage === 'first') { field.value = measurementAxis; field.querySelector<HTMLOptionElement>('[value=auto]')!.disabled = false; }
    setStatus(stage === 'placement' ? 'Measure · move the mouse to offset the label, then click to place it' : stage === 'second' ? 'Measure · click a second corner, edge or center · Shift toggles axis distance' : stage === 'invalid' ? 'Choose a corner, edge or center of existing geometry' : stage === 'same' ? 'Choose a different point to measure' : 'Measure · click a corner, edge or center · Escape to finish');
  },
  (axisMode) => { measurementAxisMode = axisMode; renderSketchToolUI(); },
  (ids, action) => selectModelItems(ids, action),
);

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
function cloneRectangles(value: SketchShape[]) { return value.map((rectangle) => ({ ...rectangle, size: [...rectangle.size] as [number, number], position: [...rectangle.position] as [number, number] })); }
function modelItems() { return [...boxes, ...sketches]; }
function documentItems() { return documentKind === 'sketch' ? rectangles : modelItems(); }
function objectItems() { return [...documentItems(), ...measurements]; }
function measurementName(item: Measurement) { return item.name ?? `Measurement ${measurements.findIndex((m) => m.id === item.id) + 1}`; }
function itemName(item: BoxSpec | SketchShape | ModelSketch | Measurement) { return 'start' in item ? measurementName(item) : item.name; }
function selectedMeasurement() { return measurements.find((m) => m.id === selectedId) ?? null; }
function shapeCount() { return documentItems().length; }
function shapeLabel(count = shapeCount()) { return documentKind === 'sketch' ? count === 1 ? 'shape' : 'shapes' : count === 1 ? 'component' : 'components'; }
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
  renderDocumentTabs();
  syncGlbExportUI();
  $('#draft-note').textContent = draftDirty ? 'Draft pending — Run to apply. GUI editing is paused.' : `Edit the code, then run it to update the ${documentKind === 'sketch' ? 'sketch' : 'model'}.`;
  $('#draft-note').classList.toggle('warning-note', draftDirty);
  $('#add-box').toggleAttribute('disabled', draftDirty);
  $('#add-group').toggleAttribute('disabled', draftDirty);
  $('#add-sketch-group').toggleAttribute('disabled', draftDirty);
  $('#add-model-sketch').toggleAttribute('disabled', draftDirty);
  $('#rectangle-sketch-tool').toggleAttribute('disabled', draftDirty); $('#line-sketch-tool').toggleAttribute('disabled', draftDirty); $('#circle-sketch-tool').toggleAttribute('disabled', draftDirty); $('#add-cylinder').toggleAttribute('disabled', draftDirty);
  $('#add-variable').toggleAttribute('disabled', draftDirty || documentKind === 'sketch');
  root.querySelectorAll('[data-measure-tool]').forEach((button) => button.toggleAttribute('disabled', draftDirty));
  $('#delete-box').toggleAttribute('disabled', draftDirty || !(selectedComponentIds.size || selectedBox() || selectedModelSketch() || selectedRectangle() || selectedMeasurement() || selectedVariable || selectedGroup()));
  $('#duplicate-box').toggleAttribute('disabled', draftDirty || !(selectedComponentIds.size || selectedBox() || selectedModelSketch() || selectedRectangle() || selectedMeasurement() || selectedGroup()));
  renderList(); renderInspector();
}
function syncGlbExportUI() {
  const button = $('#export-glb');
  button.toggleAttribute('disabled', exportingGlb || !openDocumentIds.length || documentKind !== 'model' || !boxes.length);
  button.title = documentKind === 'sketch'
    ? 'GLB export is available for 3D models'
    : `Export applied visible boxes and cylinders for Blender${draftDirty ? ' · Unrun draft is excluded' : ''}${sketches.length || measurements.length ? ' · Sketches and measurements are excluded' : ''}`;
}
function selectedBox() { return boxes.find((box) => box.id === selectedId) ?? null; }
function selectedModelSketch() { return sketches.find((sketch) => sketch.id === selectedId) ?? null; }
function selectedRectangle() { return rectangles.find((rectangle) => rectangle.id === selectedId) ?? null; }
function selectedSketchShapes() { const hiddenIds = sceneHiddenIds(); return rectangles.filter((shape) => selectedComponentIds.has(shape.id) && !hiddenIds.has(shape.id)); }
function selectedModelItems() { const hiddenIds = sceneHiddenIds(); return modelItems().filter((item) => selectedComponentIds.has(item.id) && !hiddenIds.has(item.id)); }
function selectModelItems(ids: string[], action: SelectionAction) {
  selectComponents(ids, action);
}
function selectSketchShapes(ids: string[], action: SelectionAction) {
  selectComponents(ids, action);
}
function selectComponents(ids: string[], action: SelectionAction) {
  const hiddenIds = sceneHiddenIds();
  selectedComponentIds = updateSketchSelection(selectedComponentIds, ids.filter((id) => documentItems().some((item) => item.id === id) && !hiddenIds.has(id)), action);
  selectedId = selectedComponentIds.size === 1 ? [...selectedComponentIds][0] : null;
  selectedVariable = null; selectedFace = null;
  renderAll();
}
function renderSketchToolUI() {
  for (const tool of ['select', 'rectangle', 'line', 'circle'] as const) {
    const button = $(`#${tool}-sketch-tool`);
    button.classList.toggle('active', !measuring && sketchTool === tool);
    button.setAttribute('aria-pressed', String(!measuring && sketchTool === tool));
  }
  $('#measurement-axis-tool').classList.toggle('hidden', !measuring || documentKind === 'sketch');
  root.querySelectorAll('[data-measure-tool]').forEach((button) => {
    button.classList.toggle('active', measuring);
    button.setAttribute('aria-pressed', String(measuring));
  });
  $('.navigation-help').innerHTML = measuring ? `<span>MEASUREMENT</span> <i>·</i> <span>CLICK</span> start <i>·</i> <span>CLICK</span> end <i>·</i> <span>CLICK</span> label offset <i>·</i> <span>ESC</span> finish <i>·</i> <span>SHIFT</span> toggle <span class="measurement-mode-status${measurementAxisMode ? ' active' : ''}" role="status" aria-live="polite">AXIS DISTANCE: ${measurementAxisMode ? 'ON' : 'OFF'}</span>` : documentKind === 'sketch'
    ? sketchTool !== 'select' ? sketchTool === 'circle' ? '<span>CLICK</span> center <i>·</i> <span>MOVE</span> radius <i>·</i> <span>CLICK</span> draw <i>·</i> <span>TAB</span> exact radius <i>·</i> <span>ESC</span> select' : sketchTool === 'line' ? '<span>CLICK</span> start <i>·</i> <span>CLICK</span> end <i>·</i> <span>ESC</span> select' : '<span>CLICK</span> first corner <i>·</i> <span>CLICK</span> opposite corner <i>·</i> <span>ESC</span> select' : '<span>SHIFT + CLICK</span> multi-select <i>·</i> <span>DRAG</span> select <i>·</i> <span>MIDDLE / RIGHT DRAG</span> pan <i>·</i> wheel zoom'
    : '<span>LEFT DRAG</span> multi-select <i>·</i> <span>SHIFT</span> add <i>·</i> <span title="Two-finger touchpad drag rotates when configured to send the middle mouse button; secondary clicks pan.">MIDDLE / TWO-FINGER DRAG</span> rotate <i>·</i> <span>RIGHT DRAG / SHIFT + MIDDLE</span> pan <i>·</i> wheel zoom';
}
function activateSketchTool(tool: SketchTool) {
  if (documentKind !== 'sketch' || (tool !== 'select' && draftDirty)) return;
  activateMeasurementTool(false);
  sketchTool = tool;
  viewport.setSketchTool(tool);
  renderSketchToolUI();
}
function activateMeasurementTool(active: boolean) {
  if (active && draftDirty) return;
  measuring = active;
  if (active) sketchTool = 'select';
  viewport.setMeasurementTool(active);
  viewport.setMeasurementAxis(measurementAxis);
  renderSketchToolUI();
  if (!active) setStatus('Ready');
}
function currentMeasurementGeometry() { return { boxes, rectangles, sketches, groups }; }
function commitMeasurements(next: Measurement[], message: string) {
  const valid = validateMeasurements(next, currentMeasurementGeometry());
  const source = documentKind === 'sketch'
    ? generateSketchSource(rectangles, groups, treeOrder, valid)
    : generateSource(boxes, variables, groups, treeOrder, sketches, valid);
  measurements = valid;
  hiddenBoxIds = new Set([...hiddenBoxIds].filter(sceneHasId));
  if (selectedId && !objectItems().some((item) => item.id === selectedId) && !selectedGroup()) selectedId = null;
  refreshGeometry(); setEditor(source); appliedSource = source;
  recordAfterChange(); renderAll(); setStatus(message); scheduleSave();
}

type VariableDialogResult = VariableSpec | null;
async function askVariable(name = '', title = 'Create missing variable'): Promise<VariableDialogResult> {
  const dialog = $('#variable-dialog') as HTMLDialogElement; const form = $('#variable-form') as HTMLFormElement;
  const nameInput = $('#variable-name') as HTMLInputElement; const valueInput = $('#variable-value') as HTMLInputElement;
  const descriptionInput = $('#variable-description') as HTMLTextAreaElement;
  descriptionInput.value = '';
  $('#variable-dialog-title').textContent = title; $('#variable-submit').textContent = title === 'Add variable' ? 'Add variable' : 'Create and apply';
  nameInput.value = name; nameInput.readOnly = !!name; valueInput.value = ''; $('#variable-error').textContent = '';
  const priorFocus = document.activeElement as HTMLElement | null;
  return await new Promise((resolve) => {
    const finish = (result: VariableDialogResult) => { dialog.close(); form.removeEventListener('submit', submit); $('#variable-cancel').removeEventListener('click', cancel); dialog.removeEventListener('cancel', cancelEvent); priorFocus?.focus(); resolve(result); };
    const cancel = () => finish(null); const cancelEvent = (event: Event) => { event.preventDefault(); cancel(); };
    const submit = (event: Event) => { event.preventDefault(); const variableName = nameInput.value.trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variableName)) { $('#variable-error').textContent = 'Use letters, numbers, and underscores; start with a letter or underscore.'; nameInput.focus(); return; }
      if (variables.some((item) => item.name === variableName)) { $('#variable-error').textContent = `“${variableName}” already exists.`; nameInput.focus(); return; }
      try { const value = parseInches(valueInput.value, resolverFor(variables)); finish({ name: variableName, value, expression: /\bvar\s*\(/.test(valueInput.value) ? valueInput.value : undefined, ...(descriptionInput.value.trim() ? { description: descriptionInput.value.trim() } : {}) }); }
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
function resolveModelFromUI(input: BoxSpec[], vars: VariableSpec[]) { return validateBoxes(input, vars, groups); }
function selectedGroup() { return groups.find((g) => g.id === selectedId) ?? null; }
function sceneHasId(id: string) { return groups.some((g) => g.id === id) || objectItems().some((item) => item.id === id); }
function sceneHiddenIds() { return effectiveHiddenIds(groups, objectItems(), hiddenBoxIds); }
function groupItems(id: string) {
  const ids = groupDescendants(groups, id);
  return objectItems().filter((item) => item.groupId && ids.has(item.groupId));
}
function worldBoxes() { return boxes.map((b) => ({ ...b, groupId: undefined, position: worldPosition(b.position, groups, b.groupId) })); }
function worldSketches() { return sketches.map((sketch) => ({ ...sketch, groupId: undefined, position: worldPosition(sketch.position, groups, sketch.groupId) })); }
function reparentSketch(sketch: ModelSketch, nextGroup?: string): ModelSketch { return { ...sketch, groupId: nextGroup, position: reparentPosition(sketch.position, groups, sketch.groupId, nextGroup) }; }
function worldRectangles() { return rectangles.map((r) => ({ ...r, groupId: undefined, position: worldPosition(r.position, groups, r.groupId).slice(0, 2) as [number, number] })); }
function refreshGeometry(preserveView = true) {
  if (documentKind === 'sketch') viewport.setRectangles(worldRectangles(), { preserveView, hiddenIds: sceneHiddenIds() });
  else viewport.setBoxes(worldBoxes(), { preserveView, hiddenIds: sceneHiddenIds(), sketches: worldSketches() });
  viewport.setMeasurements(measurements);
}
function commitGroups(nextGroups: GroupSpec[], nextBoxes = boxes, nextRectangles = rectangles, message = 'Group updated', nextTreeOrder = treeOrder, nextSketches = sketches, inputMeasurements = measurements, nextHiddenIds = hiddenBoxIds) {
  const valid = validateGroups(nextGroups, documentKind === 'sketch');
  const model = documentKind === 'model' ? resolveModel(nextBoxes, variables, valid, nextSketches) : null;
  const shapes = documentKind === 'sketch' ? validateSketchShapes(nextRectangles, valid) : [];
  const geometry = { boxes: model?.boxes, sketches: model?.sketches, rectangles: shapes, groups: valid };
  const nextMeasurements = validateMeasurements(pruneMeasurements(inputMeasurements, geometry), geometry);
  const order = normalizeTreeOrder(nextTreeOrder, valid, [...(model ? [...model.boxes, ...(model.sketches ?? [])] : shapes), ...nextMeasurements]);
  const source = model ? generateSource(model.boxes, model.variables, valid, order, model.sketches ?? [], nextMeasurements) : generateSketchSource(shapes, valid, order, nextMeasurements);
  measurements = nextMeasurements;
  groups = valid;
  if (model) { boxes = cloneBoxes(model.boxes); sketches = structuredClone(model.sketches ?? []); } else rectangles = cloneRectangles(shapes);
  treeOrder = order;
  collapsedGroupIds = new Set([...collapsedGroupIds].filter((id) => groups.some((g) => g.id === id)));
  hiddenBoxIds = new Set([...nextHiddenIds].filter(sceneHasId));
  if (selectedId && !groups.some((g) => g.id === selectedId) && !objectItems().some((item) => item.id === selectedId)) selectedId = null;
  refreshGeometry(); setEditor(source); appliedSource = source;
  recordAfterChange(); renderAll(); setStatus(message); scheduleSave();
}
function addGroup() {
  if (draftDirty) return;
  const selected = selectedMeasurement() ? [selectedMeasurement()!] : documentKind === 'sketch' ? selectedSketchShapes() : selectedModelItems();
  const firstParent = selected[0]?.groupId;
  const parentId = selectedGroup()?.id ?? (selected.every((item) => item.groupId === firstParent) ? firstParent : undefined);
  const group: GroupSpec = { id: crypto.randomUUID(), name: `Group ${groups.length + 1}`, position: [0, 0, 0], ...(parentId ? { parentId } : {}) };
  const ids = new Set(selected.map((item) => item.id));
  const nextBoxes = documentKind === 'model' ? boxes.map((b) => ids.has(b.id) ? { ...reparentBox(b, groups, parentId), groupId: group.id } : b) : boxes;
  const nextShapes = documentKind === 'sketch' ? rectangles.map((r) => ids.has(r.id) ? { ...r, groupId: group.id, position: reparentPosition(r.position, groups, r.groupId, parentId).slice(0, 2) as [number, number] } : r) : rectangles;
  try { commitGroups([...groups, group], nextBoxes, nextShapes, 'Group created · drag items into it in the tree', treeOrder, sketches.map((sketch) => ids.has(sketch.id) ? { ...reparentSketch(sketch, parentId), groupId: group.id } : sketch), measurements.map((m) => ids.has(m.id) ? { ...m, groupId: group.id } : m)); selectedId = group.id; selectedComponentIds.clear(); selectedVariable = null; selectedFace = null; renderAll(); }
  catch (error) { notify(error instanceof Error ? error.message : 'Could not create group', true); }
}
function duplicateGroup(group: GroupSpec) {
  if (draftDirty) return;
  try {
    const copy = duplicateGroupBranch({ groups, boxes, sketches, rectangles, measurements }, group.id, treeOrder);
    const hiddenIds = new Set(hiddenBoxIds);
    for (const [id, copiedId] of copy.ids) if (hiddenBoxIds.has(id)) hiddenIds.add(copiedId);
    commitGroups([...groups, ...copy.groups], [...boxes, ...copy.boxes], [...rectangles, ...copy.rectangles], 'Group duplicated', copy.treeOrder, [...sketches, ...copy.sketches], [...measurements, ...copy.measurements], hiddenIds);
    for (const [id, copiedId] of copy.ids) {
      if (collapsedGroupIds.has(id)) collapsedGroupIds.add(copiedId);
      if (!sketches.some((sketch) => sketch.id === id)) continue;
      const linked = findSketchEditor(documents, activeDocumentId, id);
      const target = linked?.sketchTargets?.find((target) => target.documentId === activeDocumentId && target.sketchId === id);
      if (linked && target) linkSketchEditor(documents, activeDocumentId, copiedId, linked.id, target.origin);
    }
    selectedId = copy.rootId; selectedComponentIds.clear(); selectedVariable = null; selectedFace = null;
    renderAll(); scheduleSave();
  } catch (error) { notify(error instanceof Error ? error.message : 'Could not duplicate group', true); }
}
function changeItemGroup(id: string, groupId?: string) {
  if (draftDirty) return;
  try {
    if (measurements.some((m) => m.id === id)) { commitMeasurements(measurements.map((m) => m.id === id ? { ...m, groupId } : m), 'Measurement group updated'); return; }
    if (documentKind === 'model') {
      const next = boxes.map((b) => b.id === id ? reparentBox(b, groups, groupId) : b);
      commitBoxes(next, 'Group membership updated · position preserved', { preserveView: true }, variables, sketches.map((sketch) => sketch.id === id ? reparentSketch(sketch, groupId) : sketch));
    } else {
      commitRectangles(rectangles.map((r) => r.id === id ? { ...r, position: reparentPosition(r.position, groups, r.groupId, groupId).slice(0, 2) as [number, number], groupId } : r), 'Group membership updated · position preserved', { preserveView: true });
    }
  } catch (error) { notify(error instanceof Error ? error.message : 'Could not change group', true); renderInspector(); }
}
function membershipControl(item: BoxSpec | SketchShape | ModelSketch | Measurement) {
  const host = $('#inspector-content');
  host.insertAdjacentHTML('beforeend', `<label class="field-label group-membership-label" for="item-group">GROUP</label><select id="item-group" class="text-field" aria-label="Object group" ${draftDirty ? 'disabled' : ''}><option value="">No group</option>${groups.map((g) => `<option value="${escapeAttr(g.id)}" ${g.id === item.groupId ? 'selected' : ''}>${escapeHTML(g.name)}</option>`).join('')}</select>${'start' in item ? '<div class="inspector-tip">Group membership organizes this measurement. Only its referenced geometry determines its position.</div>' : item.groupId ? '<div class="inspector-tip">Coordinates are relative to this group.</div>' : ''}`);
  host.querySelector<HTMLSelectElement>('#item-group')!.addEventListener('change', (event) => changeItemGroup(item.id, (event.currentTarget as HTMLSelectElement).value || undefined));
}
function renderGroupInspector(group: GroupSpec) {
  const host = $('#inspector-content'), disabled = draftDirty ? 'disabled' : '';
  const descendants = groupDescendants(groups, group.id);
  const members = groupItems(group.id);
  const world = groupOffset(groups, group.id);
  host.innerHTML = `<div class="object-heading"><span class="group-symbol">▱</span><div><div class="object-name">${escapeHTML(group.name)}</div><div class="object-id">GROUP · ${groupItems(group.id).length} ITEMS</div></div></div>
    <label class="field-label" for="group-name">NAME</label><input id="group-name" class="text-field" value="${escapeAttr(group.name)}" ${disabled}/>
    <label class="field-label group-membership-label" for="group-parent">PARENT GROUP</label><select id="group-parent" class="text-field" ${disabled}><option value="">No parent</option>${groups.filter((g) => !descendants.has(g.id)).map((g) => `<option value="${escapeAttr(g.id)}" ${g.id === group.parentId ? 'selected' : ''}>${escapeHTML(g.name)}</option>`).join('')}</select>
    <div class="section-label position-label"><span>GROUP POSITION${group.parentId ? ' · IN PARENT' : ''}</span><span>INCHES</span></div><div class="${documentKind === 'sketch' ? 'sketch-fields' : 'triple-fields'}">${(documentKind === 'sketch' ? ['X', 'Y'] : ['X', 'Y', 'Z']).map((axis, i) => `<label class="measure-field"><span>${axis}</span><span class="measure-input"><input aria-label="Group position ${axis}" data-group-axis="${i}" value="${formatInches(group.position[i])}" ${disabled}/><small>in</small></span></label>`).join('')}</div>
    <div class="inspector-tip">Moving this origin moves geometry and nested groups; measurements follow only their referenced geometry; relative box placements continue to follow their reference boxes. World origin: ${world.slice(0, documentKind === 'sketch' ? 2 : 3).map(formatInches).join(', ')} in.</div>
    <div class="section-label position-label"><span>MEMBERS</span><span>${members.length}</span></div><div class="group-member-list" aria-label="Group members">${members.map((item) => `<button type="button" class="group-member" data-member-id="${escapeAttr(item.id)}" title="${escapeAttr(itemName(item))}" aria-haspopup="menu"><span>${escapeHTML(itemName(item))}</span>${item.groupId !== group.id ? `<small>${escapeHTML(groups.find((g) => g.id === item.groupId)?.name ?? '')}</small>` : ''}</button>`).join('') || '<div class="group-member-empty">No members. Drag items into this group in the tree.</div>'}</div>
    <button id="ungroup" class="button button-quiet ungroup-button" ${disabled}>Ungroup · keep items</button>`;
  const update = (patch: Partial<GroupSpec>) => { if (draftDirty) return; try { commitGroups(groups.map((g) => g.id === group.id ? { ...g, ...patch } : g)); } catch (error) { notify(error instanceof Error ? error.message : 'Could not update group', true); renderInspector(); } };
  host.querySelector<HTMLInputElement>('#group-name')!.addEventListener('change', (event) => update({ name: (event.currentTarget as HTMLInputElement).value.trim() || group.name }));
  host.querySelector<HTMLSelectElement>('#group-parent')!.addEventListener('change', (event) => { const parentId = (event.currentTarget as HTMLSelectElement).value || undefined; update({ parentId, position: reparentPosition(group.position, groups, group.parentId, parentId) }); });
  host.querySelectorAll<HTMLInputElement>('[data-group-axis]').forEach((input) => {
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') input.blur(); });
    input.addEventListener('change', () => { try { const position: Vector3 = [...group.position]; position[Number(input.dataset.groupAxis)] = parseInches(input.value); update({ position }); } catch (error) { notify(error instanceof Error ? error.message : 'Invalid position', true); renderInspector(); } });
  });
  host.querySelectorAll<HTMLButtonElement>('[data-member-id]').forEach((row) => {
    row.addEventListener('click', () => {
      const id = row.dataset.memberId!;
      if (documentKind === 'sketch' && rectangles.some((shape) => shape.id === id)) { selectSketchShapes([id], 'replace'); return; }
      selectedId = id; selectedComponentIds.clear(); selectedVariable = null; selectedFace = null; renderAll();
    });
    row.addEventListener('contextmenu', (event) => { event.preventDefault(); openGroupMemberMenu(row.dataset.memberId!, event.clientX, event.clientY); });
    row.addEventListener('keydown', (event) => {
      if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) {
        event.preventDefault(); const bounds = row.getBoundingClientRect(); openGroupMemberMenu(row.dataset.memberId!, bounds.left, bounds.bottom);
      }
    });
  });
  host.querySelector('#ungroup')!.addEventListener('click', () => ungroup(group));
}
function ungroup(group: GroupSpec) {
  if (draftDirty) return;
  try {
    const nextBoxes = boxes.map((b) => b.groupId === group.id ? reparentBox(b, groups, group.parentId) : b);
    const nextShapes = rectangles.map((r) => r.groupId === group.id ? { ...r, groupId: group.parentId, position: reparentPosition(r.position, groups, r.groupId, group.parentId).slice(0, 2) as [number, number] } : r);
    const nextGroups = groups.filter((g) => g.id !== group.id).map((g) => g.parentId === group.id ? { ...g, parentId: group.parentId, position: reparentPosition(g.position, groups, g.parentId, group.parentId) } : g);
    commitGroups(nextGroups, nextBoxes, nextShapes, 'Ungrouped · items kept in place', treeOrder, sketches.map((sketch) => sketch.groupId === group.id ? reparentSketch(sketch, group.parentId) : sketch), measurements.map((m) => m.groupId === group.id ? { ...m, groupId: group.parentId } : m));
  } catch (error) { notify(error instanceof Error ? error.message : 'Could not ungroup', true); }
}
function moveTreeComponent(id: string, drop: TreeDrop) {
  if (draftDirty) return;
  try {
    const items = objectItems();
    const move = planTreeMove(groups, items, treeOrder, id, drop);
    if (!move.changed) return;
    const group = groups.find((entry) => entry.id === id);
    const previousParent = group ? group.parentId : items.find((entry) => entry.id === id)?.groupId;
    const reparent = previousParent !== move.parentId;
    const nextGroups = groups.map((entry) => entry.id === id && reparent ? { ...entry, parentId: move.parentId, position: reparentPosition(entry.position, groups, entry.parentId, move.parentId) } : entry);
    const nextBoxes = documentKind === 'model' && reparent && !group ? boxes.map((entry) => entry.id === id ? reparentBox(entry, groups, move.parentId) : entry) : boxes;
    const nextShapes = documentKind === 'sketch' && reparent && !group ? rectangles.map((entry) => entry.id === id ? { ...entry, groupId: move.parentId, position: reparentPosition(entry.position, groups, entry.groupId, move.parentId).slice(0, 2) as [number, number] } : entry) : rectangles;
    if (drop.placement === 'inside' && move.parentId) collapsedGroupIds.delete(move.parentId);
    commitGroups(nextGroups, nextBoxes, nextShapes, reparent ? 'Component moved · position preserved' : 'Components reordered', move.order, reparent && !group ? sketches.map((sketch) => sketch.id === id ? reparentSketch(sketch, move.parentId) : sketch) : sketches, measurements.map((m) => m.id === id && reparent ? { ...m, groupId: move.parentId } : m));
  } catch (error) { notify(error instanceof Error ? error.message : 'Could not move component', true); }
}
function renderList() {
  treeDragCleanup();
  const items = objectItems();
  treeOrder = normalizeTreeOrder(treeOrder, groups, items);
  const entries = new Map([...groups, ...items].map((entry) => [entry.id, entry]));
  const groupIds = new Set(groups.map((group) => group.id));
  const hiddenIds = sceneHiddenIds();
  const visibilityButton = (id: string, name: string, parentId?: string) => {
    const hidden = hiddenIds.has(id), inherited = !!parentId && hiddenIds.has(parentId);
    const label = `${hidden ? 'Show' : 'Hide'} ${name}`;
    return `<button type="button" class="visibility-toggle" data-visibility-id="${escapeAttr(id)}" aria-label="${escapeAttr(label)}" title="${escapeAttr(inherited ? 'Show the parent group first' : label)}" ${draftDirty || inherited ? 'disabled' : ''}><i data-lucide="${hidden ? 'eye-off' : 'eye'}" aria-hidden="true"></i></button>`;
  };
  const dragAttributes = (id: string) => `data-tree-id="${escapeAttr(id)}" draggable="${!draftDirty}" title="${draftDirty ? 'Run or discard the source draft to rearrange components' : 'Drag to reorder; drop onto a group to add to it'}"`;
  $('#box-count').textContent = String(items.length);
  $('#tree-empty').classList.toggle('hidden', items.length + variables.length + groups.length > 0);
  const itemRow = (item: BoxSpec | SketchShape | ModelSketch, depth: number) => {
    const hidden = hiddenIds.has(item.id), sketch = documentKind === 'sketch', mounted = 'shapes' in item;
    const symbol = 'kind' in item && item.kind === 'circle' ? 'row-circle' : 'kind' in item && item.kind === 'cylinder' ? 'row-cylinder' : sketch ? (item as SketchShape).kind === 'line' ? 'row-line' : 'row-square' : mounted ? 'row-sketch' : 'row-cube';
    const size = 'kind' in item && item.kind === 'circle' ? `R ${formatInches(item.size[0] / 2)} in` : 'kind' in item && item.kind === 'cylinder' ? `R ${formatInches(item.size[cylinderAxes(item).radialAxes[0]] / 2)} × ${formatInches(item.size[cylinderAxes(item).lengthAxis])}` : sketch && (item as SketchShape).kind === 'line' ? `${formatInches(Math.hypot(...item.size))} in` : item.size.map(formatInches).join(' × ') + (mounted ? ` · ${item.axis.toUpperCase()}` : '');
    return `<div class="component-row box-row ${selectedComponentIds.has(item.id) ? 'selected' : ''} ${hidden ? 'hidden-object' : ''}" style="--tree-depth:${depth}" ${dragAttributes(item.id)}><button type="button" class="component-select" data-id="${escapeAttr(item.id)}" ${hidden ? 'disabled' : ''} aria-label="Select ${escapeAttr(item.name)}"><span class="${symbol}" style="--cube:${escapeAttr(item.color)}"></span><span class="row-name">${escapeHTML(item.name)}</span><span class="row-size">${size}</span></button>${visibilityButton(item.id, item.name, item.groupId)}</div>`;
  };
  const measurementRow = (m: Measurement, depth: number) => {
    const name = measurementName(m), hidden = hiddenIds.has(m.id);
    const distance = resolveMeasurement(m, currentMeasurementGeometry())?.distance;
    return `<div class="component-row box-row ${selectedId === m.id ? 'selected' : ''} ${hidden ? 'hidden-object' : ''}" style="--tree-depth:${depth}" ${dragAttributes(m.id)}><button type="button" class="component-select" data-id="${escapeAttr(m.id)}" ${hidden ? 'disabled' : ''} aria-label="Select ${escapeAttr(name)}"><i class="measurement-symbol" data-lucide="ruler" aria-hidden="true"></i><span class="row-name">${escapeHTML(name)}</span><span class="row-size">${distance === undefined ? 'Missing geometry' : formatInches(distance) + ' in'}</span></button>${visibilityButton(m.id, name, m.groupId)}</div>`;
  };
  const branch = (parentId: string | undefined, depth: number): string => treeOrder.map((id) => entries.get(id)!).filter((entry) => (groupIds.has(entry.id) ? (entry as GroupSpec).parentId : (entry as BoxSpec | SketchShape | ModelSketch).groupId) === parentId).map((entry) => {
    if (!groupIds.has(entry.id)) return 'start' in entry ? measurementRow(entry as Measurement, depth) : itemRow(entry as BoxSpec | SketchShape | ModelSketch, depth);
    const g = entry as GroupSpec;
    const collapsed = collapsedGroupIds.has(g.id);
    return `<div class="component-row group-row ${hiddenIds.has(g.id) ? 'hidden-object' : ''} ${selectedId === g.id ? 'selected' : ''}" style="--tree-depth:${depth}" ${dragAttributes(g.id)}><button class="group-collapse" data-collapse-id="${escapeAttr(g.id)}" aria-expanded="${!collapsed}" aria-label="${collapsed ? 'Expand' : 'Collapse'} ${escapeAttr(g.name)}">${collapsed ? '▸' : '▾'}</button><button class="component-select" data-id="${escapeAttr(g.id)}" aria-label="Select ${escapeAttr(g.name)}"><i class="group-symbol tree-group-icon" data-lucide="group" aria-hidden="true"></i><span class="row-name">${escapeHTML(g.name)}</span><span class="row-size">${groupItems(g.id).length} items</span></button>${visibilityButton(g.id, g.name, g.parentId)}</div>${collapsed ? '' : branch(g.id, depth + 1)}`;
  }).join('');
  listEl.innerHTML = (documentKind === 'model' ? variables.map((variable) => `<button class="component-row variable-row ${variable.name === selectedVariable ? 'selected' : ''}" data-variable="${escapeAttr(variable.name)}"><span class="variable-symbol">ƒ</span><span class="row-name">${escapeHTML(variable.name)}</span><span class="row-size">${formatInches(variable.value)} in</span></button>`).join('') : '') + branch(undefined, 0);
  renderIcons(listEl);
  listEl.insertAdjacentHTML('beforeend', '<div class="tree-root-drop" data-tree-root>Move to top level</div>');
  listEl.querySelectorAll<HTMLButtonElement>('[data-id]').forEach((row) => row.addEventListener('click', (event) => { const id = row.dataset.id!; const action = event.shiftKey || event.ctrlKey || event.metaKey ? 'toggle' : 'replace'; if (documentKind === 'sketch' && rectangles.some((shape) => shape.id === id)) { selectSketchShapes([id], action); return; } if (documentKind === 'model' && modelItems().some((item) => item.id === id)) { selectModelItems([id], action); return; } selectedComponentIds.clear(); selectedId = id; selectedVariable = null; selectedFace = null; renderAll(); }));
  listEl.querySelectorAll<HTMLButtonElement>('[data-collapse-id]').forEach((button) => button.addEventListener('click', () => { const id = button.dataset.collapseId!; if (collapsedGroupIds.has(id)) collapsedGroupIds.delete(id); else collapsedGroupIds.add(id); renderList(); scheduleSave(); }));
  listEl.querySelectorAll<HTMLButtonElement>('[data-visibility-id]').forEach((button) => button.addEventListener('click', () => toggleBoxVisibility(button.dataset.visibilityId!)));
  listEl.querySelectorAll<HTMLButtonElement>('[data-variable]').forEach((row) => row.addEventListener('click', () => { selectedVariable = row.dataset.variable!; selectedId = null; selectedFace = null; renderAll(); }));
  treeDragCleanup = bindComponentTreeDrag({
    element: listEl,
    canEdit: () => !draftDirty,
    canMove: (id, drop) => { try { planTreeMove(groups, objectItems(), treeOrder, id, drop); return true; } catch { return false; } },
    onMove: moveTreeComponent,
  });
}
function faceTitle(face: FaceName) { return face[0].toUpperCase() + face.slice(1); }
const faceDirection: Record<FaceName, string> = {
  front: 'Y-', back: 'Y+', left: 'X-', right: 'X+', top: 'Z+', bottom: 'Z-',
};
function referenceFaceTitle(face: FaceName) { return `${faceTitle(face)} ${faceDirection[face]}`; }
function openFaceMenu(hit: { boxId: string; face: FaceName; clientX: number; clientY: number }) {
  closeGroupMemberMenu();
  contextFace = hit;
  const menu = $('#face-menu'); menu.hidden = false;
  const parent = boxes.find((box) => box.id === hit.boxId);
  $('#face-menu-caption').textContent = `${parent?.name ?? 'Box'} · ${faceTitle(hit.face)} face`;
  const duplicate = $('#duplicate-from-menu') as HTMLButtonElement;
  const newFromFace = $('#new-from-face') as HTMLButtonElement;
  duplicate.disabled = draftDirty || !parent;
  newFromFace.disabled = draftDirty || !parent;
  ($('#new-cylinder-from-face') as HTMLButtonElement).disabled = draftDirty || !parent;
  $('#face-menu-reason').textContent = draftDirty ? 'Run or discard the source draft to edit boxes.' : '';
  menu.style.left = `${Math.max(8, Math.min(hit.clientX, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(hit.clientY, innerHeight - menu.offsetHeight - 8))}px`;
  newFromFace.focus();
}
function closeFaceMenu() { $('#face-menu').hidden = true; contextFace = null; }
function closeGroupMemberMenu(restoreFocus = false) {
  if (restoreFocus) Array.from($('#inspector-content').querySelectorAll<HTMLButtonElement>('[data-member-id]')).find((row) => row.dataset.memberId === contextGroupMemberId)?.focus();
  $('#group-member-menu').hidden = true; contextGroupMemberId = null;
}
function openGroupMemberMenu(id: string, clientX: number, clientY: number) {
  const item = objectItems().find((item) => item.id === id);
  if (!item?.groupId) return;
  closeFaceMenu(); contextGroupMemberId = id;
  const menu = $('#group-member-menu'); menu.hidden = false;
  $('#group-member-menu-caption').textContent = itemName(item);
  const remove = $<HTMLButtonElement>('#remove-group-member'); remove.disabled = draftDirty;
  menu.style.left = `${Math.max(8, Math.min(clientX, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(clientY, innerHeight - menu.offsetHeight - 8))}px`;
  remove.focus();
}
function renderMeasurementInspector(measurement: Measurement) {
  const host = $('#inspector-content'), disabled = draftDirty ? 'disabled' : '';
  const resolved = resolveMeasurement(measurement, currentMeasurementGeometry());
  const endpointName = (anchor: Measurement['start']) => {
    const item = documentItems().find((item) => item.id === anchor.objectId);
    const shape = anchor.shapeId ? sketches.find((s) => s.id === anchor.objectId)?.shapes.find((s) => s.id === anchor.shapeId) : null;
    return (item?.name ?? anchor.objectId) + (shape ? ' / ' + shape.name : '');
  };
  host.innerHTML = `<div class="object-heading"><i class="measurement-symbol" data-lucide="ruler" aria-hidden="true"></i><div><div class="object-name">${escapeHTML(measurementName(measurement))}</div><div class="object-id">DISTANCE MEASUREMENT</div></div></div>
    <label class="field-label" for="measurement-name">NAME</label><input id="measurement-name" class="text-field" value="${escapeAttr(measurementName(measurement))}" ${disabled}/>
    <div class="section-label"><span>${measurement.distanceAxis ? measurement.distanceAxis.toUpperCase() + ' AXIS DISTANCE' : 'DISTANCE'}</span><span>INCHES</span></div><div class="measurement-value">${resolved ? formatInches(resolved.distance) + ' in' : 'Missing geometry'}</div>
    ${documentKind === 'model' ? '<label class="field-label" for="measurement-axis">LABEL FACING AXIS</label><select id="measurement-axis" class="text-field" aria-label="Measurement facing axis" ' + disabled + '>' + ['x', 'y', 'z'].map((axis) => '<option value="' + axis + '" ' + (axis === (measurement.axis ?? 'z') ? 'selected' : '') + '>' + (axis === 'z' ? 'Z · Up' : axis.toUpperCase()) + '</option>').join('') + '</select><div class="inspector-tip">The label normal faces this axis as closely as possible while staying perpendicular to the measured line. Parallel lines use the least-aligned world axis.</div>' : ''}
    <label class="field-label group-membership-label" for="measurement-offset">LABEL OFFSET · INCHES</label><input id="measurement-offset" class="text-field" inputmode="decimal" value="${formatInches(measurement.offset ?? DEFAULT_MEASUREMENT_OFFSET)}" ${disabled}/>
    <label class="field-label" for="measurement-line-height">LABEL LINE HEIGHT · INCHES</label><input id="measurement-line-height" class="text-field" inputmode="decimal" value="${formatInches(measurement.lineHeight ?? defaultMeasurementLineHeight(resolved?.distance ?? 0))}" ${disabled}/>
    <div class="section-label"><span>REFERENCED GEOMETRY</span></div><div class="inspector-tip measurement-references">Start · ${escapeHTML(endpointName(measurement.start))}<br/>End · ${escapeHTML(endpointName(measurement.end))}</div>`;
  const update = (patch: Partial<Measurement>) => {
    if (draftDirty) return;
    try { commitMeasurements(measurements.map((m) => m.id === measurement.id ? { ...m, ...patch } : m), 'Measurement updated'); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not update measurement', true); renderInspector(); }
  };
  host.querySelector<HTMLInputElement>('#measurement-name')!.addEventListener('change', (event) => update({ name: (event.currentTarget as HTMLInputElement).value.trim() || measurementName(measurement) }));
  host.querySelector<HTMLSelectElement>('#measurement-axis')?.addEventListener('change', (event) => update({ axis: (event.currentTarget as HTMLSelectElement).value as MeasurementAxis }));
  for (const key of ['offset', 'lineHeight'] as const) {
    const input = host.querySelector<HTMLInputElement>(key === 'offset' ? '#measurement-offset' : '#measurement-line-height')!;
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') input.blur(); });
    input.addEventListener('change', () => {
      try { update({ [key]: parseInches(input.value) }); }
      catch (error) { notify(error instanceof Error ? error.message : 'Enter a distance in inches.', true); renderInspector(); }
    });
  }
  membershipControl(measurement); renderIcons(host);
}
function renderInspector() {
  closeGroupMemberMenu();
  faceColorPicker?.hide();
  faceColorPicker?.destroy();
  faceColorPicker = null;
  const measurement = selectedMeasurement();
  if (measurement) { renderMeasurementInspector(measurement); return; }
  const group = selectedGroup();
  if (group) { $('#delete-box').toggleAttribute('disabled', draftDirty); $('#duplicate-box').toggleAttribute('disabled', draftDirty); renderGroupInspector(group); return; }
  if (documentKind === 'sketch') { renderSketchInspector(); if (selectedRectangle()) membershipControl(selectedRectangle()!); return; }
  if (selectedModelItems().length > 1) { renderSelectionInspector($('#inspector-content'), selectedModelItems()); return; }
  const mounted = selectedModelSketch();
  if (mounted) { renderModelSketchInspector(mounted); membershipControl(mounted); return; }
  const box = selectedBox();
  const host = $('#inspector-content');
  const variable = variables.find((item) => item.name === selectedVariable);
  $('#delete-box').toggleAttribute('disabled', draftDirty || (!box && !variable));
  $('#duplicate-box').toggleAttribute('disabled', draftDirty || !box);
  if (relativeOpenBoxId !== box?.id) {
    relativeOpenBoxId = box?.id ?? null;
    relativeOpen = true;
  }
  if (variable) {
    const usedBy = boxes.filter((item) => Object.values(item.expressions ?? {}).some((expr) => expr.includes(`var(${variable.name})`))).length;
    host.innerHTML = `<div class="source-warning">Variables drive any numeric box dimension, position, or placement offset using <code>var(${escapeHTML(variable.name)})</code>.</div><div class="object-heading"><span class="variable-symbol large">ƒ</span><div><div class="object-name">${escapeHTML(variable.name)}</div><div class="object-id">VARIABLE · INCHES</div></div></div><label class="field-label" for="variable-inspector-value">VALUE</label><div class="measure-input variable-value-input"><input id="variable-inspector-value" value="${formatInches(variable.value)}" ${draftDirty ? 'disabled' : ''}/><small>in</small></div>${variable.expression ? `<label class="field-label expression-label" for="variable-inspector-expression">EXPRESSION</label><input id="variable-inspector-expression" class="text-field" value="${escapeAttr(variable.expression)}" ${draftDirty ? 'disabled' : ''}/>` : ''}<label class="field-label expression-label" for="variable-inspector-description">DESCRIPTION · OPTIONAL</label><textarea id="variable-inspector-description" class="text-field variable-description" rows="3" ${draftDirty ? 'disabled' : ''}>${escapeHTML(variable.description ?? '')}</textarea><div class="inspector-tip">Used by ${usedBy} ${usedBy === 1 ? 'box' : 'boxes'}. Variable names stay fixed after creation.</div>`;
    host.querySelector<HTMLTextAreaElement>('#variable-inspector-description')!.addEventListener('change', (event) => {
      if (draftDirty) return;
      const description = (event.currentTarget as HTMLTextAreaElement).value.trim() || undefined;
      try { commitBoxes(boxes, 'Variable description updated', { preserveView: true }, variables.map((item) => item.name === variable.name ? { ...item, description } : item)); }
      catch (error) { notify(error instanceof Error ? error.message : 'Could not update variable description', true); renderInspector(); }
    });
    host.querySelector<HTMLInputElement>('#variable-inspector-value')?.addEventListener('change', (event) => { const input = event.currentTarget as HTMLInputElement; void changeVariableValue(variable.name, input.value, false, input); });
    host.querySelector<HTMLInputElement>('#variable-inspector-expression')?.addEventListener('change', (event) => { const input = event.currentTarget as HTMLInputElement; void changeVariableValue(variable.name, input.value, true, input); });
    return;
  }
  if (!box) { host.innerHTML = '<div class="inspector-empty"><div class="empty-target">⊙</div><div>Select a component or variable</div><small>Choose an item from the model tree to inspect it.</small></div><div class="source-warning">GUI edits regenerate this source. Undo can restore earlier source.</div>'; return; }
  const boxId = box.id;
  const relative = box.relative;
  const refOptions = boxes.filter((candidate) => candidate.id !== box.id && !isDescendant(candidate.id, box.id)).map((candidate) => `<option value="${escapeAttr(candidate.id)}" ${candidate.id === relative?.boxId ? 'selected' : ''}>${escapeHTML(candidate.name)}</option>`).join('');
  const faceOptions = (value?: FaceName) => (['front', 'back', 'left', 'right', 'top', 'bottom'] as FaceName[]).map((face) => `<option value="${face}" ${face === value ? 'selected' : ''}>${referenceFaceTitle(face)}</option>`).join('');
  const frame = getFaceFrame(relative?.face ?? 'front');
  const edgeAxis = (axis: 'u' | 'v') => ['X', 'Y', 'Z'][axis === 'u' ? frame.uAxis : frame.vAxis];
  const edgeOptions = (axis: 'u' | 'v', value?: { side: 'left' | 'right' | 'bottom' | 'top'; offset: number }) => {
    const worldAxis = axis === 'u' ? frame.uAxis : frame.vAxis;
    const sign = axis === 'u' ? frame.uSign : frame.vSign;
    const sides = axis === 'u' ? ['left', 'right'] : ['bottom', 'top'];
    const faces: [FaceName, FaceName][] = [['left', 'right'], ['front', 'back'], ['bottom', 'top']];
    return `<option value="">None</option>${faces[worldAxis].map((face, index) => {
      const side = sides[sign > 0 ? index : 1 - index];
      return `<option value="${side}" ${value?.side === side ? 'selected' : ''}>${referenceFaceTitle(face)}</option>`;
    }).join('')}`;
  };
  const cylinderFrame = cylinderAxes(box);
  const sizeFields = (box.kind === 'cylinder' ? ['Radius', `Length · ${['X', 'Y', 'Z'][cylinderFrame.lengthAxis]}`] : ['Width · X', 'Depth · Y', 'Height · Z']).map((label, fieldIndex) => {
    const i = box.kind === 'cylinder' ? fieldIndex === 1 ? cylinderFrame.lengthAxis : cylinderFrame.radialAxes[0] : fieldIndex;
    const field: NumericField = box.kind === 'cylinder' && fieldIndex === 0 ? 'radius' : `size.${i}` as NumericField;
    const value = field === 'radius' ? box.size[cylinderFrame.radialAxes[0]] / 2 : box.size[i];
    const expression = box.expressions?.[field];
    return `<label class="measure-field"><span>${label}</span><span class="measure-input"><input aria-label="${label} in inches" data-kind="size" data-index="${i}" value="${escapeAttr(expression ?? formatInches(value))}" title="${expression ? `Resolved: ${formatInches(value)} in` : ''}" inputmode="decimal" ${draftDirty ? 'disabled' : ''}/><small>in</small></span>${computedMeasurement(expression, value)}</label>`;
  }).join('');
  host.innerHTML = `<div class="source-warning">GUI edits regenerate the model source. Undo can restore earlier source.</div><div class="object-heading"><span class="object-swatch" style="--cube:${escapeAttr(box.color)}"></span><div><div class="object-name">${escapeHTML(box.name)}</div><div class="object-id">${box.kind === 'cylinder' ? 'CYLINDER' : 'BOX'} · ${escapeHTML(box.id.slice(0, 8).toUpperCase())}</div></div></div>
    <label class="field-label" for="box-name">NAME</label><input id="box-name" class="text-field" value="${escapeAttr(box.name)}" ${draftDirty ? 'disabled' : ''} />
    ${box.kind === 'cylinder' ? `<label class="field-label expression-label" for="solid-axis">LENGTH AXIS</label><select id="solid-axis" class="text-field" ${draftDirty ? 'disabled' : ''}>${(['x', 'y', 'z'] as const).map((axis) => `<option value="${axis}" ${axis === (box.axis ?? 'z') ? 'selected' : ''}>${axis.toUpperCase()}</option>`).join('')}</select>` : ''}
    <div class="section-label"><span>SIZE</span><span>INCHES</span></div><div class="${box.kind === 'cylinder' ? 'sketch-fields' : 'triple-fields'}">${sizeFields}</div>
    <div class="section-label position-label"><span>${box.groupId ? 'POSITION IN GROUP' : 'ABSOLUTE POSITION'} <em>MIN CORNER</em></span><span>INCHES</span></div><div class="triple-fields">${['X', 'Y', 'Z'].map((axis, i) => `<label class="measure-field"><span>${axis}</span><span class="measure-input"><input aria-label="Absolute position ${axis}" data-kind="position" data-index="${i}" value="${escapeAttr(box.expressions?.[`position.${i}` as NumericField] ?? formatInches(box.position[i]))}" title="${box.expressions?.[`position.${i}` as NumericField] ? `Resolved: ${formatInches(box.position[i])} in` : ''}" inputmode="decimal" ${draftDirty || relative ? 'disabled' : ''}/><small>in</small></span>${computedMeasurement(box.expressions?.[`position.${i}` as NumericField], box.position[i])}</label>`).join('')}</div>
    <details class="relative-card" aria-label="Relative placement" ${relativeOpen ? 'open' : ''}><summary class="relative-heading"><div><div class="section-label"><span>RELATIVE PLACEMENT</span></div><div class="relative-summary">${relative ? `Linked to ${escapeHTML(boxes.find((candidate) => candidate.id === relative.boxId)?.name ?? relative.boxId)} · ${referenceFaceTitle(relative.face)}` : 'Anchor this box to another box face.'}</div></div>${relative ? '<button class="small-action" id="detach-relative" type="button">Detach</button>' : ''}</summary>
      <div class="relative-grid"><label class="measure-field"><span>Reference box</span><select id="relative-reference" aria-label="Reference box" ${draftDirty || !boxes.some((candidate) => candidate.id !== box.id && !isDescendant(candidate.id, box.id)) ? 'disabled' : ''}><option value="">${boxes.length < 2 ? 'No other boxes' : 'Choose box'}</option>${refOptions}</select></label>
      <label class="measure-field"><span>Reference face</span><select id="relative-face" aria-label="Reference face" ${draftDirty || !relative ? 'disabled' : ''}>${faceOptions(relative?.face)}</select></label></div>
      <div class="relative-grid side-grid"><label class="measure-field"><span>First edge · ${edgeAxis('u')}</span><select id="relative-u-side" aria-label="First edge ${edgeAxis('u')}" ${draftDirty || !relative ? 'disabled' : ''}>${edgeOptions('u', relative?.u)}</select></label>
      <label class="measure-field"><span>First edge offset</span><span class="measure-input"><input id="relative-u-offset" aria-label="First edge ${edgeAxis('u')} inward offset in inches" value="${escapeAttr(box.expressions?.['relative.u.offset'] ?? formatInches(relative?.u?.offset ?? 0))}" title="${box.expressions?.['relative.u.offset'] ? `Resolved: ${formatInches(relative?.u?.offset ?? 0)} in` : ''}" inputmode="decimal" ${draftDirty || !relative?.u ? 'disabled' : ''}/><small>in</small></span>${computedMeasurement(box.expressions?.['relative.u.offset'], relative?.u?.offset ?? 0)}</label>
      <label class="measure-field"><span>Second edge · ${edgeAxis('v')}</span><select id="relative-v-side" aria-label="Second edge ${edgeAxis('v')}" ${draftDirty || !relative ? 'disabled' : ''}>${edgeOptions('v', relative?.v)}</select></label>
      <label class="measure-field"><span>Second edge offset</span><span class="measure-input"><input id="relative-v-offset" aria-label="Second edge ${edgeAxis('v')} inward offset in inches" value="${escapeAttr(box.expressions?.['relative.v.offset'] ?? formatInches(relative?.v?.offset ?? 0))}" title="${box.expressions?.['relative.v.offset'] ? `Resolved: ${formatInches(relative?.v?.offset ?? 0)} in` : ''}" inputmode="decimal" ${draftDirty || !relative?.v ? 'disabled' : ''}/><small>in</small></span>${computedMeasurement(box.expressions?.['relative.v.offset'], relative?.v?.offset ?? 0)}</label>
      <label class="measure-field relative-distance-field"><span>Distance from face</span><span class="measure-input"><input id="relative-offset" aria-label="Distance from face in inches" value="${escapeAttr(box.expressions?.['relative.offset'] ?? formatInches(relative?.offset ?? 0))}" title="${box.expressions?.['relative.offset'] ? `Resolved: ${formatInches(relative?.offset ?? 0)} in` : ''}" inputmode="decimal" ${draftDirty || !relative ? 'disabled' : ''}/><small>in</small></span>${computedMeasurement(box.expressions?.['relative.offset'], relative?.offset ?? 0)}</label></div><div class="relative-help">Positive edge offsets move inward from the named edge.</div></details>
    <div class="section-label color-label"><span>FACE COLOR</span><span>${box.color.trim().toLowerCase() === TRANSPARENT_COLOR ? 'TRANSPARENT' : 'CUSTOM CODE'}</span></div><div class="color-row"><div class="swatch-grid">${COLOR_OPTIONS.map((c) => { const transparent = c === TRANSPARENT_COLOR; const chosen = box.color.trim().toLowerCase() === c; const swatchStyle = transparent ? `--cube:#1c2932;background-color:#1c2932;background-image:linear-gradient(45deg,#aab7be 25%,transparent 25%,transparent 75%,#aab7be 75%),linear-gradient(45deg,#aab7be 25%,transparent 25%,transparent 75%,#aab7be 75%);background-position:0 0,4px 4px;background-size:8px 8px;${chosen ? 'border:1px solid #f0c27e;box-shadow:none;position:relative' : ''}` : `--cube:${c}`; const check = transparent && chosen ? '<span aria-hidden="true" style="position:absolute;inset:0;display:grid;place-items:center;color:#17222b;font-size:10px;font-weight:800;line-height:1">✓</span>' : ''; return `<button class="swatch ${transparent ? 'swatch-transparent ' : ''}${chosen ? 'chosen' : ''}" data-color="${c}" style="${swatchStyle}" aria-label="${transparent ? `Transparent${chosen ? ' (selected)' : ''}` : `Color ${c}`}" aria-pressed="${chosen}" ${draftDirty ? 'disabled' : ''}>${check}</button>`; }).join('')}</div><input id="box-color" type="color" value="${escapeAttr(/^#[0-9a-f]{6}$/i.test(box.color) ? box.color : '#d9a76e')}" ${draftDirty ? 'disabled' : ''}/></div>
    <div class="inspector-tip">Enter an inch value or arithmetic (for example, (20 - 3/4)); press Enter or leave the field to apply it.</div>`;
  const nameInput = host.querySelector<HTMLInputElement>('#box-name')!;
  host.querySelector<HTMLDetailsElement>('.relative-card')?.addEventListener('toggle', (event) => { const card = event.currentTarget as HTMLDetailsElement; if (card.isConnected && relativeOpenBoxId === boxId) relativeOpen = card.open; });
  nameInput.addEventListener('change', () => updateBox(box.id, { name: nameInput.value.trim() || box.name }));
  host.querySelector<HTMLSelectElement>('#solid-axis')?.addEventListener('change', (event) => {
    try {
      const axis = (event.currentTarget as HTMLSelectElement).value as CylinderAxis;
      const next = reorientCylinder(box, axis);
      const oldOrder = cylinderAxisOrder(box), nextOrder = cylinderAxisOrder(next);
      const anchor = (value: Measurement['start']) => {
        if (value.objectId !== box.id) return value;
        const coordinates = [...value.coordinates];
        oldOrder.forEach((oldIndex, i) => { coordinates[nextOrder[i]] = value.coordinates[oldIndex]; });
        return { ...value, coordinates };
      };
      const nextMeasurements = measurements.map((m) => ({ ...m, start: anchor(m.start), end: anchor(m.end) }));
      commitBoxes(boxes.map((item) => item.id === box.id ? next : item), 'Cylinder axis updated', { preserveView: true }, variables, sketches, nextMeasurements);
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not change cylinder axis', true); renderInspector(); }
  });
  host.querySelectorAll<HTMLInputElement>('.measure-input input[data-kind]').forEach((input) => {
    const apply = async () => {
      try {
        const parsed = await parseWithMissingVariables(input.value);
        const kind = input.dataset.kind as 'size' | 'position', index = Number(input.dataset.index);
        const radius = box.kind === 'cylinder' && kind === 'size' && index === cylinderFrame.radialAxes[0];
        const field: NumericField = radius ? 'radius' : `${kind}.${index}` as NumericField;
        const expressions = { ...(box.expressions ?? {}) };
        if (/\bvar\s*\(/.test(input.value)) expressions[field] = input.value;
        else delete expressions[field];
        if (radius) for (const axis of cylinderFrame.radialAxes) delete expressions[`size.${axis}` as NumericField];
        const next = boxes.map((item) => item.id === box.id ? {
          ...item, expressions,
          [kind]: item[kind].map((n, i) => radius && cylinderFrame.radialAxes.includes(i as 0 | 1 | 2) ? 2 * parsed.value : i === index ? parsed.value : n) as [number, number, number],
        } : item);
        commitBoxes(next, 'Dimension updated', { preserveView: true }, parsed.variables);
      } catch (err) {
        if (err instanceof Error && err.message === 'Variable creation cancelled.') { renderInspector(); return; }
        input.classList.add('invalid'); notify(err instanceof Error ? err.message : 'Invalid dimension', true);
      }
    };
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
  host.querySelector<HTMLButtonElement>('#detach-relative')?.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); const expressions = { ...(box.expressions ?? {}) }; delete expressions['relative.offset']; delete expressions['relative.u.offset']; delete expressions['relative.v.offset']; delete expressions['position.0']; delete expressions['position.1']; delete expressions['position.2']; updateBox(box.id, { relative: undefined, expressions }); });
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
  membershipControl(box);
}
function renderSelectionInspector(host: HTMLElement, shapes: (SketchShape | BoxSpec | ModelSketch)[]) {
  const colors = new Set(shapes.map((shape) => shape.color.toLowerCase()));
  const commonColor = colors.size === 1 ? shapes[0].color.toLowerCase() : null;
  const disabled = draftDirty ? 'disabled' : '';
  host.innerHTML = `<div class="object-heading"><div><div class="object-name">${shapes.length} components selected</div><div class="object-id">${documentKind === 'sketch' ? '2D SKETCH' : '3D MODEL'} SELECTION</div></div></div>
    <div class="section-label"><span>SELECTED COMPONENTS</span></div><ul class="sketch-selected-components">${shapes.map((shape) => `<li><span class="${'kind' in shape && shape.kind === 'circle' ? 'row-circle' : 'kind' in shape && shape.kind === 'cylinder' ? 'row-cylinder' : 'kind' in shape && shape.kind === 'line' ? 'row-line' : shape.size.length === 3 ? 'row-cube' : 'row-square'}" style="--cube:${escapeAttr(shape.color)}" aria-hidden="true"></span><span class="selection-component-name">${escapeHTML(shape.name)}</span><small>${'kind' in shape && shape.kind === 'circle' ? 'Circle' : 'kind' in shape && shape.kind === 'cylinder' ? 'Cylinder' : 'kind' in shape && shape.kind === 'line' ? 'Line' : shape.size.length === 3 ? 'Box' : documentKind === 'sketch' ? 'Rectangle' : 'Sketch'}</small></li>`).join('')}</ul>
    <div class="section-label color-label"><span>${documentKind === 'sketch' ? 'STROKE' : 'FACE'} COLOR</span><span>${commonColor ? 'ALL SELECTED' : 'MIXED COLORS'}</span></div>
    <div class="color-row"><div class="swatch-grid">${SKETCH_COLOR_OPTIONS.map((color) => `<button class="swatch ${color === commonColor ? 'chosen' : ''}" data-color="${color}" style="--cube:${color}" aria-label="Color ${color}" aria-pressed="${color === commonColor}" ${disabled}></button>`).join('')}</div><input id="selection-color" type="color" aria-label="Color for all selected components" value="${escapeAttr(commonColor && /^#[0-9a-f]{6}$/i.test(commonColor) ? commonColor : SKETCH_DEFAULT_COLOR)}" ${disabled}/></div>
    <div class="inspector-tip">Color changes apply to all ${shapes.length} selected components. Shift-click a component to add or remove it.</div>`;
  const applyColor = (color: string) => {
    if (draftDirty) return;
    const ids = new Set(shapes.map((shape) => shape.id));
    try {
      if (documentKind === 'sketch') commitRectangles(rectangles.map((shape) => ids.has(shape.id) ? { ...shape, color } : shape), `${ids.size} component colors updated`, { preserveView: true });
      else commitBoxes(boxes.map((box) => ids.has(box.id) ? { ...box, color } : box), `${ids.size} component colors updated`, { preserveView: true }, variables, sketches.map((sketch) => ids.has(sketch.id) ? { ...sketch, color } : sketch));
    }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not update colors', true); renderInspector(); }
  };
  host.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((button) => button.addEventListener('click', () => applyColor(button.dataset.color!)));
  host.querySelector<HTMLInputElement>('#selection-color')!.addEventListener('change', (event) => applyColor((event.currentTarget as HTMLInputElement).value));
}
function renderModelSketchInspector(sketch: ModelSketch) {
  const host = $('#inspector-content'), disabled = draftDirty ? 'disabled' : '';
  const axes: Record<SketchAxis, string> = { x: 'X · Y/Z plane', y: 'Y · X/Z plane', z: 'Z · X/Y plane' };
  const references = documents.filter((doc) => doc.kind === 'sketch');
  const linked = findSketchEditor(documents, activeDocumentId, sketch.id);
  host.innerHTML = `<div class="object-heading"><span class="row-sketch" style="--cube:${escapeAttr(sketch.color)}"></span><div><div class="object-name">${escapeHTML(sketch.name)}</div><div class="object-id">SKETCH · ${sketch.shapes.length} SHAPES</div></div></div>
    <label class="field-label" for="model-sketch-name">NAME</label><input id="model-sketch-name" class="text-field" value="${escapeAttr(sketch.name)}" ${disabled}/>
    <label class="field-label group-membership-label" for="model-sketch-axis">NORMAL AXIS</label><select id="model-sketch-axis" class="text-field" ${disabled}>${(['x', 'y', 'z'] as SketchAxis[]).map((axis) => `<option value="${axis}" ${axis === sketch.axis ? 'selected' : ''}>${axes[axis]}</option>`).join('')}</select>
    <div class="section-label"><span>FRAME SIZE</span><span>INCHES</span></div><div class="sketch-fields">${['Width', 'Height'].map((label, i) => `<label class="measure-field"><span>${label}</span><span class="measure-input"><input aria-label="Sketch ${label.toLowerCase()}" data-model-sketch-size="${i}" value="${formatInches(sketch.size[i])}" ${disabled}/><small>in</small></span></label>`).join('')}</div>
    <div class="section-label position-label"><span>POSITION${sketch.groupId ? ' · IN GROUP' : ''}</span><span>INCHES</span></div><div class="triple-fields">${['X', 'Y', 'Z'].map((axis, i) => `<label class="measure-field"><span>${axis}</span><span class="measure-input"><input aria-label="Sketch position ${axis}" data-model-sketch-position="${i}" value="${formatInches(sketch.position[i])}" ${disabled}/><small>in</small></span></label>`).join('')}</div>
    <div class="section-label color-label"><span>FRAME COLOR</span></div><input id="model-sketch-color" type="color" aria-label="Sketch frame color" value="${escapeAttr(/^#[0-9a-f]{6}$/i.test(sketch.color) ? sketch.color : '#86a9a3')}" ${disabled}/>
    <label class="field-label group-membership-label" for="model-sketch-reference">REFERENCE SKETCH</label><select id="model-sketch-reference" class="text-field" ${disabled}><option value="">No linked tab</option>${references.map((doc) => `<option value="${escapeAttr(doc.id)}" ${linked?.id === doc.id ? 'selected' : ''} ${doc.draftDirty && linked?.id !== doc.id ? 'disabled' : ''}>${escapeHTML(doc.name)}${doc.draftDirty ? ' · Draft pending' : ''}</option>`).join('')}</select>
    <div class="inspector-tip">${linked ? `Changes in ${escapeHTML(linked.name)} update this sketch automatically. Run source drafts to apply them.` : 'Link an open 2D sketch or edit the contents below.'} Contents are saved inside this model. Frame size does not scale the shapes.</div>
    <button id="edit-model-sketch" class="button button-quiet ungroup-button">Edit contents in 2D</button>
    <div class="inspector-tip">The same linked tab opens each time. Drawing, property edits, and undo/redo automatically update the model.</div>`;
  const update = (patch: Partial<ModelSketch>) => {
    if (draftDirty) return false;
    try { commitBoxes(boxes, 'Sketch updated', { preserveView: true }, variables, sketches.map((item) => item.id === sketch.id ? { ...item, ...patch } : item)); return true; }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not update sketch', true); renderInspector(); return false; }
  };
  host.querySelector<HTMLInputElement>('#model-sketch-name')!.addEventListener('change', (event) => update({ name: (event.currentTarget as HTMLInputElement).value.trim() || sketch.name }));
  host.querySelector<HTMLSelectElement>('#model-sketch-axis')!.addEventListener('change', (event) => update({ axis: (event.currentTarget as HTMLSelectElement).value as SketchAxis }));
  host.querySelector<HTMLInputElement>('#model-sketch-color')!.addEventListener('change', (event) => update({ color: (event.currentTarget as HTMLInputElement).value }));
  host.querySelectorAll<HTMLInputElement>('[data-model-sketch-size], [data-model-sketch-position]').forEach((input) => {
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') input.blur(); });
    input.addEventListener('change', () => {
      try {
        if (input.dataset.modelSketchSize !== undefined) { const size: [number, number] = [...sketch.size]; size[Number(input.dataset.modelSketchSize)] = parseInches(input.value); update({ size }); }
        else { const position: Vector3 = [...sketch.position]; position[Number(input.dataset.modelSketchPosition)] = parseInches(input.value); update({ position }); }
      } catch (error) { notify(error instanceof Error ? error.message : 'Invalid dimension', true); renderInspector(); }
    });
  });
  host.querySelector<HTMLSelectElement>('#model-sketch-reference')!.addEventListener('change', (event) => {
    const editorId = (event.currentTarget as HTMLSelectElement).value;
    if (!editorId) { linkSketchEditor(documents, activeDocumentId, sketch.id); renderInspector(); scheduleSave(); return; }
    const doc = documents.find((doc) => doc.id === editorId);
    if (!doc || doc.kind !== 'sketch' || doc.draftDirty) return;
    if (update({ ...sketchReference(doc.rectangles, doc.groups), referenceName: doc.name })) {
      linkSketchEditor(documents, activeDocumentId, sketch.id, doc.id, sketchReferenceOrigin(doc.rectangles, doc.groups));
      renderInspector(); scheduleSave();
    }
  });
  host.querySelector('#edit-model-sketch')!.addEventListener('click', () => {
    captureDocument();
    const doc = openSketchEditor(documents, activeDocument(), sketch.id);
    doc.name = uniqueFileName(doc.name, siblingNames(documents, folders, doc.parentId, doc.id));
    synchronizeSketchReferences(documents, doc);
    loadDocument(doc); scheduleSave();
    setStatus('Edit sketch contents · applied changes automatically update the model');
  });
}
function renderSketchInspector() {
  const host = $('#inspector-content');
  const shapes = selectedSketchShapes();
  const rectangle = selectedRectangle();
  $('#delete-box').toggleAttribute('disabled', draftDirty || !shapes.length);
  $('#duplicate-box').toggleAttribute('disabled', draftDirty || !shapes.length);
  if (shapes.length > 1) { renderSelectionInspector(host, shapes); return; }
  if (!rectangle) { host.innerHTML = '<div class="inspector-empty"><div class="empty-target">▭</div><div>Select a sketch shape</div><small>Choose a shape from the tree or sketch to edit it.</small></div><div class="source-warning">GUI edits regenerate the sketch source. Undo can restore earlier source.</div>'; return; }
  if (rectangle.kind === 'line') { renderLineInspector(host, rectangle); return; }
  if (rectangle.kind === 'circle') { renderCircleInspector(host, rectangle); return; }
  host.innerHTML = `<div class="object-heading"><span class="object-swatch" style="--cube:${escapeAttr(rectangle.color)}"></span><div><div class="object-name">${escapeHTML(rectangle.name)}</div><div class="object-id">${rectangle.kind === 'line' ? 'LINE' : 'RECTANGLE'} · ${escapeHTML(rectangle.id.slice(0, 8).toUpperCase())}</div></div></div>
    <label class="field-label" for="rectangle-name">NAME</label><input id="rectangle-name" class="text-field" value="${escapeAttr(rectangle.name)}" ${draftDirty ? 'disabled' : ''}/>
    <div class="section-label"><span>${rectangle.kind === 'line' ? 'END POINT' : 'SIZE'}</span><span>INCHES</span></div><div class="sketch-fields">${(rectangle.kind === 'line' ? ['End X', 'End Y'] : ['Width · X', 'Height · Y']).map((label, i) => `<label class="measure-field"><span>${label}</span><span class="measure-input"><input data-kind="size" data-index="${i}" value="${formatInches(rectangle.size[i] + (rectangle.kind === 'line' ? rectangle.position[i] : 0))}" inputmode="decimal" ${draftDirty ? 'disabled' : ''}/><small>in</small></span></label>`).join('')}</div>
    <div class="section-label position-label"><span>${rectangle.kind === 'line' ? 'START POINT' : 'POSITION <em>MIN CORNER</em>'}</span><span>INCHES</span></div><div class="sketch-fields">${['X', 'Y'].map((label, i) => `<label class="measure-field"><span>${label}</span><span class="measure-input"><input data-kind="position" data-index="${i}" value="${formatInches(rectangle.position[i])}" inputmode="decimal" ${draftDirty ? 'disabled' : ''}/><small>in</small></span></label>`).join('')}</div>
    <div class="section-label color-label"><span>STROKE COLOR</span></div><div class="color-row"><div class="swatch-grid">${SKETCH_COLOR_OPTIONS.map((color) => `<button class="swatch ${color === rectangle.color ? 'chosen' : ''}" data-color="${color}" style="--cube:${color}" aria-label="Color ${color}" ${draftDirty ? 'disabled' : ''}></button>`).join('')}</div><input id="rectangle-color" type="color" value="${escapeAttr(/^#[0-9a-f]{6}$/i.test(rectangle.color) ? rectangle.color : SKETCH_DEFAULT_COLOR)}" ${draftDirty ? 'disabled' : ''}/></div>
    <div class="inspector-tip">Enter an inch value or arithmetic; press Enter or leave the field to apply it.</div>`;
  host.querySelector<HTMLInputElement>('#rectangle-name')?.addEventListener('change', (event) => updateRectangle(rectangle.id, { name: (event.currentTarget as HTMLInputElement).value.trim() || rectangle.name }));
  host.querySelectorAll<HTMLInputElement>('.measure-input input[data-kind]').forEach((input) => {
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } });
    input.addEventListener('change', () => { try { const value = parseInches(input.value); const kind = input.dataset.kind as 'size' | 'position'; const index = Number(input.dataset.index); const next = [...rectangle[kind]] as [number, number]; next[index] = rectangle.kind === 'line' && kind === 'size' ? value - rectangle.position[index] : value; if (rectangle.kind === 'line' && kind === 'position') { const size = [...rectangle.size] as [number, number]; size[index] += rectangle.position[index] - value; updateRectangle(rectangle.id, { position: next, size }); } else updateRectangle(rectangle.id, { [kind]: next }); } catch (error) { input.classList.add('invalid'); notify(error instanceof Error ? error.message : 'Invalid dimension', true); } });
  });
  host.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((button) => button.addEventListener('click', () => updateRectangle(rectangle.id, { color: button.dataset.color! })));
  host.querySelector<HTMLInputElement>('#rectangle-color')?.addEventListener('input', (event) => updateRectangle(rectangle.id, { color: (event.currentTarget as HTMLInputElement).value }));
}
function renderCircleInspector(host: HTMLElement, circle: SketchShape) {
  const disabled = draftDirty ? 'disabled' : '';
  const center: [number, number] = [circle.position[0] + circle.size[0] / 2, circle.position[1] + circle.size[0] / 2];
  const field = (label: string, key: string, value: number) => `<label class="measure-field"><span>${label}</span><span class="measure-input"><input aria-label="Circle ${label}" data-circle-field="${key}" value="${Number.isInteger(value * 64) ? formatInches(value) : String(value)}" inputmode="decimal" autocomplete="off" ${disabled}/><small>in</small></span></label>`;
  host.innerHTML = `<div class="object-heading"><span class="row-circle" style="--cube:${escapeAttr(circle.color)}" aria-hidden="true"></span><div><div class="object-name">${escapeHTML(circle.name)}</div><div class="object-id">CIRCLE · ${escapeHTML(circle.id.slice(0, 8).toUpperCase())}</div></div></div>
    <label class="field-label" for="circle-name">NAME</label><input id="circle-name" class="text-field" value="${escapeAttr(circle.name)}" ${disabled}/>
    <div class="section-label"><span>SIZE</span><span>INCHES</span></div><div class="sketch-fields">${field('Radius', 'radius', circle.size[0] / 2)}</div>
    <div class="section-label position-label"><span>CENTER${circle.groupId ? ' IN GROUP' : ''}</span><span>INCHES</span></div><div class="sketch-fields">${field('Center X', 'x', center[0])}${field('Center Y', 'y', center[1])}</div>
    <div class="section-label color-label"><span>STROKE COLOR</span></div><div class="color-row"><div class="swatch-grid">${SKETCH_COLOR_OPTIONS.map((color) => `<button class="swatch ${color === circle.color ? 'chosen' : ''}" data-color="${color}" style="--cube:${color}" aria-label="Color ${color}" ${disabled}></button>`).join('')}</div><input id="circle-color" type="color" aria-label="Circle stroke color" value="${escapeAttr(/^#[0-9a-f]{6}$/i.test(circle.color) ? circle.color : SKETCH_DEFAULT_COLOR)}" ${disabled}/></div>
    <div class="inspector-tip">Changing the radius keeps the center fixed. The center snaps when drawing or measuring.</div>`;
  host.querySelector<HTMLInputElement>('#circle-name')!.addEventListener('change', (event) => updateRectangle(circle.id, { name: (event.currentTarget as HTMLInputElement).value.trim() || circle.name }));
  host.querySelectorAll<HTMLInputElement>('[data-circle-field]').forEach((input) => {
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } });
    input.addEventListener('change', () => {
      try {
        const value = parseInches(input.value), key = input.dataset.circleField;
        const nextCenter: [number, number] = [...center];
        if (key === 'x') nextCenter[0] = value;
        if (key === 'y') nextCenter[1] = value;
        const next = circleFromCenter(nextCenter, key === 'radius' ? value : circle.size[0] / 2, circle.id, circle.name, circle.color);
        updateRectangle(circle.id, { size: next.size, position: next.position });
      } catch (error) { input.classList.add('invalid'); notify(error instanceof Error ? error.message : 'Invalid circle dimension', true); }
    });
  });
  host.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((button) => button.addEventListener('click', () => updateRectangle(circle.id, { color: button.dataset.color! })));
  host.querySelector<HTMLInputElement>('#circle-color')!.addEventListener('input', (event) => updateRectangle(circle.id, { color: (event.currentTarget as HTMLInputElement).value }));
}

function renderLineInspector(host: HTMLElement, line: SketchShape) {
  const { length, angle } = lineMeasurements(line.size);
  const coordinatesOpen = host.querySelector<HTMLDetailsElement>('.line-coordinates')?.open ?? false;
  const disabled = draftDirty ? 'disabled' : '';
  const field = (label: string, key: string, value: number, unit = 'in') => `<label class="measure-field"><span>${label}</span><span class="measure-input"><input aria-label="Line ${label}" data-line-field="${key}" value="${unit === '°' ? Number(value.toFixed(2)) : formatInches(value)}" inputmode="decimal" autocomplete="off" ${disabled}/><small>${unit}</small></span></label>`;
  host.innerHTML = `<div class="line-inspector">
    <div class="line-inspector-heading"><span class="line-inspector-symbol" style="--cube:${escapeAttr(line.color)}" aria-hidden="true">╱</span><input class="text-field" id="line-name" aria-label="Line name" value="${escapeAttr(line.name)}" ${disabled}/><span class="line-kind">LINE</span></div>
    <div class="line-measurements sketch-fields">${field('Length', 'length', length)}${field('Angle', 'angle', angle, '°')}${field('ΔX', 'dx', line.size[0])}${field('ΔY', 'dy', line.size[1])}</div>
    <div class="line-angle-hint">+ clockwise · − counterclockwise</div>
    <details class="line-coordinates" ${coordinatesOpen ? 'open' : ''}><summary>Coordinates <span>inches</span></summary><div class="line-coordinate-grid"><span class="coordinate-axis"></span><span class="coordinate-axis">X</span><span class="coordinate-axis">Y</span><span class="coordinate-point">Start</span>${field('Start X', 'start-x', line.position[0])}${field('Start Y', 'start-y', line.position[1])}<span class="coordinate-point">End</span>${field('End X', 'end-x', line.position[0] + line.size[0])}${field('End Y', 'end-y', line.position[1] + line.size[1])}</div></details>
    <div class="line-color-row"><span class="field-label">STROKE</span><div class="swatch-grid">${SKETCH_COLOR_OPTIONS.map((color) => `<button class="swatch ${color === line.color ? 'chosen' : ''}" data-color="${color}" style="--cube:${color}" aria-label="Color ${color}" aria-pressed="${color === line.color}" ${disabled}></button>`).join('')}</div><input id="line-color" aria-label="Custom line color" type="color" value="${escapeAttr(/^#[0-9a-f]{6}$/i.test(line.color) ? line.color : SKETCH_DEFAULT_COLOR)}" ${disabled}/></div>
    <div class="line-inspector-tip">Enter or leave a field to apply.</div>
  </div>`;
  host.querySelector<HTMLInputElement>('#line-name')!.addEventListener('change', (event) => updateRectangle(line.id, { name: (event.currentTarget as HTMLInputElement).value.trim() || line.name }));
  host.querySelectorAll<HTMLInputElement>('[data-line-field]').forEach((input) => {
    input.addEventListener('focus', () => input.select());
    input.addEventListener('input', () => input.classList.remove('invalid'));
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } });
    input.addEventListener('change', () => {
      if (draftDirty) return;
      try {
        const key = input.dataset.lineField!;
        const value = key === 'angle' ? parseLineAngle(input.value) : parseInches(input.value);
        const position: [number, number] = [...line.position];
        let size: [number, number] = [...line.size];
        if (key === 'length' || key === 'angle') {
          if (key === 'length' && value <= 0) throw new Error('Line length must be positive.');
          size = lineDisplacement(key === 'length' ? value : length, key === 'angle' ? value : angle);
        } else if (key === 'dx' || key === 'dy') size[key === 'dx' ? 0 : 1] = value;
        else {
          const index = key.endsWith('x') ? 0 : 1;
          if (key.startsWith('start')) { size[index] += position[index] - value; position[index] = value; }
          else size[index] = value - position[index];
        }
        commitRectangles(rectangles.map((shape) => shape.id === line.id ? { ...shape, position, size } : shape), 'Line updated', { preserveView: true });
      } catch (error) { input.classList.add('invalid'); notify(error instanceof Error ? error.message : 'Invalid line dimension', true); }
    });
  });
  host.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((button) => button.addEventListener('click', () => updateRectangle(line.id, { color: button.dataset.color! })));
  host.querySelector<HTMLInputElement>('#line-color')!.addEventListener('input', (event) => updateRectangle(line.id, { color: (event.currentTarget as HTMLInputElement).value }));
}
function isDescendant(candidateId: string, ancestorId: string) { let current = boxes.find((box) => box.id === candidateId); const seen = new Set<string>(); while (current?.relative && !seen.has(current.id)) { if (current.relative.boxId === ancestorId) return true; seen.add(current.id); current = boxes.find((box) => box.id === current!.relative!.boxId); } return false; }
function renderAll() {
  syncGlbExportUI();
  if (selectedId && !selectedGroup() && sceneHiddenIds().has(selectedId)) { selectedId = null; selectedFace = null; }
  if (selectedGroup() || selectedMeasurement() || selectedVariable) selectedComponentIds.clear();
  else {
    if (selectedId && documentItems().some((item) => item.id === selectedId)) selectedComponentIds = new Set([selectedId]);
    selectedComponentIds = new Set((documentKind === 'sketch' ? selectedSketchShapes() : selectedModelItems()).map((item) => item.id));
    selectedId = selectedComponentIds.size === 1 ? [...selectedComponentIds][0] : null;
  }
  renderList(); renderInspector();
  if (!selectedGroup() && !selectedMeasurement() && (documentKind === 'sketch' || selectedComponentIds.size > 1)) viewport.selectMany(selectedComponentIds);
  else if (selectedGroup()) viewport.selectMany(groupItems(selectedId!).map((item) => item.id));
  else viewport.select(selectedId, selectedFace);
  const componentCount = selectedComponentIds.size;
  $('#delete-box').toggleAttribute('disabled', draftDirty || (!componentCount && !selectedBox() && !selectedModelSketch() && !selectedMeasurement() && !selectedVariable && !selectedGroup()));
  $('#duplicate-box').toggleAttribute('disabled', draftDirty || (!componentCount && !selectedBox() && !selectedModelSketch() && !selectedMeasurement() && !selectedGroup()));
  $('#selection-status').textContent = selectedMeasurement() ? `SELECTED · ${measurementName(selectedMeasurement()!).toUpperCase()}` : selectedGroup() ? `GROUP · ${selectedGroup()!.name.toUpperCase()}` : componentCount > 1 ? `SELECTED · ${componentCount} COMPONENTS` : selectedVariable ? `VARIABLE · ${selectedVariable.toUpperCase()}` : selectedRectangle() ? `SELECTED · ${selectedRectangle()!.name.toUpperCase()}` : selectedModelSketch() ? `SELECTED · ${selectedModelSketch()!.name.toUpperCase()}` : selectedBox() ? `SELECTED · ${selectedBox()!.name.toUpperCase()}${selectedFace ? ` · ${faceTitle(selectedFace).toUpperCase()} FACE` : ''}` : 'NO SELECTION';
}
function computedMeasurement(expression: string | undefined, value: number): string {
  return expression && /\bvar\s*\(/.test(expression)
    ? `<span class="measure-computed">= ${formatInches(value)} in</span>`
    : '';
}

function escapeHTML(s: string) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }
function escapeAttr(s: string) { return escapeHTML(s); }
function activeDocument() { return documents.find((document) => document.id === activeDocumentId) ?? emptyDocument; }
function captureDocument() {
  const document = activeDocument();
  if (!document) return;
  Object.assign(document, structuredClone({
    groups, collapsedGroupIds: [...collapsedGroupIds], treeOrder, boxes, sketches, rectangles, measurements, variables, source: editor.value, appliedSource, draftDirty, hiddenBoxIds: [...hiddenBoxIds],
    viewMode, projectionMode, gridVisible, history, historyAt, selectedId, selectedSketchIds: documentKind === 'sketch' ? [...selectedComponentIds] : [], selectedModelIds: documentKind === 'model' ? [...selectedComponentIds] : [], selectedVariable, selectedFace,
    error: $('#editor-error').hidden ? '' : $('#editor-error').textContent ?? '',
    scrollTop: editor.scrollTop, scrollLeft: editor.scrollLeft, selectionStart: editor.selectionStart, selectionEnd: editor.selectionEnd,
  }));
}
function renderDocumentTabs() {
  const host = $('#document-tabs');
  const focused = host.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.documentId : undefined;
  const closing = host.contains(document.activeElement) && (document.activeElement as HTMLElement).classList.contains('document-close');
  host.innerHTML = openDocumentIds.map((id) => documents.find((document) => document.id === id)!).map((document) => {
    const active = document.id === activeDocumentId;
    const pending = active ? draftDirty : document.draftDirty;
    return `<div class="document-tab ${active ? 'active' : ''}"><button class="document-select" data-document-id="${escapeAttr(document.id)}" ${active ? 'aria-current="page"' : ''} title="${escapeAttr(document.name)} · ${document.kind === 'sketch' ? '2D sketch' : '3D model'}${pending ? ' · pending draft' : ''}"><span class="document-kind-mark" aria-hidden="true"><i data-lucide="${document.kind === 'sketch' ? 'square' : 'box'}"></i></span><span>${escapeHTML(document.name)}</span>${pending ? '<span class="document-draft" aria-label="Pending draft">●</span>' : ''}</button><button class="document-close" data-document-id="${escapeAttr(document.id)}" aria-label="Close ${escapeAttr(document.name)}" title="Close file">×</button></div>`;
  }).join('');
  renderIcons(host);
  host.querySelectorAll<HTMLButtonElement>('.document-select').forEach((button) => { button.addEventListener('click', () => switchDocument(button.dataset.documentId!)); button.addEventListener('dblclick', () => renameTab(button.dataset.documentId!)); });
  host.querySelectorAll<HTMLButtonElement>('.document-close').forEach((button) => { button.addEventListener('click', () => closeDocument(button.dataset.documentId!)); button.addEventListener('contextmenu', (event) => { event.preventDefault(); showCloseDocumentDialog(button.dataset.documentId!); }); });
  if (focused) Array.from(host.querySelectorAll<HTMLButtonElement>(closing ? '.document-close' : '.document-select')).find((button) => button.dataset.documentId === focused)?.focus();
}
function loadDocument(document: ModelDocument) {
  // A worker from the previous tab must never apply its result to this tab.
  runEpoch++;
  $('#run-code').toggleAttribute('disabled', false);
  closeFaceMenu(); closeFaceColorPicker();
  activeDocumentId = document.id;
  if (documents.includes(document) && !openDocumentIds.includes(document.id)) openDocumentIds.push(document.id);
  const empty = !openDocumentIds.length;
  $('#empty-workspace').hidden = !empty;
  $('.workspace').toggleAttribute('inert', empty);
  $('#download').toggleAttribute('disabled', empty);
  $('#source-name').toggleAttribute('disabled', empty);
  groups = structuredClone(document.groups); collapsedGroupIds = new Set(document.collapsedGroupIds); treeOrder = [...document.treeOrder];
  documentKind = document.kind; boxes = cloneBoxes(document.boxes); sketches = structuredClone(document.sketches); rectangles = cloneRectangles(document.rectangles); variables = cloneVariables(document.variables);
  sketches = structuredClone(document.sketches ?? []); measurements = structuredClone(document.measurements ?? []); measuring = false;
  sketchTool = 'select';
  appliedSource = document.appliedSource; hiddenBoxIds = new Set(document.hiddenBoxIds);
  history = structuredClone(document.history); historyAt = document.historyAt;
  selectedId = document.selectedId; selectedComponentIds = new Set((documentKind === 'sketch' ? document.selectedSketchIds : document.selectedModelIds) ?? (selectedId ? [selectedId] : [])); selectedVariable = document.selectedVariable; selectedFace = document.selectedFace;
  relativeOpenBoxId = null; relativeOpen = true;
  viewMode = documentKind === 'sketch' ? 'top' : document.viewMode; projectionMode = documentKind === 'sketch' ? 'orthographic' : document.projectionMode; gridVisible = document.gridVisible;
  root.classList.toggle('sketch-mode', documentKind === 'sketch');
  root.classList.toggle('model-mode', documentKind === 'model');
  viewport.setMode(documentKind);
  if (documentKind === 'sketch') viewport.setRectangles(worldRectangles(), { hiddenIds: sceneHiddenIds() }); else viewport.setBoxes(worldBoxes(), { hiddenIds: sceneHiddenIds(), sketches: worldSketches() });
  viewport.setMeasurements(measurements);
  viewport.setProjection(projectionMode); viewport.setView(viewMode); viewport.setGrid(gridVisible);
  root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === viewMode));
  $('#projection').textContent = projectionMode.toUpperCase(); $('#grid-toggle').classList.toggle('active', gridVisible);
  $('#source-name').textContent = document.name;
  $('.sidebar > .panel-heading .eyebrow').textContent = documentKind === 'sketch' ? 'SKETCH TREE' : 'MODEL TREE';
  viewportHost.setAttribute('aria-label', documentKind === 'sketch' ? '2D sketch viewport' : '3D model viewport');
  $('#fit').setAttribute('title', documentKind === 'sketch' ? 'Fit sketch (F)' : 'Fit model (F)');
  renderSketchToolUI();
  $('#add-box').setAttribute('title', documentKind === 'sketch' ? 'Add rectangle' : 'Add box');
  $('#tree-empty').querySelector('small')!.textContent = documentKind === 'sketch' ? 'Draw a line, rectangle or circle, or run sketch code.' : 'Add a box or cylinder, or run some model code.';
  $('.tree-footer').querySelector('span:last-child')!.textContent = 'Drag to reorder or add to a group.';
  $('#reset-code').textContent = documentKind === 'sketch' ? 'Reset sketch' : 'Reset example';
  $('#source-editor').setAttribute('aria-label', documentKind === 'sketch' ? 'JavaScript sketch source' : 'JavaScript model source');
  setEditor(document.source, document.draftDirty);
  editor.setSelectionRange(document.selectionStart, document.selectionEnd);
  editor.scrollTop = document.scrollTop; editor.scrollLeft = document.scrollLeft; $('#line-numbers').scrollTop = editor.scrollTop;
  $('#editor-error').textContent = document.error; $('#editor-error').hidden = !document.error;
  renderAll();
  Array.from($('#document-tabs').querySelectorAll<HTMLButtonElement>('.document-select')).find((button) => button.dataset.documentId === document.id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  setStatus(document.error ? 'Source has errors · last good work kept' : draftDirty ? `Loaded ${document.name} · press Run` : `Ready · ${shapeCount()} ${shapeLabel()}`, !!document.error);
}
function switchDocument(id: string) {
  if (id === activeDocumentId) return;
  const document = documents.find((item) => item.id === id);
  if (!document) return;
  captureDocument(); loadDocument(document); scheduleSave();
}
function closeDocument(id: string) {
  removeDocument(id);
}
function showCloseDocumentDialog(id: string) {
  captureDocument();
  const document = documents.find((item) => item.id === id);
  if (!document) return;
  pendingCloseDocumentId = id;
  $('#close-document-name').textContent = document.name;
  $('#close-document-draft').hidden = !document.draftDirty;
  const dialog = $('#close-document-dialog') as HTMLDialogElement;
  dialog.returnValue = 'cancel';
  dialog.showModal();
  $('#close-document-cancel').focus();
}
function removeDocument(id: string) {
  captureDocument();
  const index = openDocumentIds.indexOf(id);
  if (index < 0) return;
  openDocumentIds.splice(index, 1);
  if (id === activeDocumentId) loadDocument(documents.find((doc) => doc.id === openDocumentIds[Math.min(index, openDocumentIds.length - 1)]) ?? emptyDocument);
  else renderDocumentTabs();
  scheduleSave();
}
function downloadSource(source: string, filename: string) {
  const blob = new Blob([source], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
let savingDocument = false;
async function saveDocument(modelDocument: ModelDocument): Promise<boolean> {
  if (savingDocument || !documents.includes(modelDocument)) return false;
  savingDocument = true;
  $('#download').toggleAttribute('disabled', true);
  $('#close-document-save').toggleAttribute('disabled', true);
  try {
    const pickerWindow = window as Window & { showSaveFilePicker?: SaveFilePicker };
    const result = await saveDocumentFile(modelDocument, {
      pickFile: typeof pickerWindow.showSaveFilePicker === 'function' ? pickerWindow.showSaveFilePicker.bind(window) : undefined,
      download: downloadSource,
    });
    if (!result) return false;
    if (modelDocument.id === activeDocumentId) $('#source-name').textContent = modelDocument.name;
    renderDocumentTabs(); void saveWorkspace();
    notify(result === 'saved' ? `Exported ${modelDocument.name}.js` : `Export requested · ${modelDocument.name}.js`);
    return true;
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Could not save file', true);
    return false;
  } finally {
    savingDocument = false;
    $('#download').toggleAttribute('disabled', !openDocumentIds.length);
    $('#close-document-save').toggleAttribute('disabled', false);
  }
}
const closeDocumentDialog = $('#close-document-dialog') as HTMLDialogElement;
closeDocumentDialog.addEventListener('cancel', () => { closeDocumentDialog.returnValue = 'cancel'; });
$('#close-document-save').addEventListener('click', async () => {
  captureDocument();
  const modelDocument = documents.find((item) => item.id === pendingCloseDocumentId);
  if (!modelDocument) return closeDocumentDialog.close('cancel');
  if (await saveDocument(modelDocument) && closeDocumentDialog.open && pendingCloseDocumentId === modelDocument.id) closeDocumentDialog.close('close');
});
closeDocumentDialog.addEventListener('close', () => {
  const id = pendingCloseDocumentId;
  pendingCloseDocumentId = null;
  if (!id || closeDocumentDialog.returnValue !== 'close') return;
  removeDocument(id);
});
function libraryState(): LibraryState {
  return { documents, folders, workspace: { openIds: [...openDocumentIds], activeId: openDocumentIds.includes(activeDocumentId) ? activeDocumentId : '', preferences: { measurementsThroughObjects } } };
}
async function saveWorkspace(): Promise<boolean> {
  if (!storageReady) return false;
  window.clearTimeout(saveTimer);
  captureDocument();
  const generation = ++persistenceGeneration;
  $('#save-state').textContent = 'Saving…';
  try {
    if (!library) throw new Error('Browser storage is unavailable. Export files or back up the library to keep your work.');
    const state = libraryState();
    await library.save(state.documents, state.folders, state.workspace);
    if (generation === persistenceGeneration) $('#save-state').textContent = 'Saved locally';
    return true;
  } catch (error) {
    if (generation === persistenceGeneration) $('#save-state').textContent = 'Not saved';
    notify(error instanceof Error ? error.message : 'Could not save to browser storage. Back up your work.', true);
    return false;
  }
}
function scheduleSave() {
  if (!storageReady) return;
  persistenceGeneration++;
  $('#save-state').textContent = 'Saving…'; window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveWorkspace(), 350);
}
function renameTab(id: string) {
  const doc = documents.find((doc) => doc.id === id);
  if (doc) fileManager.rename(id, doc.name);
}
async function persistLibraryChange(nextDocuments: ModelDocument[], nextFolders: Folder[], nextOpenIds = openDocumentIds) {
  if (!library) throw new Error('Browser storage is unavailable. Export or back up your work.');
  validateLibrary(nextDocuments, nextFolders);
  window.clearTimeout(saveTimer); captureDocument();
  const generation = ++persistenceGeneration;
  $('#save-state').textContent = 'Saving…';
  const nextActive = nextOpenIds.includes(activeDocumentId) ? activeDocumentId : nextOpenIds[0] ?? '';
  try { await library.save(nextDocuments, nextFolders, { openIds: nextOpenIds, activeId: nextActive, preferences: { measurementsThroughObjects } }); }
  catch (error) { if (generation === persistenceGeneration) $('#save-state').textContent = 'Not saved'; throw error; }
  documents = nextDocuments; folders = nextFolders; openDocumentIds = [...nextOpenIds];
  if (!documents.some((doc) => doc.id === activeDocumentId && openDocumentIds.includes(doc.id))) loadDocument(documents.find((doc) => doc.id === nextActive) ?? emptyDocument);
  else { $('#source-name').textContent = activeDocument().name; renderDocumentTabs(); renderInspector(); }
  if (generation === persistenceGeneration) $('#save-state').textContent = 'Saved locally';
}
const fileManager = createFileManager(root, {
  state: () => { captureDocument(); return libraryState(); },
  open: (id) => switchDocument(id),
  async rename(id, value) {
    captureDocument();
    const name = fileName(value);
    const nextDocuments = documents.map((doc) => doc.id === id ? { ...doc, name } : doc);
    const nextFolders = folders.map((folder) => folder.id === id ? { ...folder, name } : folder);
    await persistLibraryChange(nextDocuments, nextFolders);
    const renamed = documents.find((doc) => doc.id === id);
    if (renamed?.kind === 'sketch') { synchronizeSketchReferences(documents, renamed); if (openDocumentIds.length) loadDocument(activeDocument()); scheduleSave(); }
  },
  async move(id, parentId) {
    captureDocument();
    await persistLibraryChange(documents.map((doc) => doc.id === id ? { ...doc, parentId } : doc), folders.map((folder) => folder.id === id ? { ...folder, parentId } : folder));
  },
  async remove(id) {
    captureDocument();
    if ([...folders, ...documents].some((entry) => entry.parentId === id)) throw new Error('Move or delete the folder’s contents first.');
    const nextDocuments = documents.filter((doc) => doc.id !== id).map((doc) => doc.sketchTargets?.some((target) => target.documentId === id) ? { ...doc, sketchTargets: doc.sketchTargets.filter((target) => target.documentId !== id) } : doc);
    await persistLibraryChange(nextDocuments, folders.filter((folder) => folder.id !== id), openDocumentIds.filter((openId) => openId !== id));
  },
  async createFolder(parentId, name) { await persistLibraryChange(documents, [...folders, { id: crypto.randomUUID(), parentId, name: fileName(name) }]); },
  createFile: (parentId) => { void newTab(parentId); },
  importFiles: (parentId) => { importParentId = parentId; ($('#file-input') as HTMLInputElement).click(); },
  backup: () => { captureDocument(); downloadData(exportLibrary(libraryState()), 'blockwork-library.json', 'application/json'); },
  restore: () => ($('#backup-input') as HTMLInputElement).click(),
});
$('#files').addEventListener('click', () => fileManager.open());
$('#source-name').addEventListener('click', () => renameTab(activeDocumentId));
function downloadData(source: string | ArrayBuffer, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([source], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
$('#backup-input').addEventListener('change', async (event) => {
  const input = event.currentTarget as HTMLInputElement; const file = input.files?.[0]; input.value = '';
  if (!file) return;
  try {
    const restored = restoreLibrary(await file.text());
    if (!window.confirm('Replace your browser library with this backup? Back up the current library first if you want to keep it.')) return;
    if (!library) throw new Error('Browser storage is unavailable.');
    window.clearTimeout(saveTimer); captureDocument();
    await library.save(restored.documents, restored.folders, restored.workspace);
    documents = restored.documents; folders = restored.folders; openDocumentIds = restored.workspace.openIds;
    measurementsThroughObjects = restored.workspace.preferences.measurementsThroughObjects; syncMeasurementThroughPreference();
    loadDocument(documents.find((doc) => doc.id === restored.workspace.activeId) ?? emptyDocument);
    $('#save-state').textContent = 'Saved locally'; notify('Library restored');
  } catch (error) { notify(error instanceof Error ? error.message : 'Could not restore backup.', true); }
});
function cloneVariables(value: VariableSpec[]) { return value.map((item) => ({ ...item })); }
function recordAfterChange(source = editor.value) { treeOrder = normalizeTreeOrder(treeOrder, groups, objectItems()); history = history.slice(0, historyAt + 1); history.push({ groups: structuredClone(groups), treeOrder: [...treeOrder], boxes: cloneBoxes(boxes), sketches: structuredClone(sketches), measurements: structuredClone(measurements), rectangles: cloneRectangles(rectangles), variables: cloneVariables(variables), source, hiddenIds: [...hiddenBoxIds] }); historyAt = history.length - 1; if (history.length > 80) { history.shift(); historyAt--; } syncLinkedSketches(); }
function syncLinkedSketches() {
  if (documentKind !== 'sketch') return;
  captureDocument();
  try { synchronizeSketchReferences(documents, activeDocument()); }
  catch (error) { notify(error instanceof Error ? `Model reference unchanged: ${error.message}` : 'Could not update the linked model sketch', true); }
}
function commitRectangles(next: SketchShape[], message: string, options?: { preserveView?: boolean }) {
  rectangles = cloneRectangles(validateSketchShapes(next, groups));
  measurements = pruneMeasurements(measurements, currentMeasurementGeometry());
  hiddenBoxIds = new Set([...hiddenBoxIds].filter(sceneHasId));
  if ((!selectedGroup() && !objectItems().some((rectangle) => rectangle.id === selectedId)) || (!selectedGroup() && sceneHiddenIds().has(selectedId!))) selectedId = null;
  viewport.setRectangles(worldRectangles(), { ...options, hiddenIds: sceneHiddenIds() });
  viewport.setMeasurements(measurements);
  const source = generateSketchSource(rectangles, groups, treeOrder, measurements); setEditor(source); appliedSource = source;
  recordAfterChange(); renderAll(); setStatus(message); scheduleSave();
}
function updateRectangle(id: string, patch: Partial<SketchShape>) {
  if (draftDirty) return notify('Run or discard the source draft before editing rectangles.', true);
  try { commitRectangles(rectangles.map((rectangle) => rectangle.id === id ? { ...rectangle, ...patch } : rectangle), 'Sketch shape updated', { preserveView: true }); }
  catch (error) { notify(error instanceof Error ? error.message : 'Could not update rectangle', true); renderInspector(); }
}
function commitBoxes(next: BoxSpec[], message: string, options?: { preserveView?: boolean }, nextVariables = variables, nextSketches = sketches, inputMeasurements = measurements) {
  const nextMeasurements = pruneMeasurements(inputMeasurements, { boxes: next, sketches: nextSketches });
  const resolved = resolveModel(next, nextVariables, groups, nextSketches, nextMeasurements);
  const source = generateSource(resolved.boxes, resolved.variables, groups, treeOrder, resolved.sketches ?? [], nextMeasurements);
  measurements = nextMeasurements;
  boxes = cloneBoxes(resolved.boxes); sketches = structuredClone(resolved.sketches ?? []); variables = cloneVariables(resolved.variables); hiddenBoxIds = new Set([...hiddenBoxIds].filter(sceneHasId)); selectedId = (selectedGroup() || objectItems().some((b) => b.id === selectedId)) && (selectedGroup() || !sceneHiddenIds().has(selectedId!)) ? selectedId : null;
  if (!selectedId) selectedFace = null;
  viewport.setBoxes(worldBoxes(), { ...options, hiddenIds: sceneHiddenIds(), sketches: worldSketches() }); viewport.setMeasurements(measurements); setEditor(source); appliedSource = editor.value; recordAfterChange(); renderAll(); setStatus(message); scheduleSave();
}
function toggleBoxVisibility(id: string) {
  if (draftDirty || !sceneHasId(id)) return;
  const group = groups.find((g) => g.id === id);
  const parentId = group ? group.parentId : objectItems().find((item) => item.id === id)?.groupId;
  if (parentId && sceneHiddenIds().has(parentId)) return;
  const hidden = hiddenBoxIds.has(id);
  if (hidden) hiddenBoxIds.delete(id); else hiddenBoxIds.add(id);
  if (!hidden && selectedId === id && !group) { selectedId = null; selectedFace = null; }
  const hiddenIds = sceneHiddenIds();
  viewport.setVisibility(objectItems().filter((item) => !hiddenIds.has(item.id)).map((item) => item.id), true);
  viewport.setVisibility(objectItems().filter((item) => hiddenIds.has(item.id)).map((item) => item.id), false);
  recordAfterChange(); renderAll(); setStatus(`${group ? 'Group' : 'Component'} ${hidden ? 'shown' : 'hidden'}`); scheduleSave();
}
function updateBox(id: string, patch: Partial<BoxSpec>) {
  if (draftDirty) return notify('Run or discard the source draft before editing boxes.', true);
  const current = boxes.find((b) => b.id === id); if (!current) return;
  try { commitBoxes(boxes.map((b) => b.id === id ? { ...b, ...patch } : b), 'Box updated', { preserveView: true }); }
  catch (err) { notify(err instanceof Error ? err.message : 'Could not update box', true); renderInspector(); }
}
function duplicateModelSelection() {
  const ids = new Map(selectedModelItems().map((item) => [item.id, crypto.randomUUID()]));
  const copies = boxes.filter((box) => ids.has(box.id)).map((box) => {
    const copy = structuredClone(box);
    copy.id = ids.get(box.id)!; copy.name = `${box.name} copy`;
    copy.position = [box.position[0] + 1, box.position[1] + 1, box.position[2]];
    if (copy.relative) copy.relative.boxId = ids.get(copy.relative.boxId) ?? copy.relative.boxId;
    return copy;
  });
  const sketchCopies = sketches.filter((sketch) => ids.has(sketch.id)).map((sketch): ModelSketch => ({
    ...structuredClone(sketch), id: ids.get(sketch.id)!, name: `${sketch.name} copy`,
    position: [sketch.position[0] + 1, sketch.position[1] + 1, sketch.position[2]],
  }));
  try {
    commitBoxes([...boxes, ...copies], `${ids.size} components duplicated`, { preserveView: true }, variables, [...sketches, ...sketchCopies]);
    for (const [originalId, copyId] of ids) {
      const linked = findSketchEditor(documents, activeDocumentId, originalId);
      const target = linked?.sketchTargets?.find((target) => target.documentId === activeDocumentId && target.sketchId === originalId);
      if (linked && target) linkSketchEditor(documents, activeDocumentId, copyId, linked.id, target.origin);
    }
    selectModelItems([...ids.values()], 'replace');
  } catch (error) { notify(error instanceof Error ? error.message : 'Could not duplicate components', true); }
}
function openCylinderDialog(placement?: { boxId: string; face: FaceName }) {
  if (documentKind !== 'model' || draftDirty) return;
  activateMeasurementTool(false);
  cylinderFacePlacement = placement ?? null;
  const parent = placement ? boxes.find((box) => box.id === placement.boxId) : undefined;
  if (placement && !parent) return;
  const initial = parent && placement ? createCylinderFromFace(parent, placement.face, crypto.randomUUID(), groups) : undefined;
  const frame = cylinderAxes(initial ?? {});
  $('#cylinder-dialog-title').textContent = placement ? `New cylinder from ${faceTitle(placement.face)} face` : 'Add cylinder';
  ($('#cylinder-radius') as HTMLInputElement).value = initial ? formatInches(initial.size[frame.radialAxes[0]] / 2) : '1';
  ($('#cylinder-length') as HTMLInputElement).value = initial ? formatInches(initial.size[frame.lengthAxis]) : '2';
  ($('#cylinder-axis') as HTMLSelectElement).value = initial?.axis ?? 'z';
  $('#cylinder-error').textContent = '';
  ($('#cylinder-dialog') as HTMLDialogElement).showModal();
  ($('#cylinder-radius') as HTMLInputElement).select();
}

function addBox(duplicate = false) {
  if (draftDirty) return;
  if (duplicate && documentKind === 'model' && selectedModelItems().length > 1) {
    duplicateModelSelection(); return;
  }
  const group = selectedGroup();
  if (duplicate && group) { duplicateGroup(group); return; }
  const measurement = selectedMeasurement();
  if (duplicate && measurement) {
    const copy = { ...structuredClone(measurement), id: crypto.randomUUID(), name: `${measurementName(measurement)} copy` };
    commitMeasurements([...measurements, copy], 'Measurement duplicated'); selectedId = copy.id; renderAll(); return;
  }
  const mounted = selectedModelSketch();
  if (duplicate && mounted) {
    const linked = findSketchEditor(documents, activeDocumentId, mounted.id);
    const target = linked?.sketchTargets?.find((target) => target.documentId === activeDocumentId && target.sketchId === mounted.id);
    const copy: ModelSketch = { ...structuredClone(mounted), id: crypto.randomUUID(), name: `${mounted.name} copy`, position: [mounted.position[0] + 1, mounted.position[1] + 1, mounted.position[2]] };
    commitBoxes(boxes, 'Sketch duplicated', { preserveView: true }, variables, [...sketches, copy]);
    if (linked && target) linkSketchEditor(documents, activeDocumentId, copy.id, linked.id, target.origin);
    selectedId = copy.id; selectedFace = null; renderAll(); return;
  }
  if (documentKind === 'sketch') {
    if (!duplicate) { activateSketchTool('rectangle'); return; }
    if (duplicate && selectedSketchShapes().length > 1) {
      const copies = selectedSketchShapes().map((shape) => ({ ...shape, id: crypto.randomUUID(), name: `${shape.name} copy`, size: [...shape.size] as [number, number], position: [shape.position[0] + 1, shape.position[1] + 1] as [number, number] }));
      commitRectangles([...rectangles, ...copies], `${copies.length} sketch shapes duplicated`, { preserveView: true });
      selectSketchShapes(copies.map((shape) => shape.id), 'replace'); return;
    }
    const base = duplicate ? selectedRectangle() : null;
    if (duplicate && !base) return;
    const rectangle: SketchShape = base ? { ...base, id: crypto.randomUUID(), name: `${base.name} copy`, size: [...base.size], position: [base.position[0] + 1, base.position[1] + 1] } : { id: crypto.randomUUID(), name: `Rectangle ${rectangles.length + 1}`, size: [3, 2], position: [0, 0], color: SKETCH_DEFAULT_COLOR };
    try { commitRectangles([...rectangles, rectangle], base ? 'Rectangle duplicated' : 'Rectangle added', { preserveView: duplicate }); selectedId = rectangle.id; renderAll(); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not add rectangle', true); }
    return;
  }
  const base = duplicate ? selectedBox() : null;
  if (duplicate && !base) return;
  const box: BoxSpec = base ? { ...base, expressions: base.expressions ? { ...base.expressions } : undefined, relative: base.relative ? { ...base.relative, u: base.relative.u ? { ...base.relative.u } : undefined, v: base.relative.v ? { ...base.relative.v } : undefined } : undefined, id: crypto.randomUUID(), name: `${base.name} copy`, position: [base.position[0] + 1, base.position[1] + 1, base.position[2]] } : { id: crypto.randomUUID(), name: `Box ${boxes.length + 1}`, size: [2, 2, 2], position: [0, 0, 0], color: PALETTE[boxes.length % PALETTE.length] };
  if (!base && selectedGroup()) box.groupId = selectedGroup()!.id;
  try { commitBoxes([...boxes, box], base ? 'Box duplicated' : 'Box added', { preserveView: duplicate }); selectedId = box.id; selectedVariable = null; renderAll(); }
  catch (err) { notify(err instanceof Error ? err.message : 'Could not add box', true); }
}
function deleteBox() {
  if (draftDirty) return;
  if (selectedMeasurement()) { commitMeasurements(measurements.filter((m) => m.id !== selectedId), 'Measurement deleted'); return; }
  if (selectedGroup()) { ungroup(selectedGroup()!); return; }
  if (documentKind === 'sketch') { const ids = new Set(selectedSketchShapes().map((shape) => shape.id)); if (ids.size) commitRectangles(rectangles.filter((shape) => !ids.has(shape.id)), ids.size === 1 ? 'Sketch shape deleted' : `${ids.size} sketch shapes deleted`, { preserveView: true }); return; }
  if (selectedVariable) { deleteVariable(selectedVariable); return; }
  const ids = new Set(selectedModelItems().map((item) => item.id));
  if (!ids.size) return;
  try { const next = boxes.filter((b) => !ids.has(b.id)).map((b) => { if (!b.relative || !ids.has(b.relative.boxId)) return b; const expressions = { ...(b.expressions ?? {}) }; delete expressions['relative.offset']; delete expressions['relative.u.offset']; delete expressions['relative.v.offset']; delete expressions['position.0']; delete expressions['position.1']; delete expressions['position.2']; return { ...b, relative: undefined, expressions }; }); commitBoxes(next, `${ids.size} ${ids.size === 1 ? 'component' : 'components'} deleted`, { preserveView: true }, variables, sketches.filter((sketch) => !ids.has(sketch.id))); }
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
    const next = removeVariable(boxes, variables, name, groups);
    commitBoxes(next.boxes, 'Variable deleted · references replaced', { preserveView: true }, next.variables); selectedVariable = null; renderAll();
  }
  catch (error) { notify(error instanceof Error ? error.message : 'Could not delete variable', true); }
}
function createFromFace() {
  const hit = contextFace; closeFaceMenu();
  if (draftDirty || !hit) return;
  const parent = boxes.find((box) => box.id === hit.boxId); if (!parent) return;
  try {
    const child = createBoxFromFace(parent, hit.face, crypto.randomUUID(), groups);
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
    const compiled = documentKind === 'sketch' ? await compileModel(source, 'sketch') : await compileModel(source, 'model');
    if (epoch !== runEpoch) return;
    const hasNewerDraft = editor.value !== source;
    let resolvedSource = source;
    if (documentKind === 'sketch') {
      const sketch = compiled as CompiledSketch; measurements = structuredClone(sketch.measurements); groups = structuredClone(sketch.groups); rectangles = cloneRectangles(sketch.rectangles);
      hiddenBoxIds = new Set([...hiddenBoxIds].filter(sceneHasId));
      viewport.setRectangles(worldRectangles(), { hiddenIds: sceneHiddenIds() });
    } else {
      const model = compiled as { boxes: BoxSpec[]; sketches?: ModelSketch[]; variables: VariableSpec[]; groups?: GroupSpec[]; measurements?: Measurement[] };
      const nextGroups = structuredClone(model.groups ?? []);
      const nextSketches = resolveLinkedSketches(documents, activeDocumentId, model.sketches ?? []);
      const nextMeasurements = pruneMeasurements(structuredClone(model.measurements ?? []), { boxes: model.boxes, sketches: nextSketches });
      const nextModel = resolveModel(model.boxes, model.variables, nextGroups, nextSketches, nextMeasurements);
      if (JSON.stringify(nextSketches) !== JSON.stringify(model.sketches ?? [])) resolvedSource = generateSource(nextModel.boxes, nextModel.variables, nextGroups, treeOrder, nextModel.sketches, nextMeasurements);
      measurements = nextMeasurements; groups = nextGroups;
      sketches = structuredClone(nextModel.sketches ?? []); boxes = cloneBoxes(nextModel.boxes); variables = cloneVariables(nextModel.variables);
      hiddenBoxIds = new Set([...hiddenBoxIds].filter(sceneHasId));
      viewport.setBoxes(worldBoxes(), { hiddenIds: sceneHiddenIds(), sketches: worldSketches() });
    }
    viewport.setMeasurements(measurements);
    selectedId = null; selectedComponentIds.clear(); selectedVariable = null; selectedFace = null; viewport.fit();
    appliedSource = resolvedSource; recordAfterChange(resolvedSource);
    if (!hasNewerDraft) setEditor(resolvedSource); else { draftDirty = true; syncDraftUI(); }
    renderAll(); setStatus(!hasNewerDraft ? `Updated · ${shapeCount()} ${shapeLabel()}${documentKind === 'model' ? ` · ${variables.length} variables` : ''}` : 'Updated · newer source draft retained'); scheduleSave();
  } catch (err) {
    if (epoch !== runEpoch) return;
    const message = err instanceof Error ? err.message : 'Could not compile source'; const errorEl = $('#editor-error'); errorEl.textContent = message; errorEl.hidden = false; setStatus('Source has errors · last good work kept', true); notify('Work unchanged. Fix the source error and run again.', true); scheduleSave();
  } finally { if (epoch === runEpoch) $('#run-code').toggleAttribute('disabled', false); }
}
function undoRedo(delta: number) {
  if (draftDirty) return notify('Run or discard the source draft before undoing.', true);
  const next = historyAt + delta; if (next < 0 || next >= history.length) return;
  const snapshot = history[next], geometry = resolveSnapshot(snapshot, documentKind);
  historyAt = next; groups = structuredClone(geometry.groups); treeOrder = [...geometry.treeOrder];
  collapsedGroupIds = new Set([...collapsedGroupIds].filter((id) => groups.some((g) => g.id === id)));
  variables = cloneVariables(geometry.variables); boxes = cloneBoxes(geometry.boxes); sketches = structuredClone(geometry.sketches); rectangles = cloneRectangles(geometry.rectangles); measurements = structuredClone(geometry.measurements);
  hiddenBoxIds = new Set((snapshot.hiddenIds ?? []).filter(sceneHasId));
  appliedSource = snapshot.source; selectedId = null; selectedComponentIds.clear(); selectedVariable = null; selectedFace = null;
  refreshGeometry(); setEditor(snapshot.source); syncLinkedSketches(); renderAll(); setStatus(delta < 0 ? 'Undo' : 'Redo'); scheduleSave();
}

function syncMeasurementThroughPreference() {
  viewport.setMeasurementsThroughObjects(measurementsThroughObjects);
  const button = $('#measurement-through-toggle');
  button.classList.toggle('active', measurementsThroughObjects);
  button.setAttribute('aria-pressed', String(measurementsThroughObjects));
  button.innerHTML = `<i data-lucide="ruler" aria-hidden="true"></i> ${measurementsThroughObjects ? 'THROUGH' : 'OCCLUDED'}`;
  renderIcons(button);
}
root.querySelectorAll('[data-measure-tool]').forEach((button) => button.addEventListener('click', () => activateMeasurementTool(!measuring)));
$('#measurement-through-toggle').addEventListener('click', () => {
  measurementsThroughObjects = !measurementsThroughObjects;
  syncMeasurementThroughPreference();
  scheduleSave();
});
$('#new-measurement-axis').addEventListener('change', (event) => { measurementAxis = (event.currentTarget as HTMLSelectElement).value as MeasurementAxisChoice; viewport.setMeasurementAxis(measurementAxis); });
$('#add-group').addEventListener('click', addGroup);
$('#add-sketch-group').addEventListener('click', addGroup);
$('#add-box').addEventListener('click', () => addBox());
$('#add-model-sketch').addEventListener('click', () => {
  if (draftDirty || documentKind !== 'model') return;
  const sketch: ModelSketch = { id: crypto.randomUUID(), name: `Sketch ${sketches.length + 1}`, axis: 'z', size: [12, 8], position: [0, 0, 0], color: '#86a9a3', shapes: [], ...(selectedGroup() ? { groupId: selectedGroup()!.id } : {}) };
  commitBoxes(boxes, 'Sketch added · choose its plane and contents in the inspector', undefined, variables, [...sketches, sketch]); selectedId = sketch.id; selectedVariable = null; selectedFace = null; renderAll();
});
$('#select-sketch-tool').addEventListener('click', () => activateSketchTool('select'));
$('#rectangle-sketch-tool').addEventListener('click', () => activateSketchTool('rectangle'));
$('#line-sketch-tool').addEventListener('click', () => activateSketchTool('line'));
$('#circle-sketch-tool').addEventListener('click', () => activateSketchTool('circle'));
$('#add-cylinder').addEventListener('click', () => openCylinderDialog());
$('#cylinder-dialog').addEventListener('close', () => { cylinderFacePlacement = null; });
$('#cylinder-cancel').addEventListener('click', () => ($('#cylinder-dialog') as HTMLDialogElement).close());
$('#cylinder-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (documentKind !== 'model' || draftDirty) return;
  try {
    const radiusText = ($('#cylinder-radius') as HTMLInputElement).value;
    const lengthText = ($('#cylinder-length') as HTMLInputElement).value;
    const axis = ($('#cylinder-axis') as HTMLSelectElement).value as CylinderAxis;
    const values = Object.fromEntries(variables.map((variable) => [variable.name, variable.value]));
    const radius = parseInches(radiusText, values), length = parseInches(lengthText, values);
    if (radius <= 0 || length <= 0) throw new Error('Radius and length must be positive.');
    const expressions: Partial<Record<NumericField, string>> = {};
    if (/\bvar\s*\(/.test(radiusText)) expressions.radius = radiusText;
    const placement = cylinderFacePlacement;
    const parent = placement ? boxes.find((box) => box.id === placement.boxId) : undefined;
    if (placement && !parent) throw new Error('The reference component is no longer available.');
    const cylinder: BoxSpec = parent && placement
      ? reorientCylinder(createCylinderFromFace(parent, placement.face, crypto.randomUUID(), groups, { radius, length }), axis)
      : { id: crypto.randomUUID(), name: `Cylinder ${boxes.length + 1}`, kind: 'cylinder', ...(axis !== 'z' ? { axis } : {}), size: cylinderSize(radius, length, axis), position: [0, 0, 0], color: PALETTE[boxes.length % PALETTE.length], ...(selectedGroup() ? { groupId: selectedGroup()!.id } : {}) };
    if (/\bvar\s*\(/.test(lengthText)) expressions[`size.${cylinderAxes(cylinder).lengthAxis}` as NumericField] = lengthText;
    cylinder.expressions = expressions; cylinder.color = PALETTE[boxes.length % PALETTE.length];
    commitBoxes([...boxes, cylinder], placement ? 'Cylinder created from face' : 'Cylinder added', { preserveView: !!placement });
    selectedId = cylinder.id; selectedComponentIds.clear(); selectedVariable = null; selectedFace = null;
    ($('#cylinder-dialog') as HTMLDialogElement).close();
    renderAll();
  } catch (error) { $('#cylinder-error').textContent = error instanceof Error ? error.message : 'Could not add cylinder.'; }
});
$('#add-variable').addEventListener('click', () => void addVariable());
$('#delete-box').addEventListener('click', deleteBox);
$('#duplicate-box').addEventListener('click', () => addBox(true));
$('#duplicate-from-menu').addEventListener('click', duplicateFromMenu);
$('#new-from-face').addEventListener('click', createFromFace);
$('#new-cylinder-from-face').addEventListener('click', () => {
  const hit = contextFace; closeFaceMenu();
  if (!draftDirty && hit) openCylinderDialog({ boxId: hit.boxId, face: hit.face });
});
$('#remove-group-member').addEventListener('click', () => {
  const id = contextGroupMemberId;
  closeGroupMemberMenu(true);
  if (id) changeItemGroup(id, undefined);
});
document.addEventListener('pointerdown', (event) => {
  const target = event.target as Node;
  if (!$('#face-menu').hidden && !$('#face-menu').contains(target)) closeFaceMenu();
  if (!$('#group-member-menu').hidden && !$('#group-member-menu').contains(target)) closeGroupMemberMenu();
});
document.addEventListener('scroll', () => closeGroupMemberMenu(), true);
window.addEventListener('resize', () => { closeFaceMenu(); closeGroupMemberMenu(); closeFaceColorPicker(); });
$('#run-code').addEventListener('click', runSource);
$('#reset-code').addEventListener('click', () => { if (draftDirty && !window.confirm('Discard this unrun source draft and reset?')) return; setEditor(documentKind === 'sketch' ? generateSketchSource([]) : DEFAULT_SOURCE, true); void runSource(); });
function chooseDocumentKind(title: string, allowOpenExisting = false): Promise<DocumentKind | null> {
  const dialog = $('#document-kind-dialog') as HTMLDialogElement;
  $('#document-open-group').hidden = !allowOpenExisting;
  $('#document-kind-dialog .eyebrow').textContent = allowOpenExisting ? 'FILES' : 'OPEN FILE';
  $('#document-kind-title').textContent = title;
  $('#document-model-label').textContent = allowOpenExisting ? 'New 3D model' : '3D model';
  $('#document-sketch-label').textContent = allowOpenExisting ? 'New 2D sketch' : '2D sketch';
  dialog.returnValue = 'cancel'; dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'model' || dialog.returnValue === 'sketch' ? dialog.returnValue : null), { once: true }));
}
async function newTab(parentId: string | null = null) {
  importParentId = parentId;
  const kind = await chooseDocumentKind('Open or create a file', true);
  if (!kind) return;
  captureDocument();
  const document = createBlankDocument(documents.filter((doc) => doc.parentId === parentId), kind);
  document.parentId = parentId;
  document.name = uniqueFileName(document.name, siblingNames(documents, folders, parentId));
  documents.push(document);
  loadDocument(document);
  scheduleSave();
  editor.focus();
}
$('#new-tab').addEventListener('click', () => void newTab());
$('#open-existing-file').addEventListener('click', () => {
  ($('#document-kind-dialog') as HTMLDialogElement).close('cancel');
  ($('#file-input') as HTMLInputElement).click();
});
$('#open-file').addEventListener('click', () => { importParentId = activeDocument().parentId; ($('#file-input') as HTMLInputElement).click(); });
$('#file-input').addEventListener('change', async (event) => {
  const input = event.currentTarget as HTMLInputElement; const files = Array.from(input.files ?? []); input.value = '';
  if (!files.length) return;
  const parentId = importParentId; importParentId = null;
  const opened: string[] = []; const failed: string[] = [];
  for (const file of files) {
    const kind = await chooseDocumentKind(`Open ${file.name} as…`);
    if (!kind) continue;
    try {
      const source = await file.text(); const name = fileName(file.name);
      captureDocument();
      const { existing, identical } = importCollision(documents, parentId, name, source, kind);
      if (identical && existing) { switchDocument(existing.id); opened.push(existing.id); continue; }
      const choice = existing ? await fileManager.collision(name, existing.source, source) : 'both';
      if (choice === 'cancel') continue;
      const imported = await openDocumentFile(name, source, kind); imported.parentId = parentId;
      captureDocument();
      if (choice === 'replace' && existing) {
        imported.id = existing.id;
        if (imported.kind === 'sketch' && existing.kind === 'sketch') imported.sketchTargets = existing.sketchTargets;
        documents = documents.map((doc) => doc.id === existing.id ? imported : doc);
        // Drop links whose model sketch no longer exists after replacement.
        for (const doc of documents) if (doc.sketchTargets) doc.sketchTargets = doc.sketchTargets.filter((target) => documents.some((model) => model.id === target.documentId && model.kind === 'model' && model.sketches.some((sketch) => sketch.id === target.sketchId)));
        if (imported.kind === 'sketch' && !imported.draftDirty) synchronizeSketchReferences(documents, imported);
      } else {
        imported.name = uniqueFileName(existing ? `${name} (imported)` : name, siblingNames(documents, folders, parentId));
        documents.push(imported);
      }
      loadDocument(imported); opened.push(imported.id);
      await saveWorkspace();
    } catch { failed.push(file.name); }
  }
  if (opened.length) { switchDocument(opened[0]); scheduleSave(); }
  if (failed.length) notify(`Could not import: ${failed.join(', ')}`, true);
  else if (opened.length > 1) notify(`Opened ${opened.length} files`);
});
$('#download').addEventListener('click', () => { captureDocument(); void saveDocument(activeDocument()); });
$('#export-glb').addEventListener('click', async () => {
  if (exportingGlb || !openDocumentIds.length || documentKind !== 'model') return;
  const name = activeDocument().name;
  const snapshot = structuredClone({ boxes, variables, groups, sketches, measurements });
  const hiddenIds = [...hiddenBoxIds];
  const hasDraft = draftDirty;
  exportingGlb = true;
  syncGlbExportUI();
  try {
    const { exportModelGlb } = await import('./glb-export');
    const result = await exportModelGlb(snapshot, { name, hiddenIds });
    downloadData(result.buffer, result.filename, 'model/gltf-binary');
    const notes = [...(hasDraft ? ['Unrun draft was excluded.'] : []), ...result.warnings];
    const message = `Export requested · ${result.filename}${notes.length ? ` · ${notes.join(' ')}` : ''}`;
    notify(message);
    setStatus(message);
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Could not export GLB', true);
  } finally {
    exportingGlb = false;
    syncGlbExportUI();
  }
});
$('#undo').addEventListener('click', () => undoRedo(-1)); $('#redo').addEventListener('click', () => undoRedo(1));
editor.addEventListener('input', () => { if (measuring) activateMeasurementTool(false); if (documentKind === 'sketch' && sketchTool !== 'select') activateSketchTool('select'); draftDirty = true; updateLineNumbers(); syncDraftUI(); setStatus(`Draft changed · run to update ${documentKind === 'sketch' ? 'sketch' : 'model'}`); scheduleSave(); });
editor.addEventListener('scroll', () => { $('#line-numbers').scrollTop = editor.scrollTop; });
root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => button.addEventListener('click', () => { if (documentKind === 'sketch') return; viewMode = button.dataset.view as typeof viewMode; viewport.setView(viewMode); root.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b === button)); scheduleSave(); }));
$('#fit').addEventListener('click', () => viewport.fit());
$('#projection').addEventListener('click', () => { if (documentKind === 'sketch') return; projectionMode = projectionMode === 'perspective' ? 'orthographic' : 'perspective'; viewport.setProjection(projectionMode); $('#projection').textContent = projectionMode === 'perspective' ? 'PERSPECTIVE' : 'ORTHOGRAPHIC'; scheduleSave(); });
$('#grid-toggle').addEventListener('click', () => { gridVisible = !gridVisible; viewport.setGrid(gridVisible); $('#grid-toggle').classList.toggle('active', gridVisible); scheduleSave(); });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('#group-member-menu').hidden) { event.preventDefault(); event.stopPropagation(); closeGroupMemberMenu(true); return; }
  if (event.key === 'Escape' && !$('#face-menu').hidden) { event.preventDefault(); event.stopPropagation(); closeFaceMenu(); return; }
  if (root.querySelector('dialog[open]')) return;
  const target = event.target as HTMLElement; const textEditing = target instanceof HTMLTextAreaElement || target.isContentEditable; const editing = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || textEditing;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); newTab(); }
  else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); captureDocument(); void saveDocument(activeDocument()); }
  else if (!openDocumentIds.length) return;
  else if (!editing && event.key === 'F2') { event.preventDefault(); renameTab(activeDocumentId); }
  else if (measuring && event.key === 'Escape' && !editing) { event.preventDefault(); activateMeasurementTool(false); }
  else if (!editing && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'm') { event.preventDefault(); activateMeasurementTool(!measuring); }
  else if (event.key === 'Escape' && !editing) { event.preventDefault(); if (documentKind === 'sketch' && sketchTool !== 'select') activateSketchTool('select'); else if (documentKind === 'sketch') selectSketchShapes([], 'replace'); else selectModelItems([], 'replace'); }
  else if (documentKind === 'sketch' && !editing && event.key.toLowerCase() === 'c') { event.preventDefault(); activateSketchTool('circle'); }
  else if (documentKind === 'sketch' && !editing && event.key.toLowerCase() === 'l') { event.preventDefault(); activateSketchTool('line'); }
  else if (documentKind === 'sketch' && !editing && event.key.toLowerCase() === 'r') { event.preventDefault(); activateSketchTool('rectangle'); }
  else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void runSource(); }
  else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !editing) { event.preventDefault(); undoRedo(event.shiftKey ? 1 : -1); }
  else if (!editing && event.key.toLowerCase() === 'f') viewport.fit();
  else if (!editing && documentKind === 'model' && ['1', '3', '7'].includes(event.key)) { const view = ({ '1': 'front', '3': 'right', '7': 'top' } as const)[event.key as '1' | '3' | '7']; viewMode = view; viewport.setView(view); root.querySelector(`[data-view="${view}"]`)?.classList.add('active'); root.querySelectorAll(`[data-view]:not([data-view="${view}"])`).forEach((b) => b.classList.remove('active')); }
  else if (!editing && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); deleteBox(); }
});

async function initializeWorkspace() {
  $('.app-shell').toggleAttribute('inert', true);
  $('#save-state').textContent = 'Loading…';
  let state: LibraryState | null = null;
  let initialized = false;
  try {
    library = new FileLibrary(new IndexedDBStorage());
    state = await library.load();
    initialized = !!state;
  } catch (error) {
    library = null;
    notify(error instanceof Error ? error.message : 'Browser storage is unavailable.', true);
  }
  if (!state) {
    for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
      try { const raw = localStorage.getItem(key); if (raw) { state = migrateWorkspace(raw); break; } }
      catch { /* Preserve the original recovery data and try the older format. */ }
    }
  }
  if (state) {
    documents = state.documents; folders = state.folders; openDocumentIds = state.workspace.openIds;
    measurementsThroughObjects = state.workspace.preferences.measurementsThroughObjects; syncMeasurementThroughPreference();
    loadDocument(documents.find((doc) => doc.id === state!.workspace.activeId) ?? emptyDocument);
  } else {
    const example = createDocument('Workbench example', DEFAULT_SOURCE); documents.push(example); loadDocument(example);
  }
  storageReady = true;
  $('.app-shell').toggleAttribute('inert', false);
  if (!initialized) {
    await saveWorkspace();
    if (!state) void runSource();
  } else $('#save-state').textContent = 'Recovered';
  renderAll();
}
export const workspaceReady = initializeWorkspace();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void saveWorkspace(); });
window.addEventListener('pagehide', () => void saveWorkspace());
window.addEventListener('beforeunload', (event) => {
  // IndexedDB cannot guarantee an async commit during shutdown. Save continuously,
  // and ask the browser to keep this page open while a save is pending or failed.
  if (storageReady && ['Saving…', 'Not saved'].includes($('#save-state').textContent ?? '')) { event.preventDefault(); event.returnValue = ''; }
});
