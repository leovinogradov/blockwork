import { generateGroupedSource, groupOffset, reparentPosition, validateGroups, validateGroupMembers, worldPosition, type GroupSpec } from './groups';
import { serializeModelSketch, validateModelSketches, type ModelSketch } from './model-sketch';
import { serializeMeasurement, validateMeasurements, type Measurement } from './measurements';

/** The canonical model representation. All lengths are inches on a 1/64" grid. */
export type FaceName = "front" | "back" | "left" | "right" | "top" | "bottom";
export type CylinderAxis = 'x' | 'y' | 'z';
export type RelativePlacement = {
  boxId: string;
  face: FaceName;
  /** Outward gap from the referenced face. */
  offset: number;
  /** Inward distance from the named edge of the face. */
  u?: { side: "left" | "right"; offset: number };
  /** Inward distance from the named edge of the face. */
  v?: { side: "bottom" | "top"; offset: number };
};

export type BoxSpec = {
  /** Missing kind is a box. */
  kind?: 'cylinder';
  /** Cylinder length axis; omitted means Z. */
  axis?: CylinderAxis;
  id: string;
  name: string;
  /** X width, Y depth, Z height. */
  size: [number, number, number];
  /** Minimum corner in X, Y, Z. */
  position: [number, number, number];
  color: string;
  groupId?: string;
  relative?: RelativePlacement;
  /** Editable expressions retained separately from their resolved inch values. */
  expressions?: Partial<Record<NumericField, string>>;
};

export type NumericField = "radius" | "size.0" | "size.1" | "size.2" | "position.0" | "position.1" | "position.2" | "relative.offset" | "relative.u.offset" | "relative.v.offset";
export type VariableSpec = { name: string; value: number; expression?: string; description?: string };
export type ModelSpec = { boxes: BoxSpec[]; variables: VariableSpec[]; groups?: GroupSpec[]; sketches?: ModelSketch[]; measurements?: Measurement[] };

export function cylinderAxes(solid: { axis?: CylinderAxis }): { lengthAxis: 0 | 1 | 2; radialAxes: [0 | 1 | 2, 0 | 1 | 2] } {
  const lengthAxis = solid.axis === 'x' ? 0 : solid.axis === 'y' ? 1 : 2;
  return { lengthAxis, radialAxes: [0, 1, 2].filter((axis) => axis !== lengthAxis) as [0 | 1 | 2, 0 | 1 | 2] };
}

/** Map cylinder-local radial/radial/length coordinates to world X/Y/Z. */
export function cylinderAxisOrder(solid: { axis?: CylinderAxis }): [number, number, number] {
  const { radialAxes, lengthAxis } = cylinderAxes(solid);
  return [...radialAxes, lengthAxis];
}

export function cylinderSize(radius: number, length: number, axis: CylinderAxis = 'z'): [number, number, number] {
  const size: [number, number, number] = [radius * 2, radius * 2, radius * 2];
  size[cylinderAxes({ axis }).lengthAxis] = length;
  return size;
}

/** Change the length direction while retaining local dimensions and expressions. */
export function reorientCylinder(solid: BoxSpec, axis: CylinderAxis): BoxSpec {
  if (solid.kind !== 'cylinder') throw new Error('Only cylinders have a length axis.');
  const oldOrder = cylinderAxisOrder(solid), nextOrder = cylinderAxisOrder({ axis });
  const size = [...solid.size] as [number, number, number];
  const expressions = { ...solid.expressions };
  for (let i = 0; i < 3; i++) delete expressions[`size.${i}` as NumericField];
  oldOrder.forEach((oldIndex, localIndex) => {
    const nextIndex = nextOrder[localIndex];
    size[nextIndex] = solid.size[oldIndex];
    const expression = solid.expressions?.[`size.${oldIndex}` as NumericField];
    if (expression) expressions[`size.${nextIndex}` as NumericField] = expression;
  });
  const next: BoxSpec = { ...solid, size, expressions, axis };
  if (axis === 'z') delete next.axis;
  return next;
}

