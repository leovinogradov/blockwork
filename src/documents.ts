import { validateGroups, type GroupSpec } from './groups';
import { generateSource, resolveModel, type BoxSpec, type FaceName, type VariableSpec } from './model';
import { generateSketchSource, validateSketchShapes, type SketchShape } from './sketch';
import { normalizeTreeOrder } from './component-tree';
import type { ModelSketch } from './model-sketch';

import { DEFAULT_MEASUREMENT_OFFSET, validateMeasurements, type Measurement } from './measurements';

export type DocumentKind = 'model' | 'sketch';
export type WorkspacePreferences = { measurementsThroughObjects: boolean };
/** Workspace-local links; model source continues to embed the last applied shapes. */
export type SketchTarget = { documentId: string; sketchId: string; origin: [number, number] };
export type Snapshot = { measurements?: Measurement[]; groups?: GroupSpec[]; treeOrder?: string[]; boxes: BoxSpec[]; sketches?: ModelSketch[]; rectangles?: SketchShape[]; variables: VariableSpec[]; source: string; hiddenIds: string[] };
export type ModelDocument = {
  id: string;
  name: string;
  kind: DocumentKind;
  sketchTargets?: SketchTarget[];
  groups: GroupSpec[];
  collapsedGroupIds: string[];
  treeOrder: string[];
  boxes: BoxSpec[];
  sketches: ModelSketch[];
  rectangles: SketchShape[];
  measurements: Measurement[];
  variables: VariableSpec[];
  source: string;
  appliedSource: string;
  draftDirty: boolean;
  hiddenBoxIds: string[];
  viewMode: 'iso' | 'front' | 'right' | 'top';
  projectionMode: 'perspective' | 'orthographic';
  gridVisible: boolean;
  history: Snapshot[];
  historyAt: number;
  selectedId: string | null;
  selectedSketchIds: string[];
  selectedModelIds: string[];
  selectedVariable: string | null;
  selectedFace: FaceName | null;
  error: string;
  scrollTop: number;
  scrollLeft: number;
  selectionStart: number;
  selectionEnd: number;
};

/** Resolve only the active document's geometry when applying an undo snapshot. */
export function resolveSnapshot(snapshot: Snapshot, kind: DocumentKind) {
  const groups = validateGroups(snapshot.groups ?? [], kind === 'sketch');
  const model = kind === 'model' ? resolveModel(snapshot.boxes, snapshot.variables ?? [], groups, snapshot.sketches ?? [], snapshot.measurements ?? []) : { boxes: [], variables: [], sketches: [] };
  const rectangles = kind === 'sketch' ? validateSketchShapes(snapshot.rectangles ?? [], groups) : [];
  const measurements = validateMeasurements(snapshot.measurements, { boxes: model.boxes, sketches: model.sketches, rectangles, groups });
  return { measurements, groups, boxes: model.boxes, sketches: model.sketches ?? [], variables: model.variables, rectangles, treeOrder: normalizeTreeOrder(snapshot.treeOrder, groups, [...(kind === 'sketch' ? rectangles : [...model.boxes, ...(model.sketches ?? [])]), ...measurements]) };
}

export function createDocument(name: string, source: string, kind: DocumentKind = 'model'): ModelDocument {
  return {
    id: crypto.randomUUID(), name, kind, source, appliedSource: '', draftDirty: true,
    groups: [], collapsedGroupIds: [], treeOrder: [], boxes: [], sketches: [], rectangles: [], measurements: [], variables: [], hiddenBoxIds: [], viewMode: kind === 'sketch' ? 'top' : 'iso', projectionMode: kind === 'sketch' ? 'orthographic' : 'perspective', gridVisible: true,
    history: [], historyAt: -1, selectedId: null, selectedSketchIds: [], selectedModelIds: [], selectedVariable: null, selectedFace: null, error: '',
    scrollTop: 0, scrollLeft: 0, selectionStart: 0, selectionEnd: 0,
  };
}

export function createBlankDocument(documents: ModelDocument[], kind: DocumentKind = 'model'): ModelDocument {
  const names = new Set(documents.map((document) => document.name.toLowerCase()));
  let name = 'Untitled.js';
  for (let number = 2; names.has(name.toLowerCase()); number++) name = `Untitled ${number}.js`;
  const document = createDocument(name, kind === 'sketch' ? generateSketchSource([]) : '', kind);
  document.draftDirty = false;
  document.appliedSource = document.source;
  document.history = [{ boxes: [], ...(kind === 'sketch' ? { rectangles: [] } : {}), variables: [], source: document.source, hiddenIds: [] }];
  document.historyAt = 0;
  return document;
}

export function serializeWorkspace(documents: ModelDocument[], activeId: string, preferences: WorkspacePreferences = { measurementsThroughObjects: true }): string {
  return JSON.stringify({ measurementUnits: 'inches', activeId, preferences, documents: documents.map((document) => ({
    id: document.id, name: document.name, kind: document.kind, sketchTargets: document.sketchTargets, source: document.source, appliedSource: document.appliedSource,
    draftDirty: document.draftDirty, groups: document.groups, collapsedGroupIds: document.collapsedGroupIds, treeOrder: document.treeOrder, boxes: document.boxes, sketches: document.sketches, rectangles: document.rectangles, measurements: document.measurements, variables: document.variables,
    hiddenBoxIds: document.hiddenBoxIds, viewMode: document.viewMode,
    projectionMode: document.projectionMode, gridVisible: document.gridVisible, error: document.error,
  })) });
}

