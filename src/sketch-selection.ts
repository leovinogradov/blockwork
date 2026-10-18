import { sketchShapeOrigin, type SketchShape } from './sketch';

export type SelectionAction = 'replace' | 'toggle' | 'add';
export type SelectionPoint = [number, number];

export function updateSketchSelection(current: Iterable<string>, incoming: Iterable<string>, action: SelectionAction): Set<string> {
  const next = new Set(action === 'replace' ? [] : current);
  for (const id of new Set(incoming)) {
    if (action === 'toggle' && next.has(id)) next.delete(id);
    else next.add(id);
  }
  return next;
}

/** Select shapes touching a screen-space drag box, including signed line segments. */
export function sketchShapesInBox(shapes: SketchShape[], first: SelectionPoint, opposite: SelectionPoint, project: (point: SelectionPoint) => SelectionPoint, hiddenIds: ReadonlySet<string>): string[] {
  const min = [Math.min(first[0], opposite[0]), Math.min(first[1], opposite[1])];
  const max = [Math.max(first[0], opposite[0]), Math.max(first[1], opposite[1])];
  return shapes.filter((shape) => {
    if (hiddenIds.has(shape.id)) return false;
    const origin = sketchShapeOrigin(shape);
    const a = project(origin);
    const b = project([origin[0] + shape.size[0], origin[1] + shape.size[1]]);
    if (shape.kind === 'circle') {
      const center = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const radius = [Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2];
      return [0, 1].reduce((distance, axis) => {
        const closest = Math.max(min[axis], Math.min(center[axis], max[axis]));
        return distance + ((closest - center[axis]) / radius[axis]) ** 2;
      }, 0) <= 1;
    }
    if (shape.kind !== 'line') return [0, 1].every((axis) => Math.max(a[axis], b[axis]) >= min[axis] && Math.min(a[axis], b[axis]) <= max[axis]);
    let start = 0, end = 1;
    for (const axis of [0, 1]) {
      const delta = b[axis] - a[axis];
      if (delta === 0) { if (a[axis] < min[axis] || a[axis] > max[axis]) return false; continue; }
      const t1 = (min[axis] - a[axis]) / delta, t2 = (max[axis] - a[axis]) / delta;
      start = Math.max(start, Math.min(t1, t2));
      end = Math.min(end, Math.max(t1, t2));
      if (start > end) return false;
    }
    return true;
  }).map((shape) => shape.id);
}