export class MissingVariableError extends Error {
  readonly variableName: string;
  constructor(name: string) {
    super(`Unknown variable: ${name}`);
    this.name = "MissingVariableError";
    this.variableName = name;
  }
}

export type FaceFrame = {
  normalAxis: 0 | 1 | 2;
  normalSign: 1 | -1;
  uAxis: 0 | 1 | 2;
  uSign: 1 | -1;
  vAxis: 0 | 1 | 2;
  vSign: 1 | -1;
};

/** Face coordinates as seen from outside the box. */
export function getFaceFrame(face: FaceName): FaceFrame {
  const frames: Record<FaceName, FaceFrame> = {
    front: { normalAxis: 1, normalSign: -1, uAxis: 0, uSign: 1, vAxis: 2, vSign: 1 },
    back: { normalAxis: 1, normalSign: 1, uAxis: 0, uSign: -1, vAxis: 2, vSign: 1 },
    right: { normalAxis: 0, normalSign: 1, uAxis: 1, uSign: 1, vAxis: 2, vSign: 1 },
    left: { normalAxis: 0, normalSign: -1, uAxis: 1, uSign: -1, vAxis: 2, vSign: 1 },
    top: { normalAxis: 2, normalSign: 1, uAxis: 0, uSign: 1, vAxis: 1, vSign: 1 },
    bottom: { normalAxis: 2, normalSign: -1, uAxis: 0, uSign: 1, vAxis: 1, vSign: -1 },
  };
  return frames[face];
}

const GRID = 64;

function snap(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Dimensions must be finite numbers.");
  const ticks = Math.round(value * GRID);
  if (!Number.isSafeInteger(ticks)) throw new Error("Dimension is too large to preserve 1/64-inch precision.");
  const snapped = ticks / GRID;
  if (!Number.isFinite(snapped)) throw new Error("Dimension is too large to represent.");
  return Object.is(snapped, -0) ? 0 : snapped;
}

