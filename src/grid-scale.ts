import { MathUtils, OrthographicCamera, type PerspectiveCamera } from 'three';

export const GRID_LINE_OPACITY = 0.48;
// Freeze the tint at the coverage of two-pixel-spaced inch lines, where they
// become fully hidden. Further zooming out should not brighten the ground.
const MAX_GRID_FILL_OPACITY = 1 - (1 - GRID_LINE_OPACITY / 2) ** 2;

/**
 * Fake anti-aliasing for the inch grid when zoomed out: the feet grid's fill
 * uses the inch line color and approximates the average opacity those hidden
 * lines would contribute. This preserves their visual tint instead of making
 * the ground abruptly darker when the inch lines disappear.
 *
 * Estimate coverage from one-pixel lines at the camera target's scale; this is
 * an approximation, not per-fragment filtering of the perspective grid. Between
 * 2 and 5 pixels per inch, fade the fill out while revealing the actual lines,
 * so the tint appears to resolve into line detail as the user zooms in.
 * Cap the fill at its fully hidden-line opacity to keep distant views subtle.
 */
export function gridAppearanceForCamera(
  camera: PerspectiveCamera | OrthographicCamera,
  distanceToTarget: number,
  viewportHeight: number,
): { inchBlend: number; fillOpacity: number } {
  const viewHeight = camera instanceof OrthographicCamera
    ? (camera.top - camera.bottom) / camera.zoom
    : 2 * distanceToTarget * Math.tan(MathUtils.degToRad(camera.getEffectiveFOV()) / 2);
  const pixelsPerInch = viewportHeight / Math.max(viewHeight, 0.0001);
  const inchBlend = MathUtils.smoothstep(pixelsPerInch, 2, 5);
  // A one-pixel line covers 1 / spacing of each axis. Average both line
  // families using the same alpha compositing as their intersections.
  const axisCoverage = Math.min(1, 1 / Math.max(pixelsPerInch, 0.0001));
  const averageOpacity = 1 - (1 - GRID_LINE_OPACITY * axisCoverage) ** 2;
  return { inchBlend, fillOpacity: Math.min(averageOpacity, MAX_GRID_FILL_OPACITY) * (1 - inchBlend) };
}
