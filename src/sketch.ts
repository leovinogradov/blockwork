import { generateGroupedSource, validateGroups, validateGroupMembers, type GroupSpec } from './groups';
import { formatInches, parseInches } from './model';
import { serializeMeasurement, validateMeasurements, type Measurement } from './measurements';

type SketchShapeBase = {
  id: string;
  name: string;
  /** Rectangle/text block width/height, circle diameter, or signed line displacement. */
  size: [number, number];
  /** Minimum corner, line start, or top-left text anchor. */
  position: [number, number];
  color: string;
  groupId?: string;
};

export type SketchTextShape = SketchShapeBase & {
  kind: 'text';
  text: string;
  /** Letter (capital H) height in inches. */
  textHeight: number;
};
export type SketchShape = SketchTextShape | (SketchShapeBase & { kind?: 'line' | 'circle' });

// Existing rectangle-only callers can retain their original type.
export type RectangleSpec = SketchShapeBase;

export type SketchSnap = { point: [number, number]; kind: 'corner' | 'endpoint' | 'center' | 'edge' | null };

export function trimSketchText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/(?:\n[^\S\n]*)+$/, '');
}

/** Geometry uses minimum corners; text stores its top-left anchor. */
export function sketchShapeOrigin(shape: SketchShape): [number, number] {
  return [shape.position[0], shape.position[1] - (shape.kind === 'text' ? shape.size[1] : 0)];
}

/** Drag text from its top left, and rectangles/circles from their center. */
export function sketchMoveAnchor(shape: SketchShape): [number, number] | null {
  if (shape.kind === 'line') return null;
  if (shape.kind === 'text') return [...shape.position];
  return [shape.position[0] + shape.size[0] / 2, shape.position[1] + shape.size[1] / 2];
}

/** Signed angle from +X: positive clockwise, negative counterclockwise. */
export function lineMeasurements([dx, dy]: [number, number]): { length: number; angle: number } {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('Line displacement must be finite.');
  const length = Math.hypot(dx, dy);
  const angle = length === 0 ? 0 : Math.atan2(dy === 0 ? 0 : -dy, dx) * 180 / Math.PI;
  return { length, angle };
}

export function lineDisplacement(length: number, angle: number): [number, number] {
  if (!Number.isFinite(length) || length < 0) throw new Error('Line length must be zero or positive.');
  if (!Number.isFinite(angle)) throw new Error('Line angle must be finite.');
  const radians = ((angle % 360 + 360) % 360) * Math.PI / 180;
  const clean = (value: number) => Math.abs(value) < 1e-10 ? 0 : value;
  return [clean(length * Math.cos(radians)), clean(-length * Math.sin(radians))];
}

export function parseLineAngle(value: string): number {
  const text = value.trim().replace(/\s*(?:°|deg(?:rees)?)$/i, '').trim();
  const angle = Number(text);
  if (!text || !Number.isFinite(angle)) throw new Error('Enter an angle in degrees.');
  const wrapped = angle % 360;
  return (wrapped > 180 ? wrapped - 360 : wrapped < -180 ? wrapped + 360 : wrapped) || 0;
}