/** Parse inch arithmetic and snap its final result to 1/64 inch. */
export function parseInches(value: string | number, variables?: Record<string, number> | ((name: string) => number)): number {
  if (typeof value === "number") return snap(value);
  if (typeof value !== "string") throw new Error("A dimension must be a number or inch string.");

  let text = value.trim();
  if (!text) throw new Error("A dimension cannot be empty.");
  text = text.replace(/\s*(?:inches|inch|in|"|″)\s*$/i, "").trim();

  let cursor = 0;
  let depth = 0;
  const skipSpace = () => { while (/\s/.test(text[cursor] ?? "")) cursor++; };
  const fail = (): never => { throw new Error(`Invalid inch value: ${value}`); };
  const expression = (): number => {
    let result = product();
    while (true) {
      skipSpace();
      const operator = text[cursor];
      if (operator !== "+" && operator !== "-") return result;
      cursor++;
      const right = product();
      result = operator === "+" ? result + right : result - right;
    }
  };
  const product = (): number => {
    let result = primary();
    while (true) {
      skipSpace();
      const operator = text[cursor];
      if (operator !== "*" && operator !== "/") return result;
      cursor++;
      const right = primary();
      if (operator === "/" && right === 0) throw new Error("A dimension cannot be divided by zero.");
      result = operator === "*" ? result * right : result / right;
    }
  };
  const primary = (): number => {
    skipSpace();
    let sign = 1;
    if (text[cursor] === "+" || text[cursor] === "-") {
      if (text[cursor++] === "-") sign = -1;
      skipSpace();
      if (text[cursor] === "+" || text[cursor] === "-") fail();
    }
    if (text[cursor] === "(") {
      if (++depth > 64) throw new Error("Dimension expression is nested too deeply.");
      cursor++;
      const result = expression();
      skipSpace();
      if (text[cursor++] !== ")") fail();
      depth--;
      return sign * result;
    }
    const rest = text.slice(cursor);
    const variable = /^var\(([A-Za-z_][A-Za-z0-9_]*)\)/.exec(rest);
    if (variable) {
      cursor += variable[0].length;
      const lookup = typeof variables === "function"
        ? variables
        : (name: string) => variables && Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : undefined;
      const resolved = lookup?.(variable[1]);
      if (resolved === undefined) throw new MissingVariableError(variable[1]);
      if (typeof resolved !== "number" || !Number.isFinite(resolved)) fail();
      return sign * resolved;
    }
    const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)/.exec(rest);
    const decimal = /^(?:(\d+)(?:\.(\d*))?|\.(\d+))/.exec(rest);
    let parsed = 0;
    if (mixed) {
      const whole = Number(mixed[1]), numerator = Number(mixed[2]), denominator = Number(mixed[3]);
      if (denominator === 0 || numerator >= denominator) throw new Error(`Invalid inch fraction: ${value}`);
      cursor += mixed[0].length;
      parsed = whole + numerator / denominator;
    } else if (decimal) {
      const literal = decimal[0];
      cursor += literal.length;
      parsed = Number(literal);
    } else fail();
    return sign * parsed;
  };

  if (text.length > 1024) throw new Error("Dimension expression is too long.");
  const parsed = expression();
  skipSpace();
  if (cursor !== text.length || !Number.isFinite(parsed)) fail();
  return snap(parsed);
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

/** Format a length as a simplified fraction, without adding an inch mark. */
export function formatInches(value: number): string {
  const snapped = snap(value);
  const ticks = Math.round(Math.abs(snapped) * GRID);
  if (ticks === 0) return "0";
  const whole = Math.floor(ticks / GRID);
  const remainder = ticks % GRID;
  const sign = snapped < 0 ? "-" : "";
  if (!remainder) return `${sign}${whole}`;
  const divisor = gcd(remainder, GRID);
  const fraction = `${remainder / divisor}/${GRID / divisor}`;
  return `${sign}${whole ? `${whole} ` : ""}${fraction}`;
}

function expressionMap(value: unknown, id: string, hasRelative: boolean): Partial<Record<NumericField, string>> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Box ${id} expressions must be an object.`);
  const allowed: NumericField[] = ["radius", "size.0", "size.1", "size.2", "position.0", "position.1", "position.2", "relative.offset", "relative.u.offset", "relative.v.offset"];
  const output: Partial<Record<NumericField, string>> = {};
  for (const [key, expression] of Object.entries(value as Record<string, unknown>)) {
    if (!allowed.includes(key as NumericField) || key.startsWith("relative") && !hasRelative) throw new Error(`Box ${id} has an invalid expression field: ${key}.`);
    if (typeof expression !== "string" || !expression.trim()) throw new Error(`Box ${id} expression ${key} must be a non-empty string.`);
    output[key as NumericField] = expression;
  }
  return output;
}

function variableResolver(variables: VariableSpec[]): (name: string) => number {
  const values = new Map(variables.map((variable) => [variable.name, variable.value]));
  return (name) => {
    const value = values.get(name);
    if (value === undefined) throw new MissingVariableError(name);
    return value;
  };
}

/** Validate and resolve named inch variables, including forward references. */
export function resolveVariables(input: unknown): VariableSpec[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new Error("Variables must be an array.");
  const raw = new Map<string, { value: unknown; expression?: string; description?: string }>();
  for (const entry of input) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("A variable must be an object.");
    const spec = entry as Record<string, unknown>;
    if (typeof spec.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(spec.name)) throw new Error("Variable names must be identifiers.");
    if (raw.has(spec.name)) throw new Error(`Duplicate variable name: ${spec.name}`);
    if (spec.description !== undefined && typeof spec.description !== "string") throw new Error(`Variable ${spec.name} description must be a string.`);
    if (spec.expression !== undefined && (typeof spec.expression !== "string" || !spec.expression.trim())) throw new Error(`Variable ${spec.name} expression must be a non-empty string.`);
    const inferred = typeof spec.value === "string" ? spec.value : undefined;
    raw.set(spec.name, { value: spec.value, ...(typeof spec.expression === "string" ? { expression: spec.expression } : inferred ? { expression: inferred } : {}), ...(typeof spec.description === "string" ? { description: spec.description } : {}) });
  }
  const resolved = new Map<string, number>();
  const visiting = new Set<string>();
  const get = (name: string): number => {
    const done = resolved.get(name); if (done !== undefined) return done;
    const spec = raw.get(name); if (!spec) throw new MissingVariableError(name);
    if (visiting.has(name)) throw new Error(`Variable cycle involving ${name}.`);
    visiting.add(name);
    const source = spec.expression ?? spec.value;
    if (typeof source !== "number" && typeof source !== "string") throw new Error(`Variable ${name} value must be a number or inch expression.`);
    const value = parseInches(source, get);
    visiting.delete(name); resolved.set(name, value); return value;
  };
  return [...raw].map(([name, spec]) => ({ name, value: get(name), ...(spec.expression ? { expression: spec.expression } : {}), ...(spec.description !== undefined ? { description: spec.description } : {}) }));
}

function tuple(value: unknown, label: string, expressions: Partial<Record<NumericField, string>>, prefix: "size" | "position", resolver: (name: string) => number): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`${label} must contain exactly three dimensions.`);
  }
  const values = value.map((part, index) => {
    const expression = expressions[`${prefix}.${index}` as NumericField];
    const source = expression ?? part;
    if (typeof source !== "number" && typeof source !== "string") throw new Error(`${label} values must be finite numbers or expressions.`);
    return parseInches(source, resolver);
  });
  return values as [number, number, number];
}

function normalizeRelative(value: unknown, id: string, expressions: Partial<Record<NumericField, string>>, resolver: (name: string) => number): RelativePlacement | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Box ${id} relative placement must be an object.`);
  const raw = value as Record<string, unknown>;
  const faces: FaceName[] = ["front", "back", "left", "right", "top", "bottom"];
  if (typeof raw.boxId !== "string" || !raw.boxId.trim()) throw new Error(`Box ${id} relative placement needs a box ID.`);
  if (typeof raw.face !== "string" || !faces.includes(raw.face as FaceName)) throw new Error(`Box ${id} has an invalid relative face.`);
  const length = (v: unknown, label: string, field: NumericField) => {
    const source = expressions[field] ?? v;
    if (typeof source !== "number" && typeof source !== "string") throw new Error(`Box ${id} relative ${label} must be a finite number or expression.`);
    return parseInches(source, resolver);
  };
  const edge = (v: unknown, axis: "u" | "v") => {
    if (v === undefined) return undefined;
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`Box ${id} relative ${axis} edge must be an object.`);
    const e = v as Record<string, unknown>;
    const allowed = axis === "u" ? ["left", "right"] : ["bottom", "top"];
    if (typeof e.side !== "string" || !allowed.includes(e.side)) throw new Error(`Box ${id} has an invalid relative ${axis} side.`);
    return { side: e.side as "left" | "right" | "bottom" | "top", offset: length(e.offset, `${axis} offset`, `relative.${axis}.offset` as NumericField) };
  };
  return {
    boxId: raw.boxId,
    face: raw.face as FaceName,
    offset: length(raw.offset, "offset", "relative.offset"),
    ...(raw.u === undefined ? {} : { u: edge(raw.u, "u")! as RelativePlacement["u"] }),
    ...(raw.v === undefined ? {} : { v: edge(raw.v, "v")! as RelativePlacement["v"] }),
  };
}

