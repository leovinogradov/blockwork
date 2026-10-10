import { Camera, Matrix4, Mesh, Vector4 } from 'three';
import type { SelectionPoint } from './sketch-selection';

type ScreenBounds = { left: number; top: number; width: number; height: number };
const clipDistances = [
  (p: Vector4) => p.w + p.x, (p: Vector4) => p.w - p.x,
  (p: Vector4) => p.w + p.y, (p: Vector4) => p.w - p.y,
  (p: Vector4) => p.w + p.z, (p: Vector4) => p.w - p.z,
];

function clipTriangle(triangle: Vector4[]): Vector4[] {
  let polygon = triangle;
  for (const distance of clipDistances) {
    const clipped: Vector4[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const da = distance(a), db = distance(b);
      if (da >= 0) clipped.push(a);
      if ((da >= 0) !== (db >= 0)) clipped.push(a.clone().lerp(b, da / (da - db)));
    }
    polygon = clipped;
    if (!polygon.length) break;
  }
  return polygon;
}

function intersects(polygon: SelectionPoint[], rectangle: SelectionPoint[]): boolean {
  const axes: SelectionPoint[] = [[1, 0], [0, 1]];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    axes.push([a[1] - b[1], b[0] - a[0]]);
  }
  return axes.every(([x, y]) => {
    const a = polygon.map((p) => p[0] * x + p[1] * y);
    const b = rectangle.map((p) => p[0] * x + p[1] * y);
    return Math.max(...a) >= Math.min(...b) && Math.max(...b) >= Math.min(...a);
  });
}

/** Select visible geometry touching the marquee, including partially clipped objects. */
export function modelObjectsInBox(
  objects: Iterable<{ id: string; mesh: Mesh }>, camera: Camera,
  first: SelectionPoint, opposite: SelectionPoint, bounds: ScreenBounds, hiddenIds: ReadonlySet<string>,
): string[] {
  const left = Math.min(first[0], opposite[0]), right = Math.max(first[0], opposite[0]);
  const top = Math.min(first[1], opposite[1]), bottom = Math.max(first[1], opposite[1]);
  const rectangle: SelectionPoint[] = [[left, top], [right, top], [right, bottom], [left, bottom]];
  const ids: string[] = [];
  camera.updateMatrixWorld();
  for (const { id, mesh } of objects) {
    if (hiddenIds.has(id) || !mesh.visible) continue;
    mesh.updateWorldMatrix(true, false);
    const matrix = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(mesh.matrixWorld);
    const position = mesh.geometry.getAttribute('position'), index = mesh.geometry.index;
    const count = index?.count ?? position.count;
    const vertices = Array.from({ length: position.count }, (_, i) =>
      new Vector4(position.getX(i), position.getY(i), position.getZ(i), 1).applyMatrix4(matrix));
    for (let i = 0; i < count; i += 3) {
      const polygon = clipTriangle([0, 1, 2].map((offset) => vertices[index ? index.getX(i + offset) : i + offset]));
      const projected: SelectionPoint[] = polygon.filter((p) => p.w > 0).map((p) => [
        bounds.left + (p.x / p.w + 1) * bounds.width / 2,
        bounds.top + (1 - p.y / p.w) * bounds.height / 2,
      ]);
      if (projected.length && intersects(projected, rectangle)) { ids.push(id); break; }
    }
  }
  return ids;
}
