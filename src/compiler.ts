import { validateGroups, type GroupSpec } from './groups';
import { resolveModel, type ModelSpec } from "./model";
import { validateSketchShapes, type SketchShape } from './sketch';
import type { DocumentKind } from './documents';
import { sketchTextSize } from './sketch-text';

import { validateMeasurements, type Measurement } from './measurements';

export type CompiledSketch = { rectangles: SketchShape[]; groups: GroupSpec[]; measurements: Measurement[] };

/** Compile editable model JavaScript in a disposable worker with a strict time limit. */
export function compileModel(source: string, kind: 'model'): Promise<ModelSpec>;
export function compileModel(source: string, kind: 'sketch'): Promise<CompiledSketch>;
export function compileModel(source: string, kind?: DocumentKind): Promise<ModelSpec | CompiledSketch>;
export function compileModel(source: string, kind: DocumentKind = 'model'): Promise<ModelSpec | CompiledSketch> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./compiler.worker.ts", import.meta.url), { type: "module" });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      callback();
    };
    const timer = setTimeout(() => finish(() => reject(new Error("Model compilation timed out after 1500 ms."))), 1500);

    worker.onmessage = (event: MessageEvent<{ boxes?: unknown; sketches?: unknown; rectangles?: unknown; variables?: unknown; groups?: unknown; measurements?: unknown; error?: string }>) => {
      const result = event.data;
      if (result?.error) {
        finish(() => reject(new Error(result.error)));
      } else if (kind === 'sketch' && Array.isArray(result?.rectangles)) {
        try {
          const groups = validateGroups(result.groups ?? [], true);
          const rectangles = validateSketchShapes(result.rectangles, groups).map(layoutText);
          const measurements = validateMeasurements(result.measurements, { rectangles, groups });
          finish(() => resolve({ rectangles, groups, measurements }));
        }
        catch (error) { finish(() => reject(error instanceof Error ? error : new Error(String(error)))); }
      } else if (Array.isArray(result?.boxes) && Array.isArray(result?.variables)) {
        try {
          const model = resolveModel(result.boxes, result.variables, result.groups ?? [], result.sketches ?? [], result.measurements ?? []);
          model.sketches = model.sketches?.map((sketch) => ({ ...sketch, shapes: sketch.shapes.map(layoutText) }));
          finish(() => resolve(model));
        } catch (error) {
          finish(() => reject(error instanceof Error ? error : new Error(String(error))));
        }
      } else {
        finish(() => reject(new Error("Compiler returned an invalid result.")));
      }
    };
    worker.onerror = (event) => finish(() => reject(new Error(event.message || "Model compiler worker failed.")));
    worker.onmessageerror = () => finish(() => reject(new Error("Could not read the compiler result.")));
    worker.postMessage({ source, kind });
  });
}

function layoutText(shape: SketchShape): SketchShape {
  return shape.kind === 'text' ? { ...shape, size: sketchTextSize(shape.text, shape.textHeight) } : shape;
}
