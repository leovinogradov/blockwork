import { sketchShapeOrigin, type SketchShape } from './sketch';

export type SelectionAction = 'replace' | 'toggle' | 'add';
export type SelectionPoint = [number, number];

/** All visible shapes under a click, ordered by screen-space distance to center. */
export function sketchShapesAtPoint(shapes: SketchShape[], point: SelectionPoint, project: (point: SelectionPoint) => SelectionPoint, hiddenIds: ReadonlySet<string>): string[] {
  return shapes.flatMap((shape) => {
    if (hiddenIds.has(shape.id)) return [];
    const origin = sketchShapeOrigin(shape);
    const a = project(origin);
    const b = project([origin[0] + shape.size[0], origin[1] + shape.size[1]]);
    const center = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const distance = Math.hypot(point[0] - center[0], point[1] - center[1]);
    let hit: boolean;
    if (shape.kind === 'line') {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const lengthSquared = dx * dx + dy * dy;
      const t = lengthSquared ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared)) : 0;
      hit = Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy) <= 10;
    } else if (shape.kind === 'circle') {
      hit = ((point[0] - center[0]) / (Math.abs(b[0] - a[0]) / 2)) ** 2
        + ((point[1] - center[1]) / (Math.abs(b[1] - a[1]) / 2)) ** 2 <= 1;
    } else {
      hit = [0, 1].every((axis) => point[axis] >= Math.min(a[axis], b[axis]) && point[axis] <= Math.max(a[axis], b[axis]));
    }
    return hit ? [{ id: shape.id, distance }] : [];
  }).sort((a, b) => a.distance - b.distance).map(({ id }) => id);
}

/** Keep the original click and order so small pointer jitter cannot reorder a cycle. */
export function createSketchSelectionCycle() {
  let cycle: { point: SelectionPoint; ids: string[]; index: number } | null = null;
  return {
    reset() { cycle = null; },
    move(point: SelectionPoint) {
      if (cycle && Math.hypot(point[0] - cycle.point[0], point[1] - cycle.point[1]) > 4) cycle = null;
    },
    next(point: SelectionPoint, ids: string[]): string | null {
      const sameCandidates = cycle && ids.length === cycle.ids.length && cycle.ids.every((id) => ids.includes(id));
      if (cycle && sameCandidates && Math.hypot(point[0] - cycle.point[0], point[1] - cycle.point[1]) <= 4) {
        cycle.index = (cycle.index + 1) % cycle.ids.length;
      } else {
        cycle = ids.length ? { point: [...point], ids: [...ids], index: 0 } : null;
      }
      return cycle ? cycle.ids[cycle.index] : null;
    },
  };
}

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
