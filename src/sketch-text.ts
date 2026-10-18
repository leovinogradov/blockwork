import * as THREE from 'three';
import { parseFaceColor } from './face-color';
import { trimSketchText, type SketchShape } from './sketch';

const FONT = '100px sans-serif';
const MAX_TEXTURE_PIXELS = 16 * 1024 * 1024;

/** Larger inch heights get both more pixels and higher PPI, within GPU/memory limits. */
export function textRasterSize(size: [number, number], maxTextureSize = 8192, letterHeight = size[1]): [number, number] {
  const [width, height] = size;
  if (![width, height, maxTextureSize].every((n) => Number.isFinite(n) && n > 0)) throw new Error('Text dimensions must be positive and finite.');
  const ppi = 384 * Math.sqrt(Math.max(1, letterHeight));
  const density = Math.max(ppi, 64 / Math.min(width, height));
  const w = Math.ceil(width * density), h = Math.ceil(height * density);
  const limit = Math.max(1, Math.min(8192, Math.floor(maxTextureSize)));
  const scale = Math.min(1, limit / w, limit / h, Math.sqrt(MAX_TEXTURE_PIXELS / (w * h)));
  return [Math.max(1, Math.floor(w * scale)), Math.max(1, Math.floor(h * scale))];
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

export function sketchTextLetterHeight(shape: SketchShape): number {
  if (shape.textHeight !== undefined) return shape.textHeight;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) throw new Error('Text drawing requires canvas support.');
  const layout = textLayout(shape.text!, context);
  return shape.size[1] * layout.referenceHeight / layout.height;
}

export function sketchTextTopLeft(shape: SketchShape): [number, number] {
  return [shape.position[0], shape.position[1] + (shape.textHeight === undefined ? shape.size[1] : 0)];
}

export function createSketchTextMesh(shape: SketchShape, maxTextureSize = 8192) {
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = textRasterSize(shape.size, maxTextureSize, shape.textHeight ?? shape.size[1]);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Text drawing requires canvas support.');
  const layout = textLayout(shape.text!, context);
  context.scale(canvas.width / layout.width, canvas.height / layout.height);
  context.font = FONT;
  context.fillStyle = '#ffffff';
  context.textBaseline = 'alphabetic';
  layout.lines.forEach((line, index) => context.fillText(line, 2 + layout.left, 2 + layout.ascent + index * layout.lineHeight));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const color = parseFaceColor(shape.color);
  const material = new THREE.MeshBasicMaterial({ map: texture, color: color.color, opacity: color.opacity, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  return new THREE.Mesh(new THREE.PlaneGeometry(...shape.size), material);
}
