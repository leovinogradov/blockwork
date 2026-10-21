import * as THREE from 'three';
import { parseFaceColor } from './face-color';
import { trimSketchText, type SketchTextShape } from './sketch';

const FONT = '100px sans-serif';
const MAX_TEXTURE_PIXELS = 1024 * 1024;
export const TEXT_TEXTURE_PIXEL_BUDGET = 4 * 1024 * 1024;

/** Raster detail follows letter height in pixels, independent of the drawing's inch scale. */
export function textRasterSize(size: [number, number], letterHeight: number, maxTextureSize = 8192, maxPixels = MAX_TEXTURE_PIXELS): [number, number] {
  const [width, height] = size;
  if (![width, height, maxTextureSize, letterHeight, maxPixels].every((n) => Number.isFinite(n) && n > 0)) throw new Error('Text dimensions must be positive and finite.');
  const density = 128 / letterHeight;
  const w = Math.ceil(width * density), h = Math.ceil(height * density);
  const limit = Math.max(1, Math.min(2048, Math.floor(maxTextureSize)));
  const scale = Math.min(1, limit / w, limit / h, Math.sqrt(Math.min(MAX_TEXTURE_PIXELS, maxPixels) / (w * h)));
  return [Math.max(1, Math.floor(w * scale)), Math.max(1, Math.floor(h * scale))];
}

/** Share a fixed viewport budget while retaining the original density for small drawings. */
export function textRasterBudgets(shapes: SketchTextShape[], maxTextureSize = 8192): number[] {
  const pixels = shapes.map((shape) => {
    const [width, height] = textRasterSize(shape.size, shape.textHeight, maxTextureSize);
    return width * height;
  });
  const scale = Math.min(1, TEXT_TEXTURE_PIXEL_BUDGET / pixels.reduce((sum, count) => sum + count, 0));
  return pixels.map((count) => Math.max(1, Math.floor(count * scale)));
}

export function textLayout(text: string, context: CanvasRenderingContext2D, trimTrailing = true) {
  context.font = FONT;
  const lines = (trimTrailing ? trimSketchText(text) : text.replace(/\r\n?/g, '\n')).split('\n');
  const referenceHeight = context.measureText('H').actualBoundingBoxAscent;
  const metrics = lines.map((line) => context.measureText(line));
  const ascent = Math.max(referenceHeight, ...metrics.map((m) => m.actualBoundingBoxAscent));
  const descent = Math.max(0, ...metrics.map((m) => m.actualBoundingBoxDescent));
  const left = Math.max(0, ...metrics.map((m) => m.actualBoundingBoxLeft));
  const width = Math.max(1, ...metrics.map((m) => Math.max(m.width, m.actualBoundingBoxRight) + left)) + 4;
  const lineHeight = referenceHeight * 1.4;
  const fontMetrics = context.measureText('Hg');
  const cssBaseline = (lineHeight - fontMetrics.fontBoundingBoxAscent - fontMetrics.fontBoundingBoxDescent) / 2 + fontMetrics.fontBoundingBoxAscent;
  return { lines, ascent, left, width, lineHeight, referenceHeight, cssBaseline, height: ascent + descent + (lines.length - 1) * lineHeight + 4 };
}

/** Letter height is the height of a capital H, independent of content and line count. */
export function sketchTextSize(text: string, height: number): [number, number] {
  if (!text.trim() || text.length > 4000) throw new Error('Text must contain between 1 and 4000 characters.');
  if (!Number.isFinite(height) || height <= 0) throw new Error('Text height must be positive.');
  const context = document.createElement('canvas').getContext('2d');
  if (!context) throw new Error('Text drawing requires canvas support.');
  const layout = textLayout(text, context);
  return [height * layout.width / layout.referenceHeight, height * layout.height / layout.referenceHeight];
}

export function createSketchTextMaterial(shape: SketchTextShape, maxTextureSize = 8192, maxPixels = MAX_TEXTURE_PIXELS) {
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = textRasterSize(shape.size, shape.textHeight, maxTextureSize, maxPixels);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Text drawing requires canvas support.');
  const layout = textLayout(shape.text, context);
  context.scale(canvas.width / layout.width, canvas.height / layout.height);
  context.font = FONT;
  context.fillStyle = '#ffffff';
  context.textBaseline = 'alphabetic';
  layout.lines.forEach((line, index) => context.fillText(line, 2 + layout.left, 2 + layout.ascent + index * layout.lineHeight));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const color = parseFaceColor(shape.color);
  return new THREE.MeshBasicMaterial({ map: texture, color: color.color, opacity: color.opacity, transparent: true, side: THREE.DoubleSide, depthWrite: false });
}

export function createSketchTextMesh(shape: SketchTextShape, maxTextureSize = 8192, maxPixels = MAX_TEXTURE_PIXELS) {
  return new THREE.Mesh(new THREE.PlaneGeometry(...shape.size), createSketchTextMaterial(shape, maxTextureSize, maxPixels));
}
