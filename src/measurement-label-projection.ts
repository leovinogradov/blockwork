import * as THREE from 'three';
import type { Vector3 } from './groups';

export type LabelMatrix = [number, number, number, number, number, number];

/** Test the actual projected quad, rather than its affine SVG approximation. */
function intersectsView(points: THREE.Vector2[]): boolean {
  let polygon = points;
  for (const [axis, sign] of [[0, 1], [0, -1], [1, 1], [1, -1]]) {
    const clipped: THREE.Vector2[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const da = 1 - sign * a.getComponent(axis), db = 1 - sign * b.getComponent(axis);
      if (da >= 0) clipped.push(a);
      if ((da >= 0) !== (db >= 0)) clipped.push(a.clone().lerp(b, da / (da - db)));
    }
    polygon = clipped;
    if (!polygon.length) return false;
  }
  return true;
}

/** Return a readable SVG transform only for a safely projectable, visible label. */
export function measurementLabelProjection(position: Vector3, direction: Vector3, perpendicular: Vector3,
  labelSize: [number, number], camera: THREE.Camera, viewportSize: [number, number]): LabelMatrix | null {
  if (![...position, ...direction, ...perpendicular, ...labelSize, ...viewportSize].every(Number.isFinite)
    || [...labelSize, ...viewportSize].some((n) => n <= 0)) return null;
  const projection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const center = new THREE.Vector4(...position, 1).applyMatrix4(projection);
  const u = new THREE.Vector4(...direction, 0).applyMatrix4(projection);
  const v = new THREE.Vector4(...perpendicular, 0).applyMatrix4(projection);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => center.clone()
    .addScaledVector(u, x * labelSize[0] / 2).addScaledVector(v, y * labelSize[1] / 2));
  // An affine SVG cannot clip a 3D label crossing the near plane. Hide the
  // whole label before perspective division can stretch it across the view.
  if (corners.some((p) => !p.toArray().every(Number.isFinite) || p.w <= 0 || p.z < -p.w || p.z > p.w)) return null;
  if (!intersectsView(corners.map((p) => new THREE.Vector2(p.x / p.w, p.y / p.w)))) return null;
  const position3 = new THREE.Vector3(...position), projectedCenter = position3.clone().project(camera);
  // Keep the existing basis calculation for visible labels. Constrain probes
  // to the depth-checked quad so even very small labels cannot sample behind it.
  const step = Math.min(.001, labelSize[0] / 2, labelSize[1] / 2);
  const px = position3.clone().addScaledVector(new THREE.Vector3(...direction), step).project(camera).sub(projectedCenter);
  const py = position3.clone().addScaledVector(new THREE.Vector3(...perpendicular), step).project(camera).sub(projectedCenter);
  let ux = px.x * viewportSize[0] / (2 * step), uy = -px.y * viewportSize[1] / (2 * step);
  let vx = py.x * viewportSize[0] / (2 * step), vy = -py.y * viewportSize[1] / (2 * step);
  // Vertical text reads bottom-to-top. Ignore rounding-sized horizontal
  // components before checking their sign, with a tolerance relative to zoom.
  const vertical = Math.abs(ux) <= Math.hypot(ux, uy) * 1e-6;
  if (vertical ? uy > 0 : ux < 0) { ux = -ux; uy = -uy; }
  if (ux * vy - uy * vx < 0) { vx = -vx; vy = -vy; }
  const determinant = ux * vy - uy * vx;
  const basisArea = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  const matrix: LabelMatrix = [ux, uy, vx, vy, (projectedCenter.x + 1) * viewportSize[0] / 2, (1 - projectedCenter.y) * viewportSize[1] / 2];
  // A relative test catches nearly parallel projected axes at every zoom level.
  if (!matrix.every(Number.isFinite) || !Number.isFinite(determinant) || !Number.isFinite(basisArea)
    || determinant < 1e-6 || determinant / basisArea < 1e-4) return null;
  return matrix;
}
