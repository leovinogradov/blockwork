/** The canonical model representation. All lengths are inches on a 1/64" grid. */
export type FaceName = "front" | "back" | "left" | "right" | "top" | "bottom";
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
  id: string;
  name: string;
  /** X width, Y depth, Z height. */
  size: [number, number, number];
  /** Minimum corner in X, Y, Z. */
  position: [number, number, number];
  color: string;
  relative?: RelativePlacement;
};

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
export function parseInches(value: string | number): number {
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

function tuple(value: unknown, label: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`${label} must contain exactly three dimensions.`);
  }
  const values = value.map((part) => {
    if (typeof part !== "number" || !Number.isFinite(part)) throw new Error(`${label} values must be finite numbers.`);
    return snap(part);
  });
  return values as [number, number, number];
}

function normalizeRelative(value: unknown, id: string): RelativePlacement | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Box ${id} relative placement must be an object.`);
  const raw = value as Record<string, unknown>;
  const faces: FaceName[] = ["front", "back", "left", "right", "top", "bottom"];
  if (typeof raw.boxId !== "string" || !raw.boxId.trim()) throw new Error(`Box ${id} relative placement needs a box ID.`);
  if (typeof raw.face !== "string" || !faces.includes(raw.face as FaceName)) throw new Error(`Box ${id} has an invalid relative face.`);
  const length = (v: unknown, label: string) => {
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`Box ${id} relative ${label} must be a finite number.`);
    return snap(v);
  };
  const edge = (v: unknown, axis: "u" | "v") => {
    if (v === undefined) return undefined;
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`Box ${id} relative ${axis} edge must be an object.`);
    const e = v as Record<string, unknown>;
    const allowed = axis === "u" ? ["left", "right"] : ["bottom", "top"];
    if (typeof e.side !== "string" || !allowed.includes(e.side)) throw new Error(`Box ${id} has an invalid relative ${axis} side.`);
    return { side: e.side as "left" | "right" | "bottom" | "top", offset: length(e.offset, `${axis} offset`) };
  };
  return {
    boxId: raw.boxId,
    face: raw.face as FaceName,
    offset: length(raw.offset, "offset"),
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
export function validateBoxes(input: unknown): BoxSpec[] {
  if (!Array.isArray(input)) throw new Error("Model must be an array of boxes.");
  if (input.length > 2000) throw new Error("A model can contain at most 2000 boxes.");
  const ids = new Set<string>();
  const boxes = input.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`Box ${index + 1} must be an object.`);
    const raw = entry as Record<string, unknown>;
    if (typeof raw.id !== "string" || !raw.id.trim()) throw new Error(`Box ${index + 1} needs an ID.`);
    if (ids.has(raw.id)) throw new Error(`Duplicate box ID: ${raw.id}`);
    ids.add(raw.id);
    if (typeof raw.name !== "string" || !raw.name.trim()) throw new Error(`Box ${raw.id} needs a name.`);
    if (typeof raw.color !== "string" || !raw.color.trim()) throw new Error(`Box ${raw.id} needs a color.`);
    const size = tuple(raw.size, `Box ${raw.id} size`);
    const position = tuple(raw.position, `Box ${raw.id} position`);
    if (size.some((part) => part <= 0)) throw new Error(`Box ${raw.id} sizes must be positive after 1/64-inch snapping.`);
    const relative = normalizeRelative(raw.relative, raw.id);
    return { id: raw.id, name: raw.name, size, position, color: raw.color, ...(relative ? { relative } : {}) };
  });
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
      box.position = placeOnFace(parent, box);
    }
    state.set(box.id, "done");
    return box;
  };
  return boxes.map(resolve);
}

/** Make a default outward child whose footprint matches the selected face. */
export function createBoxFromFace(parent: BoxSpec, face: FaceName, id: string): BoxSpec {
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
    relative: { boxId: parent.id, face, offset: 0, u: { side: "left", offset: 0 }, v: { side: "bottom", offset: 0 } },
  };
  // The selected parent may itself be relative; callers provide its resolved model value.
  return validateBoxes([{ ...parent, relative: undefined }, child])[1];
}

/** Turn the current model into plain editable JavaScript for the code editor. */
export function generateSource(boxes: BoxSpec[]): string {
  const lines = ["// Edit these boxes to build your model. Dimensions are in inches."];
  for (const box of validateBoxes(boxes)) {
    const vec = (values: number[]) => `[${values.map((n) => `inch(${JSON.stringify(formatInches(n))})`).join(", ")}]`;
    const relative = box.relative
      ? `, relative: { boxId: ${JSON.stringify(box.relative.boxId)}, face: ${JSON.stringify(box.relative.face)}, offset: inch(${JSON.stringify(formatInches(box.relative.offset))})${box.relative.u ? `, u: { side: ${JSON.stringify(box.relative.u.side)}, offset: inch(${JSON.stringify(formatInches(box.relative.u.offset))}) }` : ""}${box.relative.v ? `, v: { side: ${JSON.stringify(box.relative.v.side)}, offset: inch(${JSON.stringify(formatInches(box.relative.v.offset))}) }` : ""} }`
      : "";
    lines.push(
      `box({ id: ${JSON.stringify(box.id)}, name: ${JSON.stringify(box.name)}, size: ${vec(box.size)}, position: ${vec(box.position)}, color: ${JSON.stringify(box.color)}${relative} });`,
    );
  }
  return `${lines.join("\n")}\n`;
}