function placeOnFace(parent: BoxSpec, child: BoxSpec): [number, number, number] {
  const relative = child.relative!;
  const frame = getFaceFrame(relative.face);
  const position = [...child.position] as [number, number, number];
  const parentMax = parent.position.map((p, axis) => p + parent.size[axis]);
  const normal = frame.normalAxis;
  position[normal] = frame.normalSign > 0
    ? parentMax[normal] + relative.offset
    : parent.position[normal] - child.size[normal] - relative.offset;
  const applyEdge = (axis: 0 | 1 | 2, sign: 1 | -1, side: string, gap: number) => {
    const fromMin = (sign > 0 && (side === "left" || side === "bottom")) || (sign < 0 && (side === "right" || side === "top"));
    position[axis] = fromMin
      ? parent.position[axis] + gap
      : parentMax[axis] - gap - child.size[axis];
  };
  if (relative.u) applyEdge(frame.uAxis, frame.uSign, relative.u.side, relative.u.offset);
  if (relative.v) applyEdge(frame.vAxis, frame.vSign, relative.v.side, relative.v.offset);
  return position.map(snap) as [number, number, number];
}

/** Validate, normalize, and resolve relative placements in canonical snapped BoxSpecs. */
export function validateBoxes(input: unknown, variables: VariableSpec[] = [], groups: GroupSpec[] = []): BoxSpec[] {
  if (!Array.isArray(input)) throw new Error("Model must be an array of boxes.");
  if (input.length > 2000) throw new Error("A model can contain at most 2000 boxes.");
  const resolvedVariables = resolveVariables(variables);
  const ids = new Set<string>();
  const boxes = input.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`Box ${index + 1} must be an object.`);
    const raw = entry as Record<string, unknown>;
    if (typeof raw.id !== "string" || !raw.id.trim()) throw new Error(`Box ${index + 1} needs an ID.`);
    if (ids.has(raw.id)) throw new Error(`Duplicate box ID: ${raw.id}`);
    ids.add(raw.id);
    if (typeof raw.name !== "string" || !raw.name.trim()) throw new Error(`Box ${raw.id} needs a name.`);
    if (typeof raw.color !== "string" || !raw.color.trim()) throw new Error(`Box ${raw.id} needs a color.`);
    if (raw.groupId !== undefined && (typeof raw.groupId !== 'string' || !raw.groupId.trim())) throw new Error('Box groupId must be a group ID.');
    const hasRelative = raw.relative !== undefined;
    const expressions = expressionMap(raw.expressions, raw.id, hasRelative);
    const remember = (key: NumericField, value: unknown) => { if (typeof value === "string" && !expressions[key]) expressions[key] = value; };
    if (Array.isArray(raw.size)) raw.size.forEach((value, index) => remember(`size.${index}` as NumericField, value));
    if (Array.isArray(raw.position)) raw.position.forEach((value, index) => remember(`position.${index}` as NumericField, value));
    if (hasRelative && raw.relative && typeof raw.relative === "object" && !Array.isArray(raw.relative)) {
      const relativeRaw = raw.relative as Record<string, unknown>;
      remember("relative.offset", relativeRaw.offset);
      for (const axis of ["u", "v"] as const) {
        const edge = relativeRaw[axis];
        if (edge && typeof edge === "object" && !Array.isArray(edge)) remember(`relative.${axis}.offset` as NumericField, (edge as Record<string, unknown>).offset);
      }
    }
    if (expressions["relative.u.offset"] && (!raw.relative || typeof raw.relative !== "object" || Array.isArray(raw.relative) || !(raw.relative as Record<string, unknown>).u)) throw new Error(`Box ${raw.id} expression relative.u.offset requires a relative u edge.`);
    if (expressions["relative.v.offset"] && (!raw.relative || typeof raw.relative !== "object" || Array.isArray(raw.relative) || !(raw.relative as Record<string, unknown>).v)) throw new Error(`Box ${raw.id} expression relative.v.offset requires a relative v edge.`);
    const resolver = variableResolver(resolvedVariables);
    if (raw.axis !== undefined && (raw.kind !== 'cylinder' || !['x', 'y', 'z'].includes(raw.axis as string))) throw new Error('Cylinder axis must be x, y or z.');
    const axis = raw.axis as CylinderAxis | undefined;
    const { radialAxes } = cylinderAxes({ axis });
    const size = tuple(raw.size, `Box ${raw.id} size`, expressions, "size", resolver);
    if (expressions.radius) {
      if (raw.kind !== 'cylinder') throw new Error('Radius expressions require a cylinder.');
      const radius = parseInches(expressions.radius, resolver);
      if (radius <= 0) throw new Error('Cylinder radius must be positive after 1/64-inch snapping.');
      size[radialAxes[0]] = size[radialAxes[1]] = parseInches(2 * radius);
    }
    const position = tuple(raw.position, `Box ${raw.id} position`, expressions, "position", resolver);
    if (size.some((part) => part <= 0)) throw new Error(`Box ${raw.id} sizes must be positive after 1/64-inch snapping.`);
    if (raw.kind !== undefined && raw.kind !== 'cylinder') throw new Error('Unknown solid kind.');
    if (raw.kind === 'cylinder' && size[radialAxes[0]] !== size[radialAxes[1]]) throw new Error('Cylinder radial dimensions must have the same diameter.');
    const relative = normalizeRelative(raw.relative, raw.id, expressions, resolver);
    return { id: raw.id, name: raw.name, size, position, color: raw.color, ...(raw.kind === 'cylinder' ? { kind: 'cylinder' as const } : {}), ...(axis && axis !== 'z' ? { axis } : {}), ...(raw.groupId ? { groupId: raw.groupId as string } : {}), ...(relative ? { relative } : {}), ...(Object.keys(expressions).length ? { expressions } : {}) };
  });
  validateGroupMembers(boxes, groups);
  const byId = new Map(boxes.map((box) => [box.id, box]));
  const state = new Map<string, "visiting" | "done">();
  const resolve = (box: BoxSpec): BoxSpec => {
    if (state.get(box.id) === "visiting") throw new Error(`Relative placement cycle involving box ${box.id}.`);
    if (state.get(box.id) === "done") return box;
    state.set(box.id, "visiting");
    if (box.relative) {
      const parent = byId.get(box.relative.boxId);
      if (!parent) throw new Error(`Box ${box.id} references unknown box ${box.relative.boxId}.`);
      if (parent === box) throw new Error(`Box ${box.id} cannot be placed relative to itself.`);
      resolve(parent);
      // Face relations resolve in world space, even across group boundaries.
      const offset = groupOffset(groups, box.groupId);
      const placed = placeOnFace({ ...parent, position: worldPosition(parent.position, groups, parent.groupId) }, { ...box, position: worldPosition(box.position, groups, box.groupId) });
      box.position = placed.map((n, i) => n - offset[i]) as [number, number, number];
    }
    state.set(box.id, "done");
    return box;
  };
  return boxes.map(resolve);
}

