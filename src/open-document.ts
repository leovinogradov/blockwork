import { compileModel, type CompiledSketch } from './compiler';
import { createDocument, resolveSnapshot, type DocumentKind, type Snapshot } from './documents';
import type { ModelSpec } from './model';

/** Compile imports independently so switching tabs cannot cancel their initial run. */
export async function openDocumentFile(
  name: string,
  source: string,
  kind: DocumentKind,
  compile: (source: string, kind: DocumentKind) => Promise<ModelSpec | CompiledSketch> = compileModel,
) {
  const document = createDocument(name, source, kind);
  try {
    const compiled = await compile(source, kind);
    const snapshot: Snapshot = {
      groups: compiled.groups ?? [], measurements: compiled.measurements ?? [],
      boxes: 'boxes' in compiled ? compiled.boxes : [],
      sketches: 'sketches' in compiled ? compiled.sketches ?? [] : [],
      variables: 'variables' in compiled ? compiled.variables : [],
      rectangles: 'rectangles' in compiled ? compiled.rectangles : [],
      source, hiddenIds: [],
    };
    const geometry = resolveSnapshot(snapshot, kind);
    Object.assign(document, geometry, { appliedSource: source, draftDirty: false });
    document.history = [structuredClone({ ...snapshot, ...geometry })];
    document.historyAt = 0;
  } catch (error) {
    document.error = error instanceof Error ? error.message : 'Could not compile source';
  }
  return document;
}
