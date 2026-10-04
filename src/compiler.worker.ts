import { validateGroups, type GroupSpec } from './groups';
import { parseInches, resolveModel, type ModelSpec } from "./model";
import { validateSketchShapes, type SketchShape } from './sketch';

type CompileRequest = { source: string; kind?: 'model' | 'sketch' };
type CompileResponse = ModelSpec | { rectangles: SketchShape[]; groups: GroupSpec[] } | { error: string };
type BoxHelper = (raw: unknown) => unknown;
type InchHelper = (value: string | number) => number | string;

const workerScope = self as unknown as {
  addEventListener(type: "message", listener: (event: MessageEvent<CompileRequest>) => void): void;
  postMessage(message: CompileResponse): void;
};

workerScope.addEventListener("message", (event: MessageEvent<CompileRequest>) => {
  try {
    if (!event.data || typeof event.data.source !== "string") throw new Error("Compiler expected JavaScript source text.");
    const groups: unknown[] = [];
    let nextGroupId = 1;
    const group = (raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('group(...) expects an object.');
      if (groups.length >= 2000) throw new Error('At most 2000 groups are allowed.');
      const spec = raw as Record<string, unknown>;
      const result = { ...spec, id: spec.id ?? `group-${nextGroupId++}`, name: spec.name ?? `Group ${groups.length + 1}` };
      groups.push(result); return result;
    };
    if (event.data.kind === 'sketch') {
      const rectangles: unknown[] = [];
      let nextId = 1;
      const rectangle = (raw: unknown) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('rectangle(...) expects an object.');
        if (rectangles.length >= 2000) throw new Error('A sketch can contain at most 2000 rectangles.');
        const spec = raw as Record<string, unknown>;
        const result = { id: spec.id ?? `rectangle-${nextId++}`, name: spec.name ?? `Rectangle ${rectangles.length + 1}`, size: spec.size, position: spec.position ?? [0, 0], color: spec.color ?? '#ffffff', groupId: spec.groupId };
        rectangles.push(result);
        return result;
      };
      const line = (raw: unknown) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('line(...) expects an object.');
        const spec = raw as Record<string, unknown>;
        const point = (value: unknown): [number, number] => {
          if (!Array.isArray(value) || value.length !== 2 || value.some((v) => typeof v !== 'number' && typeof v !== 'string')) throw new Error('Line start and end must have two inch values.');
          return value.map((v) => parseInches(v)) as [number, number];
        };
        const start = point(spec.start), end = point(spec.end);
        if (rectangles.length >= 2000) throw new Error('A sketch can contain at most 2000 shapes.');
        const result = { id: spec.id ?? `line-${nextId++}`, name: spec.name ?? `Line ${rectangles.length + 1}`, kind: 'line', position: start, size: [end[0] - start[0], end[1] - start[1]], color: spec.color ?? '#ffffff', groupId: spec.groupId };
        rectangles.push(result);
        return result;
      };
      const evaluate = new Function('rectangle', 'line', 'inch', 'group', `"use strict";\n${event.data.source}`) as (rectangleHelper: BoxHelper, lineHelper: BoxHelper, inchHelper: InchHelper, groupHelper: BoxHelper) => unknown;
      evaluate(rectangle, line, parseInches, group);
      const validGroups = validateGroups(groups, true);
      workerScope.postMessage({ rectangles: validateSketchShapes(rectangles, validGroups), groups: validGroups });
      return;
    }
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
        color, groupId: spec.groupId,
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
    const evaluate = new Function("box", "variable", "inch", "group", `"use strict";\n${event.data.source}`) as (boxHelper: BoxHelper, variableHelper: BoxHelper, inchHelper: InchHelper, groupHelper: BoxHelper) => unknown;
    evaluate(box, variable, inch, group);
    const response: CompileResponse = resolveModel(boxes, variables, groups);
    workerScope.postMessage(response);
  } catch (error) {
    const response: CompileResponse = { error: error instanceof Error ? error.message : String(error) };
    workerScope.postMessage(response);
  }
});
