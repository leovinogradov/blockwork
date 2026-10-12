import { fileName } from './file-names';
import { formatInches, parseInches, resolveModel, type BoxSpec, type ModelSpec } from './model';
import type { GroupSpec } from './groups';
import type { ModelSketch } from './model-sketch';
import { treeChildren } from './component-tree';
import { analyzePart } from './parts';

export type CutlistRow = { id: string; name: string; length: number; width: number; thickness: number };
export type IgnoredCutlistComponent = { id: string; name: string; reason: string };
export type CutlistExportResult = {
  csv: string;
  filename: string;
  rows: CutlistRow[];
  ignored: IgnoredCutlistComponent[];
};

function componentPath(item: { name: string; groupId?: string }, groups: Map<string, GroupSpec>): string {
  const names = [item.name];
  for (let id = item.groupId; id;) {
    const group = groups.get(id)!;
    names.unshift(group.name);
    id = group.parentId;
  }
  return names.join(' > ');
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Build a cutlist from applied geometry, including boxes hidden in the viewport.
 * One row per box or connected Part follows the tree and preserves its full group path.
 * No source is executed; collapsed groups still contribute all their boxes.
 */
export function exportModelCutlist(input: ModelSpec, options: { name?: string; maxThickness?: string | number; treeOrder?: string[] } = {}): CutlistExportResult {
  const maxThickness = parseInches(options.maxThickness ?? 3);
  if (maxThickness <= 0) throw new Error('Maximum thickness must be greater than zero.');
  const model = resolveModel(input.boxes, input.variables, input.groups, input.sketches, input.measurements);
  const groups = new Map((model.groups ?? []).map((group) => [group.id, group]));
  const rows: CutlistRow[] = [];
  const ignored: IgnoredCutlistComponent[] = [];
  const items = new Map([...model.boxes, ...(model.sketches ?? [])].map((item) => [item.id, item]));
  const children = treeChildren(model.groups ?? [], [...items.values()], options.treeOrder);
  const orderedItems: (BoxSpec | ModelSketch | GroupSpec)[] = [];
  const visit = (parent?: string) => {
    for (const id of children.get(parent) ?? []) {
      if (groups.get(id)?.kind === 'part') orderedItems.push(groups.get(id)!);
      else if (groups.has(id)) visit(id);
      else orderedItems.push(items.get(id)!);
    }
  };
  visit();
  for (const box of orderedItems) {
    if ('kind' in box && box.kind === 'part') {
      const name = componentPath({ name: box.name, groupId: box.parentId }, groups);
      const body = analyzePart(box, model.boxes, model.groups ?? []);
      if (body.bodyCount !== 1) {
        ignored.push({ id: box.id, name, reason: body.bodyCount ? `Disconnected Part · ${body.bodyCount} bodies; connect its subcomponents` : 'Empty Part · no solid subcomponents' });
      } else {
        const [thickness, width, length] = [...body.size].sort((a, b) => a - b);
        if (thickness > maxThickness) ignored.push({ id: box.id, name, reason: `Thickness ${formatInches(thickness)} in exceeds ${formatInches(maxThickness)} in` });
        else rows.push({ id: box.id, name, length, width, thickness });
      }
      continue;
    }
    if (!('size' in box)) continue;
    const name = componentPath(box, groups);
    if ('shapes' in box) {
      ignored.push({ id: box.id, name, reason: 'Sketch · only boxes are included' });
      continue;
    }
    if (box.kind === 'cylinder') {
      ignored.push({ id: box.id, name, reason: 'Cylinder · only boxes are included' });
      continue;
    }
    const [thickness, width, length] = [...box.size].sort((a, b) => a - b);
    if (thickness > maxThickness) {
      ignored.push({ id: box.id, name, reason: `Thickness ${formatInches(thickness)} in exceeds ${formatInches(maxThickness)} in` });
    } else {
      rows.push({ id: box.id, name, length, width, thickness });
    }
  }
  const header = ['Item No.', 'Component', 'Quantity', 'Length (in)', 'Width (in)', 'Thickness (in)'];
  const records = rows.map((row, index) => [index + 1, row.name, 1, row.length, row.width, row.thickness]);
  const csv = [header, ...records].map((record) => record.map(csvCell).join(',')).join('\r\n') + '\r\n';
  const name = fileName(options.name ?? 'Model');
  return { csv, filename: `${name.replace(/\.csv$/i, '')}-cutlist.csv`, rows, ignored };
}
