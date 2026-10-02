import { parseInches, resolveModel, type ModelSpec } from "./model";

type CompileRequest = { source: string };
type CompileResponse = ModelSpec | { error: string };
type BoxHelper = (raw: unknown) => unknown;
type InchHelper = (value: string | number) => number | string;

const workerScope = self as unknown as {
  addEventListener(type: "message", listener: (event: MessageEvent<CompileRequest>) => void): void;
  postMessage(message: CompileResponse): void;
};

workerScope.addEventListener("message", (event: MessageEvent<CompileRequest>) => {
  try {
    if (!event.data || typeof event.data.source !== "string") throw new Error("Compiler expected JavaScript source text.");
    const boxes: unknown[] = [];
    const variables: unknown[] = [];
    let nextId = 1;
    const box = (raw: unknown) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("box(...) expects an object.");
      if (boxes.length >= 2000) throw new Error("A model can contain at most 2000 boxes.");
      const spec = raw as Record<string, unknown>;
      const dimension = (value: unknown, label: string): number | string => {
        if (typeof value !== "string" && typeof value !== "number") throw new Error(`${label} must be an inch string or number.`);
        return value;
      };
      const vector = (value: unknown, label: string, fallback?: [number, number, number]): [number | string, number | string, number | string] => {
        if (value === undefined && fallback) return fallback;
        if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} must have three values.`);
        return value.map((part, index) => dimension(part, `${label}[${index}]`)) as [number | string, number | string, number | string];
      };
      const id = spec.id === undefined ? `box-${nextId++}` : spec.id;
      const name = spec.name === undefined ? `Box ${boxes.length + 1}` : spec.name;
      const color = spec.color === undefined ? "#8795a1" : spec.color;
      const result = {
        id,
        name,
        size: vector(spec.size, "size"),
        position: vector(spec.position, "position", [0, 0, 0]),
        color,
        ...(spec.expressions === undefined ? {} : { expressions: spec.expressions }),
        ...(spec.relative === undefined ? {} : { relative: (() => {
          if (!spec.relative || typeof spec.relative !== "object" || Array.isArray(spec.relative)) throw new Error("relative must be an object.");
          const relative = spec.relative as Record<string, unknown>;
          const parseEdge = (value: unknown, label: string) => {
            if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`relative.${label} must be an object.`);
            const edge = value as Record<string, unknown>;
            return { side: edge.side, offset: dimension(edge.offset, `relative.${label}.offset`) };
          };
          return {
            boxId: relative.boxId,
            face: relative.face,
            offset: dimension(relative.offset, "relative.offset"),
            ...(relative.u === undefined ? {} : { u: parseEdge(relative.u, "u") }),
            ...(relative.v === undefined ? {} : { v: parseEdge(relative.v, "v") }),
          };
        })() }),
      };
      boxes.push(result);
      return result;
    };
    const variable = (raw: unknown) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("variable(...) expects an object.");
      variables.push(raw);
      return raw;
    };
    // Only defer variable references; ordinary inch() calls retain legacy numeric behavior.
    const inch = (value: string | number) => typeof value === "string" && /\bvar\s*\(/.test(value) ? value : parseInches(value);
    // Code runs in a disposable worker. The main thread enforces a hard timeout.
    const evaluate = new Function("box", "variable", "inch", `"use strict";\n${event.data.source}`) as (boxHelper: BoxHelper, variableHelper: BoxHelper, inchHelper: InchHelper) => unknown;
    evaluate(box, variable, inch);
    const response: CompileResponse = resolveModel(boxes, variables);
    workerScope.postMessage(response);
  } catch (error) {
    const response: CompileResponse = { error: error instanceof Error ? error.message : String(error) };
    workerScope.postMessage(response);
  }
});
