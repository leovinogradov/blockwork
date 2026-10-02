import { resolveModel, type ModelSpec } from "./model";
import { validateRectangles, type RectangleSpec } from './sketch';
import type { DocumentKind } from './documents';

/** Compile editable model JavaScript in a disposable worker with a strict time limit. */
export function compileModel(source: string, kind: 'model'): Promise<ModelSpec>;
export function compileModel(source: string, kind: 'sketch'): Promise<RectangleSpec[]>;
export function compileModel(source: string, kind?: DocumentKind): Promise<ModelSpec | RectangleSpec[]>;
export function compileModel(source: string, kind: DocumentKind = 'model'): Promise<ModelSpec | RectangleSpec[]> {
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

    worker.onmessage = (event: MessageEvent<{ boxes?: unknown; rectangles?: unknown; variables?: unknown; error?: string }>) => {
      const result = event.data;
      if (result?.error) {
        finish(() => reject(new Error(result.error)));
      } else if (kind === 'sketch' && Array.isArray(result?.rectangles)) {
        try { const rectangles = validateRectangles(result.rectangles); finish(() => resolve(rectangles)); }
        catch (error) { finish(() => reject(error instanceof Error ? error : new Error(String(error)))); }
      } else if (Array.isArray(result?.boxes) && Array.isArray(result?.variables)) {
        try {
          const model = resolveModel(result.boxes, result.variables);
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
