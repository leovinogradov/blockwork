import { pointOnPlane, worldPosition, type GroupSpec, type Vector3 } from './groups';
import { cylinderAxes, type BoxSpec } from './model';
import { modelSketchFrame, type ModelSketch } from './model-sketch';
import type { SketchShape } from './sketch';

/** Coordinates are fractions of the referenced geometry, never frozen world points. */
export type MeasurementAnchor = { objectId: string; shapeId?: string; coordinates: number[] };
export type MeasurementAxis = 'x' | 'y' | 'z';
export type MeasurementAxisChoice = 'auto' | MeasurementAxis;
export type Measurement = { id: string; name?: string; groupId?: string; start: MeasurementAnchor; end: MeasurementAnchor; offset?: number; lineHeight?: number; axis?: MeasurementAxis; distanceAxis?: MeasurementAxis };
export type MeasurementGeometry = { boxes?: BoxSpec[]; rectangles?: SketchShape[]; sketches?: ModelSketch[]; groups?: GroupSpec[] };
export type MeasurementSegment = { start: MeasurementAnchor; end: MeasurementAnchor; a: Vector3; b: Vector3; pointKind?: 'center' | 'edge'; curveCenter?: Vector3; curveAxes?: [number, number] };

/** Shared defaults and all annotation sizes use inches, just like geometry. */
export const DEFAULT_MEASUREMENT_OFFSET = 2;
/** Default label line height in inches, derived from the live point distance. */
export function defaultMeasurementLineHeight(distance: number): number {
  return Math.min(3, Math.max(1, Math.ceil(Math.sqrt(Math.max(0, distance)) / 4.5)));
}

/** Signed model-space distance perpendicular to the measured line. */
export function measurementOffsetAtPointer(start: Vector3, end: Vector3, cursor: Vector3, axis: MeasurementAxis = 'z'): number {
  const frame = measurementAxisLayout(start, end, axis);
  return cursor.reduce((offset, n, i) => offset + (n - frame.midpoint[i]) * frame.perpendicular[i], 0);
}

function target(anchor: MeasurementAnchor, geometry: MeasurementGeometry) {
  if (anchor.shapeId !== undefined) return geometry.sketches?.find((s) => s.id === anchor.objectId)?.shapes.find((s) => s.id === anchor.shapeId);
  return geometry.boxes?.find((s) => s.id === anchor.objectId) ?? geometry.rectangles?.find((s) => s.id === anchor.objectId) ?? geometry.sketches?.find((s) => s.id === anchor.objectId);
}

export function resolveMeasurementAnchor(anchor: MeasurementAnchor, geometry: MeasurementGeometry): Vector3 | null {
  const item = target(anchor, geometry);
  if (!item) return null;
  const c = anchor.coordinates;
  if ('shapes' in item) return pointOnPlane(modelSketchFrame(item, geometry.groups), [item.size[0] * c[0], item.size[1] * c[1]]);
  const position = worldPosition(item.position, geometry.groups ?? [], item.groupId);
  const local = item.size.length === 2 && 'kind' in item && item.kind === 'line'
    ? [position[0] + item.size[0] * c[0], position[1] + item.size[1] * c[0], 0] as Vector3
    : position.map((p, i) => p + (item.size[i] ?? 0) * (c[i] ?? 0)) as Vector3;
  if (anchor.shapeId !== undefined) {
    const sketch = geometry.sketches!.find((s) => s.id === anchor.objectId)!;
    return pointOnPlane(modelSketchFrame(sketch, geometry.groups), local);
  }
  return local;
}

/** Choose a preferred facing axis once, from the creation view. Ties favor Z. */
export function autoMeasurementAxis(viewDirection: Vector3): MeasurementAxis {
  const candidates = [{ axis: 'z' as const, index: 2 }, { axis: 'y' as const, index: 1 }, { axis: 'x' as const, index: 0 }];
  return candidates.reduce((best, candidate) => Math.abs(viewDirection[candidate.index]) > Math.abs(viewDirection[best.index]) + 1e-8 ? candidate : best).axis;
}

/** Largest absolute world-coordinate difference; ties choose X, then Y, then Z. */
export function dominantMeasurementAxis(start: Vector3, end: Vector3): MeasurementAxis {
  const delta = end.map((n, i) => Math.abs(n - start[i]));
  const index = [0, 1, 2].reduce((best, i) => delta[i] > delta[best] ? i : best);
  return (['x', 'y', 'z'] as const)[index];
}

