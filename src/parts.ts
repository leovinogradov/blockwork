import { worldPosition, type GroupSpec, type Vector3 } from './groups';
import { cylinderAxes, type BoxSpec } from './model';

export function componentDisplayName(item: { name: string; groupId?: string }, groups: GroupSpec[]): string {
  const owner = groups.find((group) => group.id === item.groupId && group.kind === 'part');
  return owner ? [owner.name, item.name].filter((name) => name.trim()).join(' > ') : item.name;
}

type Solid = BoxSpec & { position: Vector3 };
const EPS = 1e-8;
const overlap = (a: Solid, b: Solid, axis: number) => Math.min(a.position[axis] + a.size[axis], b.position[axis] + b.size[axis]) - Math.max(a.position[axis], b.position[axis]);
const center = (solid: Solid, axis: number) => solid.position[axis] + solid.size[axis] / 2;
const distanceToInterval = (point: number, solid: Solid, axis: number) => Math.max(solid.position[axis] - point, point - solid.position[axis] - solid.size[axis], 0);

/** Positive volume or shared face area joins bodies; edge/point contact does not.
 * Cylinders use their circular cross sections, rather than their bounding boxes.
 */
export function solidsConnect(a: Solid, b: Solid): boolean {
  if ([0, 1, 2].some((axis) => overlap(a, b, axis) < -EPS)) return false;
  const ac = a.kind === 'cylinder', bc = b.kind === 'cylinder';
  if (!ac && !bc) return [0, 1, 2].filter((axis) => overlap(a, b, axis) > EPS).length >= 2;
  if (!ac) return solidsConnect(b, a);
  const aa = cylinderAxes(a), ar = a.size[aa.radialAxes[0]] / 2;
  if (!bc) {
    const distance = Math.hypot(...aa.radialAxes.map((axis) => distanceToInterval(center(a, axis), b, axis)));
    return distance < ar - EPS;
  }
  const ba = cylinderAxes(b), br = b.size[ba.radialAxes[0]] / 2;
  if (aa.lengthAxis === ba.lengthAxis) {
    return Math.hypot(...aa.radialAxes.map((axis) => center(a, axis) - center(b, axis))) < ar + br - EPS;
  }
  const remaining = [0, 1, 2].find((axis) => axis !== aa.lengthAxis && axis !== ba.lengthAxis)!;
  const da = distanceToInterval(center(a, ba.lengthAxis), b, ba.lengthAxis);
  const db = distanceToInterval(center(b, aa.lengthAxis), a, aa.lengthAxis);
  if (da >= ar - EPS || db >= br - EPS) return false;
  const spanA = Math.sqrt(ar * ar - da * da), spanB = Math.sqrt(br * br - db * db);
  return Math.min(center(a, remaining) + spanA, center(b, remaining) + spanB) - Math.max(center(a, remaining) - spanA, center(b, remaining) - spanB) > EPS;
}

/** Analyze resolved additive geometry. Construction sketches/measurements add no material. */
export function analyzePart(part: GroupSpec, boxes: BoxSpec[], groups: GroupSpec[]) {
  const solids = boxes.filter((box) => box.groupId === part.id).map((box) => ({ ...box, position: worldPosition(box.position, groups, box.groupId) }));
  const min: Vector3 = [0, 1, 2].map((axis) => solids.length ? Math.min(...solids.map((solid) => solid.position[axis])) : 0) as Vector3;
  const max: Vector3 = [0, 1, 2].map((axis) => solids.length ? Math.max(...solids.map((solid) => solid.position[axis] + solid.size[axis])) : 0) as Vector3;
  const remaining = new Set(solids.map((_, index) => index));
  let bodyCount = 0;
  while (remaining.size) {
    bodyCount++;
    const first = remaining.values().next().value!;
    remaining.delete(first);
    const queue = [first];
    while (queue.length) {
      const index = queue.pop()!;
      for (const other of remaining) if (solidsConnect(solids[index], solids[other])) { remaining.delete(other); queue.push(other); }
    }
  }
  return { solids, bodyCount, size: max.map((n, axis) => n - min[axis]) as Vector3, min, max };
}
