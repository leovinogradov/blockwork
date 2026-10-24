import { cylinderAxes, type BoxSpec } from './model';

type Point = [number, number];
export type CutlistOutline = [Point, Point][];
const EPS = 1e-9;
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const subtract = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const grid = (point: Point): Point => point.map((n) => Math.round(n * 64) / 64) as Point;

// Rounding a small circle can create duplicate or concave vertices. Its hull
// restores a convex, counterclockwise polygon for the clipping below.
function hull(points: Point[]): Point[] {
  const sorted = [...new Map(points.map((p) => [p.join(','), p])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (input: Point[]) => {
    const result: Point[] = [];
    for (const point of input) {
      while (result.length > 1 && cross(subtract(result.at(-1)!, result.at(-2)!), subtract(point, result.at(-1)!)) <= 0) result.pop();
      result.push(point);
    }
    return result.slice(0, -1);
  };
  return [...half(sorted), ...half(sorted.slice().reverse())];
}

/** View along the smallest stock dimension, with length on X and width on Y.
 * Solids have resolved world positions. Union their projections so additive
 * subcomponent seams disappear; holes in the silhouette retain their boundaries.
 * Circular ends use the viewport's 96-segment approximation on the inch grid.
 */
export function partCutlistOutline(solids: BoxSpec[], min: number[], size: number[]): CutlistOutline {
  const axes = [0, 1, 2].sort((a, b) => size[a] - size[b] || a - b);
  const [depth, v, u] = axes;
  const polygons = solids.map((solid): Point[] => {
    const x = solid.position[u] - min[u], y = solid.position[v] - min[v];
    const w = solid.size[u], h = solid.size[v];
    if (solid.kind === 'cylinder' && cylinderAxes(solid).lengthAxis === depth) {
      return hull(Array.from({ length: 96 }, (_, i) => grid([x + w / 2 + w / 2 * Math.cos(i * Math.PI / 48), y + h / 2 + h / 2 * Math.sin(i * Math.PI / 48)])));
    }
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  });
  const bounds = polygons.map((polygon) => [
    Math.min(...polygon.map((p) => p[0])), Math.min(...polygon.map((p) => p[1])),
    Math.max(...polygon.map((p) => p[0])), Math.max(...polygon.map((p) => p[1])),
  ]);
  const result: CutlistOutline = [];
  polygons.forEach((polygon, index) => {
    polygon.forEach((start, edge) => {
      const end = polygon[(edge + 1) % polygon.length], delta = subtract(end, start);
      let visible = [[0, 1]];
      polygons.forEach((other, otherIndex) => {
        if (otherIndex === index || !visible.length) return;
        const [x1, y1, x2, y2] = bounds[otherIndex];
        if (Math.max(start[0], end[0]) < x1 || Math.min(start[0], end[0]) > x2 || Math.max(start[1], end[1]) < y1 || Math.min(start[1], end[1]) > y2) return;
        let low = 0, high = 1;
        for (let j = 0; j < other.length; j++) {
          const direction = subtract(other[(j + 1) % other.length], other[j]);
          const value = cross(direction, subtract(start, other[j])), slope = cross(direction, delta);
          if (Math.abs(slope) < EPS) {
            if (value < -EPS) return; // Entire edge is outside this polygon.
            if (Math.abs(value) < EPS && direction[0] * delta[0] + direction[1] * delta[1] > 0 && otherIndex > index) return; // Keep one copy of coincident exterior edges.
          } else if (slope > 0) low = Math.max(low, -value / slope);
          else high = Math.min(high, -value / slope);
          if (high - low < EPS) return;
        }
        visible = visible.flatMap(([a, b]) => {
          if (high <= a || low >= b) return [[a, b]];
          return [...(low > a ? [[a, low]] : []), ...(high < b ? [[high, b]] : [])];
        });
      });
      const point = (t: number): Point => grid([start[0] + delta[0] * t, start[1] + delta[1] * t]);
      for (const [a, b] of visible) {
        const first = point(a), last = point(b);
        if (first[0] !== last[0] || first[1] !== last[1]) result.push([first, last]);
      }
    });
  });
  return result;
}

export function validateCutlistOutline(value: unknown, length: number, width: number): CutlistOutline {
  if (!Array.isArray(value) || !value.length || value.length > 10000) throw new Error('Invalid cutlist outline.');
  return Array.from(value, (segment) => {
    if (!Array.isArray(segment) || segment.length !== 2) throw new Error('Invalid cutlist outline segment.');
    const points = Array.from(segment, (point): Point => {
      if (!Array.isArray(point) || point.length !== 2 || Array.from(point).some((n, axis) => typeof n !== 'number' || n < 0 || n > [length, width][axis] || !Number.isSafeInteger(n * 64))) throw new Error('Invalid cutlist outline point.');
      return [point[0], point[1]];
    });
    if (points[0][0] === points[1][0] && points[0][1] === points[1][1]) throw new Error('Invalid cutlist outline segment.');
    return [points[0], points[1]];
  });
}