/** Keep the real anchors while projecting only the dimension's endpoint. */
export function measurementLine(start: Vector3, end: Vector3, distanceAxis?: MeasurementAxis) {
  const index = distanceAxis === 'x' ? 0 : distanceAxis === 'y' ? 1 : 2;
  const projectedEnd = distanceAxis ? start.map((n, i) => i === index ? end[i] : n) as Vector3 : [...end] as Vector3;
  return { start: [...start] as Vector3, end: projectedEnd, distance: Math.hypot(...projectedEnd.map((n, i) => n - start[i])) };
}

/** Follow the full 3D line, with the closest possible normal to the preferred axis. */
export function measurementAxisLayout(start: Vector3, end: Vector3, axis: MeasurementAxis = 'z') {
  const midpoint = start.map((n, i) => (n + end[i]) / 2) as Vector3;
  const delta = end.map((n, i) => n - start[i]), length = Math.hypot(...delta);
  let direction: Vector3 = length > 1e-12 ? delta.map((n) => n / length) as Vector3 : [1, 0, 0];
  // Reversing endpoints must not reverse the side of a saved label offset.
  if ((direction.find((n) => Math.abs(n) > 1e-8) ?? 1) < 0) direction = direction.map((n) => -n) as Vector3;
  const preferredIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const projectAxis = (index: number) => direction.map((n, i) => (i === index ? 1 : 0) - n * direction[index]) as Vector3;
  let projected = projectAxis(preferredIndex);
  let normalLength = Math.hypot(...projected);
  let fallbackAxis: MeasurementAxis | undefined;
  if (normalLength <= 1e-6) {
    // At parallel (or nearly parallel) lines use the least-aligned world axis.
    // Ties choose X, then Y, then Z; this is independent of camera and endpoint order.
    const index = [0, 1, 2].reduce((best, i) => Math.abs(direction[i]) < Math.abs(direction[best]) - 1e-8 ? i : best);
    projected = projectAxis(index); normalLength = Math.hypot(...projected);
    fallbackAxis = (['x', 'y', 'z'] as const)[index];
  }
  const normal = projected.map((n) => n / normalLength) as Vector3;
  const perpendicular: Vector3 = [normal[1] * direction[2] - normal[2] * direction[1], normal[2] * direction[0] - normal[0] * direction[2], normal[0] * direction[1] - normal[1] * direction[0]];
  return { axis, fallbackAxis, midpoint, start: [...start] as Vector3, end: [...end] as Vector3, direction, perpendicular, normal };
}

/** Sketch annotations stay on their drawing surface with a Z-facing normal. */
export function measurementAnnotationLayout(start: Vector3, end: Vector3, measurement: Pick<Measurement, 'offset' | 'lineHeight' | 'axis' | 'distanceAxis'>, sketch = false) {
  const line = measurementLine(start, end, measurement.distanceAxis);
  const frame = measurementAxisLayout(line.start, line.end, sketch ? 'z' : measurement.axis ?? 'z');
  const offset = measurement.offset ?? DEFAULT_MEASUREMENT_OFFSET;
  const shifted = (point: Vector3) => point.map((n, i) => n + frame.perpendicular[i] * offset) as Vector3;
  return { ...frame, dimensionStart: shifted(frame.start), dimensionEnd: shifted(frame.end), labelPosition: shifted(frame.midpoint), offset, lineHeight: measurement.lineHeight ?? defaultMeasurementLineHeight(line.distance) };
}

export function resolveMeasurement(measurement: Measurement, geometry: MeasurementGeometry) {
  const start = resolveMeasurementAnchor(measurement.start, geometry), end = resolveMeasurementAnchor(measurement.end, geometry);
  if (!start || !end) return null;
  return { start, end, distance: measurementLine(start, end, measurement.distanceAxis).distance };
}

