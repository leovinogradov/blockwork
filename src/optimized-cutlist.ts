import type { CutlistRow, IgnoredCutlistComponent } from './cutlist-export';
import { validateCutlistOutline } from './cutlist-outline';

export type PanelSize = { width: number; height: number };
export type OptimizedCutlist = {
  version: 1;
  source: { documentId: string; name: string };
  rows: CutlistRow[];
  ignored: IgnoredCutlistComponent[];
  maxThickness: number;
  panels: PanelSize[];
  kerf: number;
};
export type CutPlacement = PanelSize & { rowIndex: number; x: number; y: number; rotated: boolean };
export type OptimizedPanel = PanelSize & { placements: CutPlacement[] };
export type CutlistLayout = { panels: OptimizedPanel[]; usedArea: number; totalArea: number };
type FreeRectangle = PanelSize & { x: number; y: number };

function dimension(value: unknown): value is number {
  return typeof value === 'number' && value >= 1 / 64 && Number.isSafeInteger(value * 64);
}

export function validatePanelSizes(value: unknown): PanelSize[] {
  if (!Array.isArray(value) || !value.length || value.length > 20) throw new Error('Enter between 1 and 20 available panel sizes.');
  // Array.from visits missing entries too; map would silently preserve sparse holes.
  return Array.from(value, (panel) => {
    if (!panel || typeof panel !== 'object' || Array.isArray(panel) || !dimension(panel.width) || !dimension(panel.height)) throw new Error('Panel dimensions must be positive inches in increments of 1/64 within the supported range.');
    return { width: panel.width, height: panel.height };
  });
}

export function validateCutlistRows(value: unknown): CutlistRow[] {
  if (!Array.isArray(value)) throw new Error('Provide a cutlist of pieces before optimizing.');
  if (!value.length) throw new Error('The cutlist is empty.');
  if (value.length > 2000) throw new Error('A cutlist can contain at most 2000 pieces.');
  return Array.from(value, (row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string' || !row.id.trim() || typeof row.name !== 'string' || !row.name.trim()) {
      throw new Error('Every cutlist piece needs an ID and name.');
    }
    if (![row.length, row.width, row.thickness].every(dimension)) throw new Error('Cutlist dimensions must be positive inches in increments of 1/64 within the supported range.');
    return { id: row.id, name: row.name, length: row.length, width: row.width, thickness: row.thickness, ...(row.outline === undefined ? {} : { outline: validateCutlistOutline(row.outline, row.length, row.width) }) };
  });
}

export function validateSawKerf(value: unknown): number {
  if (typeof value !== 'number' || value < 0 || !Number.isSafeInteger(value * 64)) {
    throw new Error('Saw kerf must be zero or positive inches in increments of 1/64.');
  }
  return value;
}

/** Validate persisted inputs independently of any live source model. */
export function restoreOptimizedCutlist(value: unknown): OptimizedCutlist {
  const data = value as OptimizedCutlist | null;
  if (!data || data.version !== 1 || typeof data.source?.documentId !== 'string' || !data.source.documentId || typeof data.source.name !== 'string'
    || !dimension(data.maxThickness) || !Array.isArray(data.ignored) || Array.from(data.ignored).some((item) => !item || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.reason !== 'string')) {
    throw new Error('Invalid optimized cutlist.');
  }
  let rows: CutlistRow[];
  try { rows = validateCutlistRows(data.rows); }
  catch (error) { throw new Error(`Invalid optimized cutlist. ${error instanceof Error ? error.message : ''}`); }
  return structuredClone({ version: 1, source: data.source, rows, ignored: data.ignored, maxThickness: data.maxThickness, panels: validatePanelSizes(data.panels), kerf: validateSawKerf(data.kerf === undefined ? 0 : data.kerf) });
}

/** Area-decreasing best-fit guillotine packing. Every split is an end-to-end cut.
 * Simulate each available size before opening a sheet; prefer the one that holds
 * the most remaining part area, then most pieces, then least stock area.
 * Stock is unlimited, rotations are allowed, and thickness is ignored.
 * Each split consumes a kerf-width strip of waste. Stock edges need no cut.
 * This is a deterministic heuristic, not a proof of minimum sheet count.
 */
