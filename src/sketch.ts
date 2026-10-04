import { generateGroupSource, validateGroups, validateGroupMembers, type GroupSpec } from './groups';
import { formatInches, parseInches } from './model';

export type SketchShape = {
  /** Missing kind is a rectangle for compatibility with saved sketches. */
  kind?: 'line';
  id: string;
  name: string;
  /** Rectangle width/height, or signed line displacement, in inches. */
  size: [number, number];
  /** Rectangle minimum corner or line start on the model X/Y plane. */
  position: [number, number];
  color: string;
  groupId?: string;
};

// Existing rectangle-only callers can retain their original type.
export type RectangleSpec = Omit<SketchShape, 'kind'>;

export type SketchSnap = { point: [number, number]; kind: 'corner' | 'endpoint' | 'edge' | null };

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

/** Snap to corners, line endpoints, or the nearest point on an existing segment. */
export function snapToSketchEdges(cursor: [number, number], rectangles: SketchShape[], tolerance: number): SketchSnap {
  const onGrid = (value: number) => Math.round(value * 64) / 64;
  const fallback: SketchSnap = { point: [onGrid(cursor[0]), onGrid(cursor[1])], kind: null };
  if (!(tolerance > 0)) return fallback;

  let closestCorner: [number, number] | null = null;
  let cornerKind: 'corner' | 'endpoint' = 'corner';
  let cornerDistance = (tolerance * 0.75) ** 2;
  let closestEdge: [number, number] | null = null;
  let edgeDistance = tolerance ** 2;
  const considerCorner = (point: [number, number], kind: 'corner' | 'endpoint' = 'corner') => {
    const distance = (cursor[0] - point[0]) ** 2 + (cursor[1] - point[1]) ** 2;
    if (distance <= cornerDistance) { cornerDistance = distance; closestCorner = point; cornerKind = kind; }
  };
  const considerEdge = (point: [number, number]) => {
    const distance = (cursor[0] - point[0]) ** 2 + (cursor[1] - point[1]) ** 2;
    if (distance <= edgeDistance) { edgeDistance = distance; closestEdge = point; }
  };
  for (const rectangle of rectangles) {
    const [x1, y1] = rectangle.position;
    const x2 = x1 + rectangle.size[0], y2 = y1 + rectangle.size[1];
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
  if (closestEdge) return { point: [onGrid(closestEdge[0]), onGrid(closestEdge[1])], kind: 'edge' };
  return fallback;
}

export function lineFromPoints(start: [number, number], end: [number, number], id: string, name: string, color: string): SketchShape {
  return validateSketchShapes([{ id, name, color, kind: 'line', position: start, size: [end[0] - start[0], end[1] - start[1]] }])[0];
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
  const shapes = input.map((entry, index) => {
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
        return parseInches(part);
      }) as [number, number];
    };
    if (raw.groupId !== undefined && (typeof raw.groupId !== 'string' || !raw.groupId.trim())) throw new Error('Shape groupId must be a group ID.');
    const size = vector(raw.size, 'size');
    if (raw.kind !== undefined && raw.kind !== 'line') throw new Error('Unknown sketch shape kind.');
    if (raw.kind === 'line') {
      if (Math.hypot(...size) < 1 / 64) throw new Error('Choose two different points to draw a line.');
    } else if (size.some((part) => part <= 0)) throw new Error(`Rectangle ${raw.id} sizes must be positive.`);
    return { id: raw.id, name: raw.name, size, position: vector(raw.position ?? [0, 0], 'position'), color: raw.color, ...(raw.groupId ? { groupId: raw.groupId as string } : {}), ...(raw.kind === 'line' ? { kind: 'line' as const } : {}) };
  });
  validateGroupMembers(shapes, groups);
  return shapes;
}

export function generateSketchSource(rectangles: SketchShape[], groups: GroupSpec[] = []): string {
  const lines = ['// Draw rectangles and lines on the X/Y plane. Dimensions are in inches.'];
  lines.push(...generateGroupSource(groups));
  for (const rectangle of validateSketchShapes(rectangles, groups)) {
    const vector = (values: [number, number]) => `[${values.map((value) => `inch(${JSON.stringify(formatInches(value))})`).join(', ')}]`;
    const geometry = rectangle.kind === 'line'
      ? `start: ${vector(rectangle.position)}, end: ${vector([rectangle.position[0] + rectangle.size[0], rectangle.position[1] + rectangle.size[1]])}`
      : `size: ${vector(rectangle.size)}, position: ${vector(rectangle.position)}`;
    lines.push(`${rectangle.kind === 'line' ? 'line' : 'rectangle'}({ id: ${JSON.stringify(rectangle.id)}, name: ${JSON.stringify(rectangle.name)}, ${geometry}, color: ${JSON.stringify(rectangle.color)}${rectangle.groupId ? `, groupId: ${JSON.stringify(rectangle.groupId)}` : ""} });`);
  }
  return `${lines.join('\n')}\n`;
}

// Compatibility for existing rectangle-only consumers.
export const validateRectangles = validateSketchShapes;
export const snapToRectangleEdges = snapToSketchEdges;
