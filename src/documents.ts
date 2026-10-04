import { validateGroups, type GroupSpec } from './groups';
import { generateSource, resolveModel, type BoxSpec, type FaceName, type VariableSpec } from './model';
import { generateSketchSource, validateSketchShapes, type SketchShape } from './sketch';
import { normalizeTreeOrder } from './component-tree';

export type DocumentKind = 'model' | 'sketch';
export type Snapshot = { groups?: GroupSpec[]; treeOrder?: string[]; boxes: BoxSpec[]; rectangles?: SketchShape[]; variables: VariableSpec[]; source: string; hiddenIds: string[] };
export type ModelDocument = {
  id: string;
  name: string;
  kind: DocumentKind;
  groups: GroupSpec[];
  collapsedGroupIds: string[];
  treeOrder: string[];
  boxes: BoxSpec[];
  rectangles: SketchShape[];
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
  const model = kind === 'model' ? resolveModel(snapshot.boxes, snapshot.variables ?? [], groups) : { boxes: [], variables: [] };
  const rectangles = kind === 'sketch' ? validateSketchShapes(snapshot.rectangles ?? [], groups) : [];
  return { groups, boxes: model.boxes, variables: model.variables, rectangles, treeOrder: normalizeTreeOrder(snapshot.treeOrder, groups, kind === 'sketch' ? rectangles : model.boxes) };
}

export function createDocument(name: string, source: string, kind: DocumentKind = 'model'): ModelDocument {
  return {
    id: crypto.randomUUID(), name, kind, source, appliedSource: '', draftDirty: true,
    groups: [], collapsedGroupIds: [], treeOrder: [], boxes: [], rectangles: [], variables: [], hiddenBoxIds: [], viewMode: kind === 'sketch' ? 'top' : 'iso', projectionMode: kind === 'sketch' ? 'orthographic' : 'perspective', gridVisible: true,
    history: [], historyAt: -1, selectedId: null, selectedSketchIds: [], selectedVariable: null, selectedFace: null, error: '',
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

export function serializeWorkspace(documents: ModelDocument[], activeId: string): string {
  return JSON.stringify({ activeId, documents: documents.map((document) => ({
    id: document.id, name: document.name, kind: document.kind, source: document.source, appliedSource: document.appliedSource,
    draftDirty: document.draftDirty, groups: document.groups, collapsedGroupIds: document.collapsedGroupIds, treeOrder: document.treeOrder, boxes: document.boxes, rectangles: document.rectangles, variables: document.variables,
    hiddenBoxIds: document.hiddenBoxIds, viewMode: document.viewMode,
    projectionMode: document.projectionMode, gridVisible: document.gridVisible, error: document.error,
  })) });
}

function restoreDocument(value: unknown): ModelDocument {
  if (!value || typeof value !== 'object') throw new Error('Invalid document');
  const data = value as Partial<ModelDocument>;
  if (typeof data.source !== 'string' || !Array.isArray(data.boxes)) throw new Error('Invalid document');
  const kind: DocumentKind = data.kind === 'sketch' ? 'sketch' : 'model';
  const groups = validateGroups(data.groups ?? [], kind === 'sketch');
  const model = kind === 'model' ? resolveModel(data.boxes, Array.isArray(data.variables) ? data.variables : [], groups) : { boxes: [], variables: [] };
  const rectangles = kind === 'sketch' ? validateSketchShapes(data.rectangles ?? [], groups) : [];
  const document = createDocument(typeof data.name === 'string' ? data.name : 'Recovered local model', data.source, kind);
  if (typeof data.id === 'string' && data.id) document.id = data.id;
  document.groups = groups;
  document.treeOrder = normalizeTreeOrder(data.treeOrder, groups, kind === 'sketch' ? rectangles : model.boxes);
  document.collapsedGroupIds = Array.isArray(data.collapsedGroupIds) ? data.collapsedGroupIds.filter((id) => groups.some((g) => g.id === id)) : [];
  document.boxes = model.boxes;
  document.rectangles = rectangles;
  document.variables = model.variables;
  document.draftDirty = data.draftDirty === true;
  document.appliedSource = typeof data.appliedSource === 'string' ? data.appliedSource : document.draftDirty ? kind === 'sketch' ? generateSketchSource(rectangles, groups) : generateSource(model.boxes, model.variables, groups) : data.source;
  document.hiddenBoxIds = Array.isArray(data.hiddenBoxIds) ? data.hiddenBoxIds.filter((id) => [...model.boxes, ...rectangles].some((item) => item.id === id)) : [];
  if (['iso', 'front', 'right', 'top'].includes(data.viewMode ?? '')) document.viewMode = data.viewMode!;
  if (data.projectionMode === 'orthographic') document.projectionMode = data.projectionMode;
  if (typeof data.gridVisible === 'boolean') document.gridVisible = data.gridVisible;
  if (typeof data.error === 'string') document.error = data.error;
  document.history = [{ groups: structuredClone(groups), treeOrder: [...document.treeOrder], boxes: structuredClone(model.boxes), rectangles: structuredClone(rectangles), variables: structuredClone(model.variables), source: document.appliedSource, hiddenIds: [...document.hiddenBoxIds] }];
  document.historyAt = 0;
  return document;
}

export function restoreWorkspace(raw: string): { documents: ModelDocument[]; activeId: string } {
  const data = JSON.parse(raw);
  // The original single-model save becomes the first tab.
  const documents = Array.isArray(data?.documents) ? data.documents.map(restoreDocument) : [restoreDocument(data)];
  if (!documents.length || new Set(documents.map((document: ModelDocument) => document.id)).size !== documents.length) throw new Error('Invalid workspace');
  const activeId = documents.some((document: ModelDocument) => document.id === data.activeId) ? data.activeId : documents[0].id;
  return { documents, activeId };
}