function restoreDocument(value: unknown, legacyPixelMeasurements = false): ModelDocument {
  if (!value || typeof value !== 'object') throw new Error('Invalid document');
  const data = value as Partial<ModelDocument>;
  if (typeof data.source !== 'string' || !Array.isArray(data.boxes)) throw new Error('Invalid document');
  const kind: DocumentKind = data.kind === 'sketch' ? 'sketch' : 'model';
  const groups = validateGroups(data.groups ?? [], kind === 'sketch');
  const model = kind === 'model' ? resolveModel(data.boxes, Array.isArray(data.variables) ? data.variables : [], groups, data.sketches ?? [], data.measurements ?? []) : { boxes: [], variables: [], sketches: [] };
  const rectangles = kind === 'sketch' ? validateSketchShapes(data.rectangles ?? [], groups) : [];
  const document = createDocument(typeof data.name === 'string' ? data.name : 'Recovered local model', data.source, kind);
  if (typeof data.id === 'string' && data.id) document.id = data.id;
  if (kind === 'sketch' && Array.isArray(data.sketchTargets)) {
    document.sketchTargets = data.sketchTargets.filter((target) => target && typeof target.documentId === 'string' && typeof target.sketchId === 'string' && Array.isArray(target.origin) && target.origin.length === 2 && target.origin.every((n) => typeof n === 'number' && Number.isFinite(n))).map((target) => structuredClone(target));
  }
  const measurements = validateMeasurements(data.measurements, { boxes: model.boxes, sketches: model.sketches, rectangles, groups }).map((m) => legacyPixelMeasurements ? { ...m, offset: m.offset === 0 ? 0 : (Math.sign(m.offset ?? 1) || 1) * DEFAULT_MEASUREMENT_OFFSET } : m);
  document.groups = groups;
  document.treeOrder = normalizeTreeOrder(data.treeOrder, groups, [...(kind === 'sketch' ? rectangles : [...model.boxes, ...(model.sketches ?? [])]), ...measurements]);
  document.collapsedGroupIds = Array.isArray(data.collapsedGroupIds) ? data.collapsedGroupIds.filter((id) => groups.some((g) => g.id === id)) : [];
  document.boxes = model.boxes;
  document.sketches = model.sketches ?? [];
  document.rectangles = rectangles;
  document.measurements = measurements;
  document.variables = model.variables;
  document.draftDirty = data.draftDirty === true;
  document.appliedSource = typeof data.appliedSource === 'string' ? data.appliedSource : document.draftDirty ? kind === 'sketch' ? generateSketchSource(rectangles, groups, document.treeOrder, document.measurements) : generateSource(model.boxes, model.variables, groups, document.treeOrder, document.sketches, document.measurements) : data.source;
  // Pixel offsets cannot be recovered as inches without the original camera/zoom.
  // Preserve each side using the default distance and leave pending drafts intact.
  if (legacyPixelMeasurements && measurements.length) {
    document.appliedSource = kind === 'sketch' ? generateSketchSource(rectangles, groups, document.treeOrder, measurements) : generateSource(model.boxes, model.variables, groups, document.treeOrder, document.sketches, measurements);
    if (!document.draftDirty) document.source = document.appliedSource;
  }
  document.hiddenBoxIds = Array.isArray(data.hiddenBoxIds) ? data.hiddenBoxIds.filter((id) => [...groups, ...model.boxes, ...document.sketches, ...rectangles, ...measurements].some((item) => item.id === id)) : [];
  if (['iso', 'front', 'right', 'top'].includes(data.viewMode ?? '')) document.viewMode = data.viewMode!;
  if (data.projectionMode === 'orthographic') document.projectionMode = data.projectionMode;
  if (typeof data.gridVisible === 'boolean') document.gridVisible = data.gridVisible;
  if (typeof data.error === 'string') document.error = data.error;
  document.history = [{ groups: structuredClone(groups), treeOrder: [...document.treeOrder], boxes: structuredClone(model.boxes), sketches: structuredClone(document.sketches), rectangles: structuredClone(rectangles), measurements: structuredClone(document.measurements), variables: structuredClone(model.variables), source: document.appliedSource, hiddenIds: [...document.hiddenBoxIds] }];
  document.historyAt = 0;
  return document;
}

export function restoreWorkspace(raw: string): { documents: ModelDocument[]; activeId: string; preferences: WorkspacePreferences } {
  const data = JSON.parse(raw);
  // The original single-model save becomes the first tab.
  const documents = Array.isArray(data?.documents) ? data.documents.map((document: unknown) => restoreDocument(document, data.measurementUnits !== 'inches')) : [restoreDocument(data, data.measurementUnits !== 'inches')];
  if (!documents.length || new Set(documents.map((document: ModelDocument) => document.id)).size !== documents.length) throw new Error('Invalid workspace');
  // Ignore stale references after either endpoint has been closed or deleted.
  const linked = new Set<string>();
  for (const document of documents as ModelDocument[]) {
    if (!document.sketchTargets) continue;
    document.sketchTargets = document.sketchTargets.filter((target) => {
      const model = documents.find((doc: ModelDocument) => doc.id === target.documentId && doc.kind === 'model');
      const key = JSON.stringify([target.documentId, target.sketchId]);
      if (!model?.sketches.some((sketch: ModelSketch) => sketch.id === target.sketchId) || linked.has(key)) return false;
      linked.add(key); return true;
    });
  }
  const activeId = documents.some((document: ModelDocument) => document.id === data.activeId) ? data.activeId : documents[0].id;
  const preferences = { measurementsThroughObjects: typeof data.preferences?.measurementsThroughObjects === 'boolean' ? data.preferences.measurementsThroughObjects : true };
  return { documents, activeId, preferences };
}