/** Resolve a complete model while retaining its editable expression text. */
export function resolveModel(boxes: unknown, variables: unknown = [], inputGroups: unknown = [], inputSketches: unknown = [], inputMeasurements: unknown = []): ModelSpec {
  const resolvedVariables = resolveVariables(variables);
  const groups = validateGroups(inputGroups);
  const validBoxes = validateBoxes(boxes, resolvedVariables, groups);
  const sketches = validateModelSketches(inputSketches, groups);
  const ids = new Set(validBoxes.map((box) => box.id));
  for (const sketch of sketches) if (ids.has(sketch.id)) throw new Error(`Box and sketch IDs must be distinct: ${sketch.id}.`);
  const measurements = validateMeasurements(inputMeasurements, { boxes: validBoxes, sketches, groups });
  return { variables: resolvedVariables, boxes: validBoxes, ...(groups.length ? { groups } : {}), ...(sketches.length ? { sketches } : {}), ...(measurements.length ? { measurements } : {}) };
}

/** Change ownership without moving the box or removing its relative relations. */
export function reparentBox(box: BoxSpec, groups: GroupSpec[], nextGroup?: string): BoxSpec {
  const position = reparentPosition(box.position, groups, box.groupId, nextGroup);
  const expressions = { ...box.expressions };
  for (let i = 0; i < 3; i++) {
    const key = `position.${i}` as NumericField, expression = expressions[key];
    if (expression) expressions[key] = `(${expression}) + (${position[i] - box.position[i]})`;
  }
  return { ...box, position, expressions, groupId: nextGroup };
}

