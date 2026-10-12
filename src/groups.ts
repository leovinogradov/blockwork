import { getFaceFrame, parseInches, type BoxSpec, type FaceName } from './model';

export type Vector3 = [number, number, number];
/** Organizational group or manufactured Part. Positions are parent-local. */
export const DEFAULT_PART_COLOR = '#d9a76e';
export type GroupSpec = { id: string; name: string; position: Vector3; parentId?: string; kind?: 'part'; color?: string };
/** A sketch can extend a group with a plane frame, using the same local coordinates. */
export type PlaneFrame = { origin: Vector3; u: Vector3; v: Vector3; normal: Vector3 };

export function validateGroups(input: unknown = [], planar = false): GroupSpec[] {
  if (!Array.isArray(input) || input.length > 2000) throw new Error('Groups must be an array of at most 2000 groups.');
  const ids = new Set<string>();
  const groups = input.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Each group must be an object.');
    if (typeof raw.id !== 'string' || !raw.id.trim() || ids.has(raw.id)) throw new Error('Each group needs a unique ID.');
    ids.add(raw.id);
    if (typeof raw.name !== 'string' || !raw.name.trim()) throw new Error(`Group ${raw.id} needs a name.`);
    const position = raw.position ?? [0, 0, 0];
    if (!Array.isArray(position) || position.length !== 3 || position.some((n) => typeof n !== 'string' && typeof n !== 'number')) throw new Error('Group position needs three inch values.');
    const result: GroupSpec = { id: raw.id, name: raw.name, position: position.map((n) => parseInches(n)) as Vector3 };
    if (raw.kind !== undefined) {
      if (raw.kind !== 'part') throw new Error('Unknown container kind.');
      if (planar) throw new Error('Parts belong in 3D models, not 2D sketches.');
      result.kind = 'part';
      const color = raw.color ?? DEFAULT_PART_COLOR;
      if (typeof color !== 'string' || !color.trim()) throw new Error(`Part ${raw.id} needs a color.`);
      result.color = color;
    }
    if (planar && result.position[2] !== 0) throw new Error('Sketch groups must stay on the X/Y plane (Z = 0).');
    if (raw.parentId !== undefined) {
      if (typeof raw.parentId !== 'string' || !raw.parentId.trim()) throw new Error('Group parentId must be a group ID.');
      result.parentId = raw.parentId;
    }
    return result;
  });
  const byId = new Map(groups.map((g) => [g.id, g]));
  const done = new Set<string>(), visiting = new Set<string>();
  const visit = (g: GroupSpec) => {
    if (visiting.has(g.id)) throw new Error(`Group cycle involving ${g.id}.`);
    if (done.has(g.id)) return;
    visiting.add(g.id);
    if (g.parentId) {
      const parent = byId.get(g.parentId);
      if (!parent) throw new Error(`Unknown parent group ${g.parentId}.`);
      if (parent.kind === 'part') throw new Error('A Part contains subcomponents, not groups or other Parts.');
      visit(parent);
    }
    visiting.delete(g.id); done.add(g.id);
  };
  groups.forEach(visit);
  return groups;
}

export function validateGroupMembers(items: { id: string; groupId?: string }[], groups: GroupSpec[]) {
  const ids = new Set(groups.map((g) => g.id));
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`Object and group IDs must be distinct: ${item.id}.`);
    if (item.groupId !== undefined && !ids.has(item.groupId)) throw new Error(`Unknown group ${item.groupId} for ${item.id}.`);
  }
}

export function groupOffset(groups: GroupSpec[], id?: string): Vector3 {
  const offset: Vector3 = [0, 0, 0];
  const seen = new Set<string>();
  while (id) {
    if (seen.has(id)) throw new Error(`Group cycle involving ${id}.`);
    seen.add(id);
    const group = groups.find((g) => g.id === id);
    if (!group) throw new Error(`Unknown group ${id}.`);
    group.position.forEach((n, i) => { offset[i] += n; });
    id = group.parentId;
  }
  return offset;
}

