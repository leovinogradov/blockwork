import { generateSource, resolveModel, type BoxSpec, type FaceName, type VariableSpec } from './model';
import { generateSketchSource, validateRectangles, type RectangleSpec } from './sketch';

export type DocumentKind = 'model' | 'sketch';
export type Snapshot = { boxes: BoxSpec[]; rectangles?: RectangleSpec[]; variables: VariableSpec[]; source: string; hiddenIds: string[] };
export type ModelDocument = {
  id: string;
  name: string;
  kind: DocumentKind;
  boxes: BoxSpec[];
  rectangles: RectangleSpec[];
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
  selectedVariable: string | null;
  selectedFace: FaceName | null;
  error: string;
  scrollTop: number;
  scrollLeft: number;
  selectionStart: number;
  selectionEnd: number;
};

export function createDocument(name: string, source: string, kind: DocumentKind = 'model'): ModelDocument {
  return {
    id: crypto.randomUUID(), name, kind, source, appliedSource: '', draftDirty: true,
    boxes: [], rectangles: [], variables: [], hiddenBoxIds: [], viewMode: kind === 'sketch' ? 'top' : 'iso', projectionMode: kind === 'sketch' ? 'orthographic' : 'perspective', gridVisible: true,
    history: [], historyAt: -1, selectedId: null, selectedVariable: null, selectedFace: null, error: '',
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
    draftDirty: document.draftDirty, boxes: document.boxes, rectangles: document.rectangles, variables: document.variables,
    hiddenBoxIds: document.hiddenBoxIds, viewMode: document.viewMode,
    projectionMode: document.projectionMode, gridVisible: document.gridVisible, error: document.error,
  })) });
}

function restoreDocument(value: unknown): ModelDocument {
  if (!value || typeof value !== 'object') throw new Error('Invalid document');
  const data = value as Partial<ModelDocument>;
  if (typeof data.source !== 'string' || !Array.isArray(data.boxes)) throw new Error('Invalid document');
  const kind: DocumentKind = data.kind === 'sketch' ? 'sketch' : 'model';
  const model = kind === 'model' ? resolveModel(data.boxes, Array.isArray(data.variables) ? data.variables : []) : { boxes: [], variables: [] };
  const rectangles = kind === 'sketch' ? validateRectangles(data.rectangles ?? []) : [];
  const document = createDocument(typeof data.name === 'string' ? data.name : 'Recovered local model', data.source, kind);
  if (typeof data.id === 'string' && data.id) document.id = data.id;
  document.boxes = model.boxes;
  document.rectangles = rectangles;
  document.variables = model.variables;
  document.draftDirty = data.draftDirty === true;
  document.appliedSource = typeof data.appliedSource === 'string' ? data.appliedSource : document.draftDirty ? kind === 'sketch' ? generateSketchSource(rectangles) : generateSource(model.boxes, model.variables) : data.source;
  document.hiddenBoxIds = Array.isArray(data.hiddenBoxIds) ? data.hiddenBoxIds.filter((id) => [...model.boxes, ...rectangles].some((item) => item.id === id)) : [];
  if (['iso', 'front', 'right', 'top'].includes(data.viewMode ?? '')) document.viewMode = data.viewMode!;
  if (data.projectionMode === 'orthographic') document.projectionMode = data.projectionMode;
  if (typeof data.gridVisible === 'boolean') document.gridVisible = data.gridVisible;
  if (typeof data.error === 'string') document.error = data.error;
  document.history = [{ boxes: structuredClone(model.boxes), rectangles: structuredClone(rectangles), variables: structuredClone(model.variables), source: document.appliedSource, hiddenIds: [...document.hiddenBoxIds] }];
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