export function validateMeasurements(input: unknown = [], geometry: MeasurementGeometry): Measurement[] {
  if (!Array.isArray(input) || input.length > 2000) throw new Error('Measurements must be an array of at most 2000 annotations.');
  const ids = new Set([...(geometry.boxes ?? []), ...(geometry.rectangles ?? []), ...(geometry.sketches ?? []), ...(geometry.groups ?? [])].map((item) => item.id));
  return input.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.id !== 'string' || !raw.id.trim() || ids.has(raw.id)) throw new Error('Each measurement needs a unique ID.');
    ids.add(raw.id);
    const anchor = (value: unknown): MeasurementAnchor => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Measurement endpoints must reference geometry.');
      const a = value as MeasurementAnchor;
      if (typeof a.objectId !== 'string' || (a.shapeId !== undefined && typeof a.shapeId !== 'string')) throw new Error('Measurement endpoints need a geometry ID.');
      const item = target(a, geometry);
      if (!item) throw new Error(`Measurement references missing geometry: ${a.objectId}${a.shapeId ? '/' + a.shapeId : ''}.`);
      const dimensions = 'kind' in item && item.kind === 'line' ? 1 : item.size.length;
      const circular = 'kind' in item && (item.kind === 'circle' || item.kind === 'cylinder');
      if (!Array.isArray(a.coordinates) || a.coordinates.length !== dimensions || a.coordinates.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1)) throw new Error('Measurement endpoints must lie on a corner or edge, or a circular center.');
      if (circular) {
        const { lengthAxis, radialAxes } = item.kind === 'cylinder' ? cylinderAxes(item) : { lengthAxis: 2, radialAxes: [0, 1] };
        const x = a.coordinates[radialAxes[0]], y = a.coordinates[radialAxes[1]], z = a.coordinates[lengthAxis];
        const radius = Math.hypot(x - 0.5, y - 0.5);
        if (Math.abs(radius - 0.5) > 1e-8 && radius > 1e-8 || (dimensions === 3 && z !== 0 && z !== 1)) throw new Error('Circular measurements must lie on the rim or end center.');
      } else if (dimensions > 1 && a.coordinates.filter((n) => n !== 0 && n !== 1).length > 1) throw new Error('Measurement endpoints must lie on a corner or edge.');
      return { objectId: a.objectId, ...(a.shapeId !== undefined ? { shapeId: a.shapeId } : {}), coordinates: [...a.coordinates] };
    };
    if (raw.offset !== undefined && (typeof raw.offset !== 'number' || !Number.isFinite(raw.offset))) throw new Error('Measurement offset must be a finite inch distance.');
    if (raw.lineHeight !== undefined && (typeof raw.lineHeight !== 'number' || !Number.isFinite(raw.lineHeight) || raw.lineHeight <= 0)) throw new Error('Measurement label line height must be a positive inch distance.');
    if (raw.axis !== undefined && !['x', 'y', 'z'].includes(raw.axis)) throw new Error('Measurement label axis must be x, y, or z.');
    if (raw.distanceAxis !== undefined && !['x', 'y', 'z'].includes(raw.distanceAxis)) throw new Error('Measurement distance axis must be x, y, or z.');
    if (raw.name !== undefined && (typeof raw.name !== 'string' || !raw.name.trim())) throw new Error('Measurement name must be a nonempty string.');
    if (raw.groupId !== undefined && (typeof raw.groupId !== 'string' || !geometry.groups?.some((g) => g.id === raw.groupId))) throw new Error('Measurement references a missing group.');
    return { id: raw.id, ...(raw.name !== undefined ? { name: raw.name } : {}), ...(raw.groupId !== undefined ? { groupId: raw.groupId } : {}), start: anchor(raw.start), end: anchor(raw.end), ...(raw.offset !== undefined ? { offset: raw.offset } : {}), ...(raw.lineHeight !== undefined ? { lineHeight: raw.lineHeight } : {}), ...(raw.axis !== undefined ? { axis: raw.axis as MeasurementAxis } : {}), ...(raw.distanceAxis !== undefined ? { distanceAxis: raw.distanceAxis as MeasurementAxis } : {}) };
  });
}

/** UI deletions remove attached annotations in the same undoable change. */
export function pruneMeasurements(measurements: Measurement[], geometry: MeasurementGeometry): Measurement[] {
  return measurements.filter((m) => target(m.start, geometry) && target(m.end, geometry));
}

export function serializeMeasurement(measurement: Measurement): string {
  const { groupId: _groupId, ...properties } = measurement;
  return `measurement(${JSON.stringify(properties)})`;
}