export function worldPosition(position: number[], groups: GroupSpec[], groupId?: string): Vector3 {
  const offset = groupOffset(groups, groupId);
  return offset.map((n, i) => n + (position[i] ?? 0)) as Vector3;
}

/** Reparent without moving the item in world space. */
export function reparentPosition(position: number[], groups: GroupSpec[], from?: string, to?: string): Vector3 {
  const world = worldPosition(position, groups, from), offset = groupOffset(groups, to);
  return world.map((n, i) => n - offset[i]) as Vector3;
}

export function groupDescendants(groups: GroupSpec[], id: string): Set<string> {
  const result = new Set([id]);
  for (let changed = true; changed;) {
    changed = false;
    for (const group of groups) if (group.parentId && result.has(group.parentId) && !result.has(group.id)) { result.add(group.id); changed = true; }
  }
  return result;
}

/** Emit ownership as nested helper calls, using IDs only in the internal model. */
export function generateGroupedSource<T extends { id: string; groupId?: string }>(groups: GroupSpec[], items: T[], serializeItem: (item: T) => string, order: string[] = []): string[] {
  const entries = new Map<string, { parent?: string; group?: GroupSpec; item?: T }>();
  for (const group of groups) entries.set(group.id, { parent: group.parentId, group });
  for (const item of items) entries.set(item.id, { parent: item.groupId, item });
  const children = new Map<string | undefined, string[]>();
  for (const id of new Set([...order, ...entries.keys()])) {
    const entry = entries.get(id);
    if (!entry) continue;
    const siblings = children.get(entry.parent) ?? [];
    siblings.push(id); children.set(entry.parent, siblings);
  }
  const emit = (id: string, depth: number): string[] => {
    const entry = entries.get(id)!;
    const indent = '  '.repeat(depth), ending = depth === 0 ? ';' : ',';
    if (entry.item) return `${serializeItem(entry.item)}${ending}`.split('\n').map((line) => `${indent}${line}`);
    const { id: groupId, name, position } = entry.group!;
    const properties = JSON.stringify({ id: groupId, name, position, ...(entry.group!.kind === 'part' ? { color: entry.group!.color ?? DEFAULT_PART_COLOR } : {}) });
    const helper = entry.group!.kind === 'part' ? 'part' : 'group';
    const members = children.get(id) ?? [];
    if (!members.length) return [`${indent}${helper}(${properties}, [])${ending}`];
    return [`${indent}${helper}(${properties}, [`, ...members.flatMap((child) => emit(child, depth + 1)), `${indent}])${ending}`];
  };
  return (children.get(undefined) ?? []).flatMap((id) => emit(id, 0));
}

/** Common mapping for future plane- or face-mounted sketch containers. */
export function pointOnPlane(frame: PlaneFrame, [u, v, normal = 0]: number[]): Vector3 {
  return frame.origin.map((n, i) => n + u * frame.u[i] + v * frame.v[i] + normal * frame.normal[i]) as Vector3;
}

export function boxFacePlane(box: BoxSpec, face: FaceName, groups: GroupSpec[] = []): PlaneFrame {
  const axes = getFaceFrame(face), origin = worldPosition(box.position, groups, box.groupId);
  if (axes.normalSign > 0) origin[axes.normalAxis] += box.size[axes.normalAxis];
  if (axes.uSign < 0) origin[axes.uAxis] += box.size[axes.uAxis];
  if (axes.vSign < 0) origin[axes.vAxis] += box.size[axes.vAxis];
  const axis = (index: number, sign: number): Vector3 => [0, 1, 2].map((i) => i === index ? sign : 0) as Vector3;
  return { origin, u: axis(axes.uAxis, axes.uSign), v: axis(axes.vAxis, axes.vSign), normal: axis(axes.normalAxis, axes.normalSign) };
}