/** Snap to corners, line endpoints, circle centers, or existing straight/curved edges. */
export function snapToSketchEdges(cursor: [number, number], rectangles: SketchShape[], tolerance: number): SketchSnap {
  const onGrid = (value: number) => Math.round(value * 64) / 64;
  const fallback: SketchSnap = { point: [onGrid(cursor[0]), onGrid(cursor[1])], kind: null };
  if (!(tolerance > 0)) return fallback;

  let closestCorner: [number, number] | null = null;
  let cornerKind: 'corner' | 'endpoint' | 'center' = 'corner';
  let cornerDistance = (tolerance * 0.75) ** 2;
  let closestEdge: [number, number] | null = null;
  let curvedEdge = false;
  let edgeDistance = tolerance ** 2;
  const considerCorner = (point: [number, number], kind: 'corner' | 'endpoint' | 'center' = 'corner') => {
    const distance = (cursor[0] - point[0]) ** 2 + (cursor[1] - point[1]) ** 2;
    if (distance <= cornerDistance) { cornerDistance = distance; closestCorner = point; cornerKind = kind; }
  };
  const considerEdge = (point: [number, number], curved = false) => {
    const distance = (cursor[0] - point[0]) ** 2 + (cursor[1] - point[1]) ** 2;
    if (distance <= edgeDistance) { edgeDistance = distance; closestEdge = point; curvedEdge = curved; }
  };
  for (const rectangle of rectangles) {
    const [x1, y1] = sketchShapeOrigin(rectangle);
    const x2 = x1 + rectangle.size[0], y2 = y1 + rectangle.size[1];
    if (rectangle.kind === 'circle') {
      const radius = rectangle.size[0] / 2, cx = x1 + radius, cy = y1 + radius;
      considerCorner([cx, cy], 'center');
      const distance = Math.hypot(cursor[0] - cx, cursor[1] - cy);
      if (distance > 0) considerEdge([cx + radius * (cursor[0] - cx) / distance, cy + radius * (cursor[1] - cy) / distance], true);
      continue;
    }
    if (rectangle.kind === 'line') {
      considerCorner([x1, y1], 'endpoint'); considerCorner([x2, y2], 'endpoint');
      const [dx, dy] = rectangle.size;
      const t = Math.max(0, Math.min(1, ((cursor[0] - x1) * dx + (cursor[1] - y1) * dy) / (dx * dx + dy * dy)));
      considerEdge([x1 + t * dx, y1 + t * dy]);
      continue;
    }
    considerCorner([x1, y1]); considerCorner([x2, y1]);
    considerCorner([x2, y2]); considerCorner([x1, y2]);
    const x = Math.max(x1, Math.min(cursor[0], x2));
    const y = Math.max(y1, Math.min(cursor[1], y2));
    considerEdge([x, y1]); considerEdge([x, y2]);
    considerEdge([x1, y]); considerEdge([x2, y]);
  }
  if (closestCorner) return { point: closestCorner, kind: cornerKind };
  if (closestEdge) return { point: curvedEdge ? closestEdge : [onGrid(closestEdge[0]), onGrid(closestEdge[1])], kind: 'edge' };
  return fallback;
}

export function lineFromPoints(start: [number, number], end: [number, number], id: string, name: string, color: string): SketchShape {
  return validateSketchShapes([{ id, name, color, kind: 'line', position: start, size: [end[0] - start[0], end[1] - start[1]] }])[0];
}

/** Circle input is a radius; canonical size remains its bounding dimensions. */
export function circleFromCenter(center: [number, number], radius: number | string, id: string, name: string, color: string): SketchShape {
  const d = 2 * parseInches(radius);
  const [x, y] = center.map((n) => parseInches(n * 2) / 2);
  return validateSketchShapes([{ id, name, color, kind: 'circle', size: [d, d], position: [x - d / 2, y - d / 2] }])[0];
}

/** Convert two sketch clicks into an axis-aligned rectangle in model X/Y coordinates. */
export function rectangleFromCorners(first: [number, number], opposite: [number, number], id: string, name: string, color: string): SketchShape {
  const size: [number, number] = [Math.abs(opposite[0] - first[0]), Math.abs(opposite[1] - first[1])];
  if (size.some((part) => part < 1 / 64)) throw new Error('Choose two different corners to draw a rectangle.');
  return validateSketchShapes([{ id, name, size, position: [Math.min(first[0], opposite[0]), Math.min(first[1], opposite[1])], color }])[0];
}