/** Enumerate real edges, including mounted sketch outlines and line endpoints. */
export function measurementSegments(geometry: MeasurementGeometry, hidden: Set<string> = new Set()): MeasurementSegment[] {
  const result: MeasurementSegment[] = [];
  const append = (item: BoxSpec | SketchShape | ModelSketch, objectId: string, shapeId?: string) => {
    const dimensions = 'kind' in item && item.kind === 'line' ? 1 : item.size.length;
    const anchor = (coordinates: number[]): MeasurementAnchor => ({ objectId, ...(shapeId ? { shapeId } : {}), coordinates });
    const push = (c: number[], d: number[], extra: Partial<MeasurementSegment> = {}) => {
      const start = anchor(c), end = anchor(d);
      result.push({ start, end, a: resolveMeasurementAnchor(start, geometry)!, b: resolveMeasurementAnchor(end, geometry)!, ...extra });
    };
    if ('kind' in item && (item.kind === 'circle' || item.kind === 'cylinder')) {
      const { lengthAxis, radialAxes } = item.kind === 'cylinder' ? cylinderAxes(item) : { lengthAxis: 2, radialAxes: [0, 1] as [number, number] };
      for (const z of dimensions === 3 ? [0, 1] : [undefined]) {
        const coords = (x: number, y: number) => {
          const c = Array(dimensions).fill(0.5); c[radialAxes[0]] = x; c[radialAxes[1]] = y;
          if (z !== undefined) c[lengthAxis] = z;
          return c;
        };
        const center = coords(0.5, 0.5);
        const curveCenter = resolveMeasurementAnchor(anchor(center), geometry)!;
        push(center, center, { pointKind: 'center' });
        const steps = 96;
        const rim = (i: number) => coords(0.5 + Math.cos(i * Math.PI * 2 / steps) / 2, 0.5 + Math.sin(i * Math.PI * 2 / steps) / 2);
        for (let i = 0; i < steps; i++) push(rim(i), rim(i + 1), { pointKind: 'edge', curveCenter, curveAxes: radialAxes });
      }
      return;
    }
    for (let axis = 0; axis < dimensions; axis++) {
      for (let bits = 0; bits < 2 ** (dimensions - 1); bits++) {
        let bit = 0;
        const c = Array.from({ length: dimensions }, (_, i) => i === axis ? 0 : (bits >> bit++) & 1);
        const d = [...c]; d[axis] = 1;
        const start = anchor(c), end = anchor(d);
        result.push({ start, end, a: resolveMeasurementAnchor(start, geometry)!, b: resolveMeasurementAnchor(end, geometry)! });
      }
    }
  };
  for (const item of [...(geometry.boxes ?? []), ...(geometry.rectangles ?? [])]) if (!hidden.has(item.id)) append(item, item.id);
  for (const sketch of geometry.sketches ?? []) if (!hidden.has(sketch.id)) {
    append(sketch, sketch.id);
    for (const shape of sketch.shapes) append(shape, sketch.id, shape.id);
  }
  return result;
}

/** Projected picking uses pixels and corrects the edge fraction for perspective. */
export function snapMeasurement(cursor: [number, number], segments: MeasurementSegment[], project: (p: Vector3) => { x: number; y: number; w: number; visible: boolean }, isVisible: (p: Vector3) => boolean = () => true, tolerance = 12) {
  type Snap = { anchor: MeasurementAnchor; point: Vector3; kind: 'corner' | 'edge' | 'center' };
  let corner: Snap | null = null;
  let edge: Snap | null = null;
  let cornerDistance = (tolerance * 0.75) ** 2, edgeDistance = tolerance ** 2;
  for (const segment of segments) {
    const a = project(segment.a), b = project(segment.b);
    for (const [p, anchor, point] of [[a, segment.start, segment.a], [b, segment.end, segment.b]] as const) {
      // Rim tessellation vertices are edges, not discrete corner snap targets.
      if (segment.pointKind === 'edge') continue;
      const distance = (cursor[0] - p.x) ** 2 + (cursor[1] - p.y) ** 2;
      if (p.visible && distance <= cornerDistance && isVisible(point)) { cornerDistance = distance; corner = { anchor, point, kind: segment.pointKind ?? 'corner' }; }
    }
    if (!a.visible || !b.visible) continue;
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    if (length < 1e-8) continue;
    const screenT = Math.max(0, Math.min(1, ((cursor[0] - a.x) * dx + (cursor[1] - a.y) * dy) / length));
    const distance = (cursor[0] - a.x - dx * screenT) ** 2 + (cursor[1] - a.y - dy * screenT) ** 2;
    if (distance > edgeDistance) continue;
    const t = screenT * a.w / ((1 - screenT) * b.w + screenT * a.w);
    let point = segment.a.map((n, i) => n + (segment.b[i] - n) * t) as Vector3;
    const coordinates = segment.start.coordinates.map((n, i) => n + (segment.end.coordinates[i] - n) * t);
    if (segment.curveCenter) {
      // Project chord interpolation back onto the real rim, retaining live anchors.
      const radius = Math.hypot(...segment.a.map((n, i) => n - segment.curveCenter![i]));
      const length = Math.hypot(...point.map((n, i) => n - segment.curveCenter![i]));
      point = point.map((n, i) => segment.curveCenter![i] + (n - segment.curveCenter![i]) * radius / length) as Vector3;
      const [u, v] = segment.curveAxes ?? [0, 1];
      const fractionRadius = Math.hypot(coordinates[u] - 0.5, coordinates[v] - 0.5);
      coordinates[u] = 0.5 + (coordinates[u] - 0.5) / (2 * fractionRadius);
      coordinates[v] = 0.5 + (coordinates[v] - 0.5) / (2 * fractionRadius);
    }
    if (!isVisible(point)) continue;
    edgeDistance = distance;
    edge = { point, kind: 'edge', anchor: { ...segment.start, coordinates } };
  }
  return corner ?? edge;
}
