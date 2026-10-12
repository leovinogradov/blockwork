import { validateGroups, type GroupSpec } from './groups';
import { cylinderAxes, cylinderSize, parseInches, resolveModel, type CylinderAxis, type ModelSpec } from "./model";
import { validateSketchShapes, type SketchShape } from './sketch';

import { validateMeasurements, type Measurement } from './measurements';

type CompileRequest = { source: string; kind?: 'model' | 'sketch' };
type CompileResponse = ModelSpec | { rectangles: SketchShape[]; groups: GroupSpec[]; measurements: Measurement[] } | { error: string };
type GroupHelper = (raw: unknown, items?: unknown) => unknown;

const workerScope = self as unknown as {
  addEventListener(type: "message", listener: (event: MessageEvent<CompileRequest>) => void): void;
  postMessage(message: CompileResponse): void;
};

workerScope.addEventListener("message", (event: MessageEvent<CompileRequest>) => {
  try {
    if (!event.data || typeof event.data.source !== "string") throw new Error("Compiler expected JavaScript source text.");
    const groups: unknown[] = [];
    const measurements: unknown[] = [];
    const measurement = (raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('measurement(...) expects an object.');
      if (measurements.length >= 2000) throw new Error('At most 2000 measurements are allowed.');
      const spec = raw as Record<string, unknown>;
      rejectOwnershipFields(spec);
      const result = { ...spec, id: spec.id ?? 'measurement-' + (measurements.length + 1) };
      members.set(result, 'object');
      measurements.push(result); return result;
    };
    // Helpers register each object once; nesting assigns ownership after JS has
    // evaluated the child calls, without adding the objects a second time.
    const members = new Map<object, 'object' | 'group' | 'shape'>();
    const claimedShapes = new Set<object>();
    const registerObject = <T extends object>(result: T): T => { members.set(result, 'object'); return result; };
    const rejectOwnershipFields = (spec: Record<string, unknown>) => {
      for (const field of ['groupId', 'parentId']) {
        if (Object.hasOwn(spec, field)) throw new Error(`${field} is no longer supported in source. Put the item inside group(properties, [ ... ]) instead.`);
      }
    };
    let nextGroupId = 1;
    const group: GroupHelper = (raw, items) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('group(...) expects an object.');
      if (groups.length >= 2000) throw new Error('At most 2000 groups are allowed.');
      const spec = raw as Record<string, unknown>;
      rejectOwnershipFields(spec);
      const result = { ...spec, id: spec.id ?? `group-${nextGroupId++}`, name: spec.name ?? `Group ${groups.length + 1}` };
      if (items !== undefined) {
        if (!Array.isArray(items)) throw new Error('group(properties, items) expects an array of box, cylinder, sketch, rectangle, circle, line, measurement, or group results.');
        const seen = new Set<object>();
        const children = Array.from(items, (item: unknown) => {
          if (!item || typeof item !== 'object' || !members.has(item)) throw new Error('Group items must be results returned by box(), cylinder(), sketch(), rectangle(), circle(), line(), measurement(), or group().');
          if (event.data.kind !== 'sketch' && members.get(item) === 'shape') throw new Error('Model rectangles, circles and lines must be inside sketch(properties, items).');
          if (seen.has(item)) throw new Error('An item cannot appear twice in a group.');
          seen.add(item);
          const child = item as Record<string, unknown>;
          const field = members.get(item) === 'group' ? 'parentId' : 'groupId';
          if (child[field] !== undefined) throw new Error(`Item ${String(child.id)} already belongs to a group. An item cannot belong to two groups.`);
          return { child, field };
        });
        for (const { child, field } of children) child[field] = result.id;
      }
      groups.push(result); members.set(result, 'group'); return result;
    };
    const rectangles: unknown[] = [];
    const part: GroupHelper = (raw, items) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('part(...) expects an object.');
      const spec = raw as Record<string, unknown>;
      return group({ ...spec, kind: 'part', name: spec.name ?? `Part ${groups.filter((g) => (g as { kind?: string }).kind === 'part').length + 1}` }, items);
    };
    let nextShapeId = 1;
    const rectangle = (raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('rectangle(...) expects an object.');
      if (rectangles.length >= 2000) throw new Error('A sketch can contain at most 2000 rectangles.');
      const spec = raw as Record<string, unknown>;
      rejectOwnershipFields(spec);
      const result = { id: spec.id ?? `rectangle-${nextShapeId++}`, name: spec.name ?? `Rectangle ${rectangles.length + 1}`, size: spec.size, position: spec.position ?? [0, 0], color: spec.color ?? '#ffffff' };
      rectangles.push(result);
      members.set(result, 'shape');
      return result;
    };
    const line = (raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('line(...) expects an object.');
      const spec = raw as Record<string, unknown>;
      rejectOwnershipFields(spec);
      const point = (value: unknown): [number, number] => {
        if (!Array.isArray(value) || value.length !== 2 || value.some((v) => typeof v !== 'number' && typeof v !== 'string')) throw new Error('Line start and end must have two inch values.');
        return value.map((v) => parseInches(v)) as [number, number];
      };
      const start = point(spec.start), end = point(spec.end);
      if (rectangles.length >= 2000) throw new Error('A sketch can contain at most 2000 shapes.');
      const result = { id: spec.id ?? `line-${nextShapeId++}`, name: spec.name ?? `Line ${rectangles.length + 1}`, kind: 'line', position: start, size: [end[0] - start[0], end[1] - start[1]], color: spec.color ?? '#ffffff' };
      rectangles.push(result);
      members.set(result, 'shape');
      return result;
    };
    const circle = (raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('circle(...) expects an object.');
      const spec = raw as Record<string, unknown>;
      const radius = spec.radius;
      if (typeof radius !== 'string' && typeof radius !== 'number') throw new Error('Circle radius must be an inch string or number.');
      const diameter = 2 * parseInches(radius);
      const result = { ...rectangle({ ...spec, id: spec.id ?? `circle-${nextShapeId++}`, name: spec.name ?? `Circle ${rectangles.length + 1}`, size: [diameter, diameter] }), kind: 'circle' };
      rectangles[rectangles.length - 1] = result;
      members.set(result, 'shape');
      return result;
    };
    if (event.data.kind === 'sketch') {
      const evaluate = new Function('rectangle', 'line', 'circle', 'inch', 'group', 'measurement', `"use strict";\n${event.data.source}`);
      evaluate(rectangle, line, circle, parseInches, group, measurement);
      const validGroups = validateGroups(groups, true);
      const shapes = validateSketchShapes(rectangles, validGroups);
      workerScope.postMessage({ rectangles: shapes, groups: validGroups, measurements: validateMeasurements(measurements, { rectangles: shapes, groups: validGroups }) });
      return;
    }
    const sketches: unknown[] = [];
    const sketch = (raw: unknown, items: unknown = []) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('sketch(properties, items) expects properties.');
      if (sketches.length >= 2000) throw new Error('At most 2000 sketches are allowed.');
      const spec = raw as Record<string, unknown>;
      rejectOwnershipFields(spec);
      if (Object.hasOwn(spec, 'shapes') || Object.hasOwn(spec, 'items')) throw new Error('Use sketch(properties, items) to define rectangles, circles and lines.');
      if (!Array.isArray(items)) throw new Error('Sketch items must be an array of rectangle(), circle() or line() results.');
      const seen = new Set<object>();
      const shapes = Array.from(items, (item: unknown) => {
        if (!item || typeof item !== 'object' || members.get(item) !== 'shape') throw new Error('Sketch items must be results returned by rectangle(), circle() or line().');
        if (seen.has(item) || claimedShapes.has(item)) throw new Error('A shape cannot appear twice or belong to two sketches.');
        seen.add(item);
        return item;
      });
      shapes.forEach((shape) => claimedShapes.add(shape));
      const result = { id: spec.id ?? 'sketch-' + (sketches.length + 1), name: spec.name ?? 'Sketch ' + (sketches.length + 1), axis: spec.axis ?? 'z', size: spec.size ?? [12, 8], position: spec.position ?? [0, 0, 0], color: spec.color ?? '#86a9a3', shapes, ...(spec.referenceName === undefined ? {} : { referenceName: spec.referenceName }) };
      sketches.push(result);
      return registerObject(result);
    };
    const boxes: unknown[] = [];
    const variables: unknown[] = [];
    let nextBoxId = 1;
    const box = (raw: unknown) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("box(...) expects an object.");
      if (boxes.length >= 2000) throw new Error("A model can contain at most 2000 boxes.");
      const spec = raw as Record<string, unknown>;
      rejectOwnershipFields(spec);
      const dimension = (value: unknown, label: string): number | string => {
        if (typeof value !== "string" && typeof value !== "number") throw new Error(`${label} must be an inch string or number.`);
        return value;
      };
      const vector = (value: unknown, label: string, fallback?: [number, number, number]): [number | string, number | string, number | string] => {
        if (value === undefined && fallback) return fallback;
        if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} must have three values.`);
        return value.map((part, index) => dimension(part, `${label}[${index}]`)) as [number | string, number | string, number | string];
      };
      const id = spec.id === undefined ? `box-${nextBoxId++}` : spec.id;
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
      return registerObject(result);
    };
    const variable = (raw: unknown) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("variable(...) expects an object.");
      variables.push(raw);
      return raw;
    };
    const cylinder = (raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('cylinder(...) expects an object.');
      const spec = raw as Record<string, unknown>;
      const radius = spec.radius;
      if (typeof radius !== 'string' && typeof radius !== 'number') throw new Error('Cylinder radius must be an inch string or number.');
      const diameter = typeof radius === 'number' ? 2 * parseInches(radius) : 1;
      if (spec.axis !== undefined && !['x', 'y', 'z'].includes(spec.axis as string)) throw new Error('Cylinder axis must be x, y or z.');
      const axis = spec.axis as CylinderAxis | undefined;
      const size: unknown[] = cylinderSize(diameter / 2, 1, axis); size[cylinderAxes({ axis }).lengthAxis] = spec.length;
      const result = { ...box({ ...spec, id: spec.id ?? `cylinder-${nextBoxId++}`, name: spec.name ?? `Cylinder ${boxes.length + 1}`, size }), kind: 'cylinder', ...(axis && axis !== 'z' ? { axis } : {}) };
      if (typeof radius === 'string') result.expressions = { ...(result.expressions as object), radius };
      boxes[boxes.length - 1] = result;
      return registerObject(result);
    };
    // Only defer variable references; ordinary inch() calls retain legacy numeric behavior.
    const inch = (value: string | number) => typeof value === "string" && /\bvar\s*\(/.test(value) ? value : parseInches(value);
    // Code runs in a disposable worker. The main thread enforces a hard timeout.
    const evaluate = new Function("box", "variable", "inch", "group", "sketch", "rectangle", "line", "circle", "cylinder", "measurement", "part", `"use strict";\n${event.data.source}`);
    evaluate(box, variable, inch, group, sketch, rectangle, line, circle, cylinder, measurement, part);
    if (rectangles.some((shape) => !claimedShapes.has(shape as object))) throw new Error("Model rectangles, circles and lines must be inside sketch(properties, items).");
    const response: CompileResponse = resolveModel(boxes, variables, groups, sketches, measurements);
    workerScope.postMessage(response);
  } catch (error) {
    const response: CompileResponse = { error: error instanceof Error ? error.message : String(error) };
    workerScope.postMessage(response);
  }
});