/**
 * Remove a variable without changing the current model: its exact `var(name)`
 * references are replaced with the resolved decimal value, parenthesized to
 * preserve arithmetic precedence.
 */
export function removeVariable(boxes: BoxSpec[], variables: VariableSpec[], name: string, groups: GroupSpec[] = []): ModelSpec {
  const model = resolveModel(boxes, variables, groups);
  const removed = model.variables.find((variable) => variable.name === name);
  if (!removed) throw new MissingVariableError(name);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const token = new RegExp(`var\\(${escaped}\\)`, "g");
  const replacement = `(${removed.value})`;
  const replace = (expression: string) => expression.replace(token, replacement);
  const nextVariables = model.variables
    .filter((variable) => variable.name !== name)
    .map((variable) => ({ ...variable, ...(variable.expression ? { expression: replace(variable.expression) } : {}) }));
  const nextBoxes = model.boxes.map((box) => {
    if (!box.expressions) return { ...box, size: [...box.size] as [number, number, number], position: [...box.position] as [number, number, number], relative: box.relative ? { ...box.relative, u: box.relative.u ? { ...box.relative.u } : undefined, v: box.relative.v ? { ...box.relative.v } : undefined } : undefined };
    const expressions = Object.fromEntries(Object.entries(box.expressions).map(([field, expression]) => [field, replace(expression)])) as Partial<Record<NumericField, string>>;
    return { ...box, size: [...box.size] as [number, number, number], position: [...box.position] as [number, number, number], relative: box.relative ? { ...box.relative, u: box.relative.u ? { ...box.relative.u } : undefined, v: box.relative.v ? { ...box.relative.v } : undefined } : undefined, expressions };
  });
  return resolveModel(nextBoxes, nextVariables, groups);
}