export function optimizeCutlist(inputRows: CutlistRow[], inputPanels: PanelSize[], inputKerf = 0): CutlistLayout {
  const sizes = validatePanelSizes(inputPanels);
  const kerf = validateSawKerf(inputKerf);
  const rows = validateCutlistRows(inputRows);
  const fits = (row: CutlistRow, panel: PanelSize) => row.length <= panel.width && row.width <= panel.height || row.width <= panel.width && row.length <= panel.height;
  const oversized = rows.filter((row) => !sizes.some((size) => fits(row, size)));
  if (oversized.length) throw new Error(`${oversized.length} piece${oversized.length === 1 ? '' : 's'} cannot fit any available panel (even rotated): ${oversized.slice(0, 5).map((row) => row.name).join(', ')}${oversized.length > 5 ? '…' : ''}. Add a larger panel size.`);
  let remaining = rows.map((_, index) => index).sort((a, b) => rows[b].length * rows[b].width - rows[a].length * rows[a].width || rows[b].length - rows[a].length || a - b);
  const pack = (size: PanelSize): OptimizedPanel => {
    const free: FreeRectangle[] = [{ ...size, x: 0, y: 0 }];
    const placements: CutPlacement[] = [];
    for (const rowIndex of remaining) {
      const row = rows[rowIndex];
      let best: { index: number; width: number; height: number; rotated: boolean; short: number; long: number } | undefined;
      free.forEach((space, index) => {
        for (const rotated of [false, true]) {
          const width = rotated ? row.width : row.length, height = rotated ? row.length : row.width;
          if (width > space.width || height > space.height) continue;
          const short = Math.min(space.width - width, space.height - height), long = Math.max(space.width - width, space.height - height);
          if (!best || short < best.short || short === best.short && long < best.long) best = { index, width, height, rotated, short, long };
        }
      });
      if (!best) continue;
      const { index, width, height, rotated } = best;
      const space = free.splice(index, 1)[0];
      placements.push({ rowIndex, x: space.x, y: space.y, width, height, rotated });
      const dw = space.width - width - kerf, dh = space.height - height - kerf;
      // Preserve the larger leftover rectangle with the first guillotine cut.
      if (dw * space.height > dh * space.width) {
        if (dw > 0) free.push({ x: space.x + width + kerf, y: space.y, width: dw, height: space.height });
        if (dh > 0) free.push({ x: space.x, y: space.y + height + kerf, width, height: dh });
      } else {
        if (dh > 0) free.push({ x: space.x, y: space.y + height + kerf, width: space.width, height: dh });
        if (dw > 0) free.push({ x: space.x + width + kerf, y: space.y, width: dw, height });
      }
    }
    return { ...size, placements };
  };
  const panels: OptimizedPanel[] = [];
  while (remaining.length) {
    let best: OptimizedPanel | undefined, bestArea = -1;
    for (const size of sizes) {
      const candidate = pack(size);
      const area = candidate.placements.reduce((sum, part) => sum + part.width * part.height, 0);
      if (!best || area > bestArea || area === bestArea && (candidate.placements.length > best.placements.length || candidate.placements.length === best.placements.length && size.width * size.height < best.width * best.height)) {
        best = candidate; bestArea = area;
      }
    }
    if (!best?.placements.length) throw new Error('Could not place the remaining pieces.');
    panels.push(best);
    const placed = new Set(best.placements.map((part) => part.rowIndex));
    remaining = remaining.filter((index) => !placed.has(index));
  }
  return { panels, usedArea: rows.reduce((sum, row) => sum + row.length * row.width, 0), totalArea: panels.reduce((sum, panel) => sum + panel.width * panel.height, 0) };
}

const SOURCE_MARKER = '// blockwork-optimized-cutlist: ';
export function optimizedCutlistSource(source: string, data: OptimizedCutlist): string {
  return SOURCE_MARKER + JSON.stringify(data).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + '\n' + source.split('\n').filter((line) => !line.startsWith(SOURCE_MARKER)).join('\n');
}
export function optimizedCutlistFromSource(source: string): OptimizedCutlist | undefined {
  const line = source.split('\n').find((line) => line.startsWith(SOURCE_MARKER));
  return line ? restoreOptimizedCutlist(JSON.parse(line.slice(SOURCE_MARKER.length))) : undefined;
}