export function validateSketchShapes(input: unknown, inputGroups: unknown = []): SketchShape[] {
  if (!Array.isArray(input)) throw new Error('Sketch must be an array of shapes.');
  if (input.length > 2000) throw new Error('A sketch can contain at most 2000 shapes.');
  const ids = new Set<string>();
  const groups = validateGroups(inputGroups, true);
  const shapes = input.map((entry, index): SketchShape => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Rectangle ${index + 1} must be an object.`);
    const raw = entry as Record<string, unknown>;
    if (typeof raw.id !== 'string' || !raw.id.trim()) throw new Error(`Rectangle ${index + 1} needs an ID.`);
    if (ids.has(raw.id)) throw new Error(`Duplicate rectangle ID: ${raw.id}`);
    ids.add(raw.id);
    if (typeof raw.name !== 'string' || !raw.name.trim()) throw new Error(`Rectangle ${raw.id} needs a name.`);
    if (typeof raw.color !== 'string' || !raw.color.trim()) throw new Error(`Rectangle ${raw.id} needs a color.`);
    const vector = (value: unknown, label: string): [number, number] => {
      if (!Array.isArray(value) || value.length !== 2) throw new Error(`Rectangle ${raw.id} ${label} must have two values.`);
      return value.map((part) => {
        if (typeof part !== 'number' && typeof part !== 'string') throw new Error(`Rectangle ${raw.id} ${label} values must be inches.`);
        // An odd 1/64-inch diameter needs half-grid bounds to keep its center fixed.
        if (raw.kind === 'text' && typeof part === 'number') { parseInches(part); return part; }
        return raw.kind === 'circle' && label === 'position' && typeof part === 'number' ? parseInches(part * 2) / 2 : parseInches(part);
      }) as [number, number];
    };
    if (raw.groupId !== undefined && (typeof raw.groupId !== 'string' || !raw.groupId.trim())) throw new Error('Shape groupId must be a group ID.');
    const size = vector(raw.size, 'size');
    if (raw.kind !== undefined && raw.kind !== 'line' && raw.kind !== 'circle' && raw.kind !== 'text') throw new Error('Unknown sketch shape kind.');
    if (raw.kind === 'text' && (typeof raw.text !== 'string' || !raw.text.trim() || raw.text.length > 4000)) throw new Error('Text must contain between 1 and 4000 characters.');
    let textHeight: number | undefined;
    if (raw.kind === 'text') {
      const height = raw.textHeight === undefined ? 1 : raw.textHeight;
      if (typeof height !== 'number' && typeof height !== 'string') throw new Error('Text letter height must be inches.');
      textHeight = parseInches(height);
      if (textHeight <= 0) throw new Error('Text letter height must be positive.');
    }
    if (raw.kind === 'circle' && size[0] !== size[1]) throw new Error('Circle dimensions must have the same diameter.');
    if (raw.kind === 'line') {
      if (Math.hypot(...size) < 1 / 64) throw new Error('Choose two different points to draw a line.');
    } else if (size.some((part) => part <= 0)) throw new Error(`Rectangle ${raw.id} sizes must be positive.`);
    const base = { id: raw.id, name: raw.name, size, position: vector(raw.position ?? [0, 0], 'position'), color: raw.color, ...(raw.groupId ? { groupId: raw.groupId as string } : {}) };
    return raw.kind === 'text'
      ? { ...base, kind: 'text', text: trimSketchText(raw.text as string), textHeight: textHeight! }
      : { ...base, ...(raw.kind ? { kind: raw.kind } : {}) };
  });
  validateGroupMembers(shapes, groups);
  return shapes;
}

export function generateSketchSource(rectangles: SketchShape[], groups: GroupSpec[] = [], order: string[] = [], measurements: Measurement[] = []): string {
  const lines = ['// Draw rectangles, circles, lines and text on the X/Y plane. Dimensions are in inches.'];
  const validGroups = validateGroups(groups, true);
  lines.push(...generateGroupedSource<SketchShape | Measurement>(validGroups, [...validateSketchShapes(rectangles, validGroups), ...validateMeasurements(measurements, { rectangles, groups: validGroups })], (item) => 'start' in item ? serializeMeasurement(item) : serializeSketchShape(item), order));
  return `${lines.join('\n')}\n`;
}

export function serializeSketchShape(rectangle: SketchShape): string {
    const vector = (values: [number, number]) => `[${values.map((value) => Number.isInteger(value * 64) ? `inch(${JSON.stringify(formatInches(value))})` : JSON.stringify(value)).join(', ')}]`;
    const geometry = rectangle.kind === 'line'
      ? `start: ${vector(rectangle.position)}, end: ${vector([rectangle.position[0] + rectangle.size[0], rectangle.position[1] + rectangle.size[1]])}`
      : `${rectangle.kind === 'circle' ? `radius: inch(${JSON.stringify(formatInches(rectangle.size[0] / 2))})` : `size: ${vector(rectangle.size)}`}, position: ${vector(rectangle.position)}`;
    return `${rectangle.kind ?? 'rectangle'}({ id: ${JSON.stringify(rectangle.id)}, name: ${JSON.stringify(rectangle.name)}, ${rectangle.kind === 'text' ? `text: ${JSON.stringify(rectangle.text)}, height: inch(${JSON.stringify(formatInches(rectangle.textHeight))}), ` : ''}${geometry}, color: ${JSON.stringify(rectangle.color)} })`;
}

// Compatibility for existing rectangle-only consumers.
export const validateRectangles = validateSketchShapes;
export const snapToRectangleEdges = snapToSketchEdges;