/** Make a default outward child whose footprint matches the selected face. */
export function createBoxFromFace(parent: BoxSpec, face: FaceName, id: string, groups: GroupSpec[] = []): BoxSpec {
  const frame = getFaceFrame(face);
  const size: [number, number, number] = [0, 0, 0];
  size[frame.normalAxis] = 3 / 4;
  size[frame.uAxis] = parent.size[frame.uAxis];
  size[frame.vAxis] = parent.size[frame.vAxis];
  const child: BoxSpec = {
    id,
    name: `${parent.name} ${face}`,
    size,
    position: [...parent.position],
    color: "#8795a1",
    ...(parent.groupId ? { groupId: parent.groupId } : {}),
    relative: { boxId: parent.id, face, offset: 0, u: { side: "left", offset: 0 }, v: { side: "bottom", offset: 0 } },
  };
  // The selected parent may itself be relative; callers provide its resolved model value.
  return validateBoxes([{ ...parent, relative: undefined, expressions: undefined }, child], [], groups)[1];
}

/** Attach a cylinder with its circular end on the selected face and length pointing outward. */
export function createCylinderFromFace(parent: BoxSpec, face: FaceName, id: string, groups: GroupSpec[] = [], dimensions?: { radius: number; length: number }): BoxSpec {
  const frame = getFaceFrame(face);
  const radius = dimensions ? parseInches(dimensions.radius) : Math.max(1 / 64, Math.floor(Math.min(parent.size[frame.uAxis], parent.size[frame.vAxis]) * 32) / 64);
  const length = dimensions ? parseInches(dimensions.length) : 3 / 4;
  if (radius <= 0 || length <= 0) throw new Error('Radius and length must be positive.');
  const axis = (['x', 'y', 'z'] as const)[frame.normalAxis];
  const size = cylinderSize(radius, length, axis);
  const child: BoxSpec = {
    id, name: `${parent.name} ${face} cylinder`, kind: 'cylinder', ...(axis !== 'z' ? { axis } : {}), size,
    position: [...parent.position], color: '#8795a1', ...(parent.groupId ? { groupId: parent.groupId } : {}),
    relative: { boxId: parent.id, face, offset: 0, u: { side: 'left', offset: 0 }, v: { side: 'bottom', offset: 0 } },
  };
  return validateBoxes([{ ...parent, relative: undefined, expressions: undefined }, child], [], groups)[1];
}

