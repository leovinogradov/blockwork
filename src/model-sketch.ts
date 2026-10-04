import { pointOnPlane, validateGroupMembers, worldPosition, type GroupSpec, type PlaneFrame, type Vector3 } from './groups';
import { parseInches } from './model';
import { serializeSketchShape, validateSketchShapes, type SketchShape } from './sketch';

export type SketchAxis = 'x' | 'y' | 'z';
/** A finite 2D frame with its own local rectangles and lines, mounted in a model. */
export type ModelSketch = {
  id: string;
  name: string;
  axis: SketchAxis;
  size: [number, number];
  position: Vector3;
  color: string;
  shapes: SketchShape[];
  groupId?: string;
  referenceName?: string;
};

export function validateModelSketches(input: unknown = [], groups: GroupSpec[] = []): ModelSketch[] {
  if (!Array.isArray(input) || input.length > 2000) throw new Error('Model sketches must be an array of at most 2000 sketches.');
  const ids = new Set<string>();
  let shapeCount = 0;
  const sketches = input.map((raw): ModelSketch => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Each model sketch must be an object.');
    if (typeof raw.id !== 'string' || !raw.id.trim() || ids.has(raw.id)) throw new Error('Each model sketch needs a unique ID.');
    ids.add(raw.id);
    if (typeof raw.name !== 'string' || !raw.name.trim()) throw new Error(`Sketch ${raw.id} needs a name.`);
    if (!['x', 'y', 'z'].includes(raw.axis)) throw new Error(`Sketch ${raw.id} axis must be x, y, or z.`);
    if (typeof raw.color !== 'string' || !raw.color.trim()) throw new Error(`Sketch ${raw.id} needs a color.`);
    const vector = (value: unknown, length: number, label: string): number[] => {
      if (!Array.isArray(value) || value.length !== length || value.some((n) => typeof n !== 'number' && typeof n !== 'string')) throw new Error(`Sketch ${raw.id} ${label} must have ${length} inch values.`);
      return value.map((n) => parseInches(n));
    };
    const size = vector(raw.size, 2, 'size') as [number, number];
    if (size.some((n) => n <= 0)) throw new Error(`Sketch ${raw.id} sizes must be positive.`);
    const shapes = validateSketchShapes(raw.shapes ?? []);
    shapeCount += shapes.length;
    if (shapeCount > 2000) throw new Error('A model can contain at most 2000 mounted sketch shapes.');
    if (raw.groupId !== undefined && (typeof raw.groupId !== 'string' || !raw.groupId.trim())) throw new Error('Sketch groupId must be a group ID.');
    if (raw.referenceName !== undefined && (typeof raw.referenceName !== 'string' || !raw.referenceName.trim())) throw new Error('Sketch referenceName must be a non-empty name.');
    return { id: raw.id, name: raw.name, axis: raw.axis, size, position: vector(raw.position ?? [0, 0, 0], 3, 'position') as Vector3, color: raw.color, shapes, ...(raw.groupId ? { groupId: raw.groupId } : {}), ...(raw.referenceName ? { referenceName: raw.referenceName } : {}) };
  });
  validateGroupMembers(sketches, groups);
  return sketches;
}

/** Axis is the plane normal. Width/height use Y/Z, X/Z, or X/Y respectively. */
export function modelSketchFrame(sketch: ModelSketch, groups: GroupSpec[] = []): PlaneFrame {
  const frames: Record<SketchAxis, Pick<PlaneFrame, 'u' | 'v' | 'normal'>> = {
    x: { u: [0, 1, 0], v: [0, 0, 1], normal: [1, 0, 0] },
    y: { u: [1, 0, 0], v: [0, 0, 1], normal: [0, -1, 0] },
    z: { u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1] },
  };
  return { origin: worldPosition(sketch.position, groups, sketch.groupId), ...frames[sketch.axis] };
}

export function modelSketchPoints(sketch: ModelSketch): Vector3[] {
  const frame = modelSketchFrame({ ...sketch, groupId: undefined });
  const [w, h] = sketch.size;
  const points: number[][] = [[0, 0], [w, 0], [w, h], [0, h]];
  for (const shape of sketch.shapes) {
    const [x, y] = shape.position, [dx, dy] = shape.size;
    points.push([x, y], [x + dx, y + dy]);
    if (shape.kind !== 'line') points.push([x + dx, y], [x, y + dy]);
  }
  return points.map((point) => pointOnPlane(frame, point));
}

/** Flatten sketch groups into a portable reference, with its bounds at the frame origin. */
export function sketchReference(shapes: SketchShape[], groups: GroupSpec[] = []): Pick<ModelSketch, 'shapes' | 'size'> {
  const world = flattenSketchShapes(shapes, groups);
  if (!world.length) return { shapes: [], size: [12, 8] };
  const points = world.flatMap((shape) => [shape.position, [shape.position[0] + shape.size[0], shape.position[1] + shape.size[1]]]);
  const min = [0, 1].map((i) => Math.min(...points.map((p) => p[i])));
  const size = [0, 1].map((i) => Math.max(1 / 64, Math.max(...points.map((p) => p[i])) - min[i])) as [number, number];
  return { size, shapes: world.map((shape) => ({ ...shape, position: [shape.position[0] - min[0], shape.position[1] - min[1]] })) };
}

/** Keep a reference's original origin fixed so moving shapes remains a real edit. */
export function flattenSketchShapes(shapes: SketchShape[], groups: GroupSpec[] = [], origin: [number, number] = [0, 0]): SketchShape[] {
  return validateSketchShapes(shapes, groups).map((shape) => {
    const position = worldPosition(shape.position, groups, shape.groupId);
    const { groupId: _groupId, ...local } = shape;
    return { ...local, position: [position[0] - origin[0], position[1] - origin[1]] };
  });
}

export function sketchReferenceOrigin(shapes: SketchShape[], groups: GroupSpec[] = []): [number, number] {
  const world = flattenSketchShapes(shapes, groups);
  if (!world.length) return [0, 0];
  return [0, 1].map((i) => Math.min(...world.flatMap((shape) => [shape.position[i], shape.position[i] + shape.size[i]]))) as [number, number];
}

export function serializeModelSketch(sketch: ModelSketch): string {
  const { id, name, axis, size, position, color, referenceName } = sketch;
  return `sketch(${JSON.stringify({ id, name, axis, size, position, color, ...(referenceName ? { referenceName } : {}) })}, [${sketch.shapes.length ? `\n${sketch.shapes.map((shape) => `  ${serializeSketchShape(shape)}`).join(',\n')}\n` : ''}])`;
}