/** Turn the current model into plain editable JavaScript for the code editor. */
export function generateSource(boxes: BoxSpec[], variables: VariableSpec[] = [], groups: GroupSpec[] = [], order: string[] = [], sketches: ModelSketch[] = [], measurements: Measurement[] = []): string {
  const lines = ["// Edit these components to build your model. Dimensions are in inches."];
  const model = resolveModel(boxes, variables, groups, sketches, measurements);
  for (const variable of model.variables) {
    lines.push(`variable({ name: ${JSON.stringify(variable.name)}, value: inch(${JSON.stringify(formatInches(variable.value))})${variable.expression ? `, expression: ${JSON.stringify(variable.expression)}` : ""}${variable.description !== undefined ? `, description: ${JSON.stringify(variable.description)}` : ""} });`);
  }
  if (model.variables.length) lines.push("");
  lines.push(...generateGroupedSource<BoxSpec | ModelSketch | Measurement>(model.groups ?? [], [...model.boxes, ...(model.sketches ?? []), ...(model.measurements ?? [])], (box) => {
    if ('start' in box) return serializeMeasurement(box);
    if ('shapes' in box) return serializeModelSketch(box);
    const field = (key: NumericField, value: number) => box.expressions?.[key] ? JSON.stringify(box.expressions[key]) : `inch(${JSON.stringify(formatInches(value))})`;
    const vec = (values: number[], prefix: "size" | "position") => `[${values.map((n, index) => field(`${prefix}.${index}` as NumericField, n)).join(", ")}]`;
    const relative = box.relative
      ? `, relative: { boxId: ${JSON.stringify(box.relative.boxId)}, face: ${JSON.stringify(box.relative.face)}, offset: ${field("relative.offset", box.relative.offset)}${box.relative.u ? `, u: { side: ${JSON.stringify(box.relative.u.side)}, offset: ${field("relative.u.offset", box.relative.u.offset)} }` : ""}${box.relative.v ? `, v: { side: ${JSON.stringify(box.relative.v.side)}, offset: ${field("relative.v.offset", box.relative.v.offset)} }` : ""} }`
      : "";
    const { lengthAxis, radialAxes } = cylinderAxes(box);
    const dimensions = box.kind === 'cylinder' ? `radius: ${field('radius', box.size[radialAxes[0]] / 2)}, length: ${field(`size.${lengthAxis}` as NumericField, box.size[lengthAxis])}${box.axis ? `, axis: ${JSON.stringify(box.axis)}` : ''}` : `size: ${vec(box.size, "size")}`;
    return `${box.kind ?? 'box'}({ id: ${JSON.stringify(box.id)}, name: ${JSON.stringify(box.name)}, ${dimensions}, position: ${vec(box.position, "position")}, color: ${JSON.stringify(box.color)}${relative} })`;
  }, order));
  return `${lines.join("\n")}\n`;
}
