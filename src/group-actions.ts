import { normalizeTreeOrder, type TreeItem } from './component-tree';
import { groupDescendants, reparentPosition, type GroupSpec } from './groups';
import type { Measurement } from './measurements';
import { reparentBox, type BoxSpec } from './model';
import type { ModelSketch } from './model-sketch';
import type { SketchShape } from './sketch';

/** Groups mask descendants; a Part alone owns visibility for its whole body. */
export function effectiveHiddenIds(groups: GroupSpec[], items: TreeItem[], hiddenIds: Iterable<string>): Set<string> {
  const partIds = new Set(groups.filter((group) => group.kind === 'part').map((group) => group.id));
  const partMembers = new Set(items.filter((item) => item.groupId && partIds.has(item.groupId)).map((item) => item.id));
  const hidden = new Set([...hiddenIds].filter((id) => !partMembers.has(id)));
  const children = new Map<string, string[]>();
  const addChild = (parentId: string | undefined, id: string) => {
    if (!parentId) return;
    const siblings = children.get(parentId) ?? [];
    siblings.push(id); children.set(parentId, siblings);
  };
  for (const group of groups) {
    addChild(group.parentId, group.id);
  }
  for (const item of items) addChild(item.groupId, item.id);
  const queue = [...hidden];
  for (let i = 0; i < queue.length; i++) {
    for (const id of children.get(queue[i]) ?? []) {
      if (!hidden.has(id)) { hidden.add(id); queue.push(id); }
    }
  }
  return hidden;
}

type GroupGeometry = {
  groups: GroupSpec[];
  boxes: BoxSpec[];
  sketches: ModelSketch[];
  rectangles: SketchShape[];
  measurements: Measurement[];
};

/** A selected container already includes its descendants for branch operations. */
export function treeSelectionRoots(scene: Pick<GroupGeometry, 'groups'>, items: TreeItem[], selected: ReadonlySet<string>): string[] {
  const parents = new Map([...scene.groups.map((group) => [group.id, group.parentId] as const), ...items.map((item) => [item.id, item.groupId] as const)]);
  return [...selected].filter((id) => {
    for (let parent = parents.get(id); parent; parent = parents.get(parent)) if (selected.has(parent)) return false;
    return parents.has(id);
  });
}

/** Copy every selected branch once, keeping shared internal references together. */
export function duplicateTreeSelection(scene: GroupGeometry, selected: ReadonlySet<string>, order: string[], createId: () => string = () => crypto.randomUUID()) {
  const items = [...scene.boxes, ...scene.sketches, ...scene.rectangles, ...scene.measurements];
  const roots = new Set(treeSelectionRoots(scene, items, selected));
  const branches = new Set(scene.groups.filter((group) => roots.has(group.id)).flatMap((group) => [...groupDescendants(scene.groups, group.id)]));
  const included = [...scene.groups.filter((group) => branches.has(group.id)), ...items.filter((item) => roots.has(item.id) || !!item.groupId && branches.has(item.groupId))];
  const ids = new Map(included.map((entry) => [entry.id, createId()]));
  const copyItem = <T extends TreeItem & { name?: string }>(item: T): T => ({
    ...structuredClone(item), id: ids.get(item.id)!, groupId: ids.get(item.groupId!) ?? item.groupId,
    ...(roots.has(item.id) ? { name: `${item.name ?? 'Measurement'} copy` } : {}),
  });
  const offset = <T extends { id: string; position: number[] }>(original: T, copy: T): T => {
    if (roots.has(original.id)) { copy.position[0] += 1; copy.position[1] += 1; }
    return copy;
  };
  const groups = scene.groups.filter((group) => ids.has(group.id)).map((group) => offset(group, {
    ...structuredClone(group), id: ids.get(group.id)!, parentId: ids.get(group.parentId!) ?? group.parentId,
    name: roots.has(group.id) ? `${group.name} copy` : group.name,
  }));
  const boxes = scene.boxes.filter((box) => ids.has(box.id)).map((box) => {
    const copy = offset(box, copyItem(box));
    if (copy.relative) copy.relative.boxId = ids.get(copy.relative.boxId) ?? copy.relative.boxId;
    return copy;
  });
  const measurements = scene.measurements.filter((item) => ids.has(item.id)).map((item) => {
    const copy = copyItem(item);
    for (const anchor of [copy.start, copy.end]) anchor.objectId = ids.get(anchor.objectId) ?? anchor.objectId;
    return copy;
  });
  const treeOrder = normalizeTreeOrder(order, scene.groups, items).flatMap((id) => ids.has(id) ? [id, ids.get(id)!] : [id]);
  return {
    groups, boxes, measurements, ids, treeOrder, rootIds: [...roots].map((id) => ids.get(id)!),
    sketches: scene.sketches.filter((item) => ids.has(item.id)).map((item) => offset(item, copyItem(item))),
    rectangles: scene.rectangles.filter((item) => ids.has(item.id)).map((item) => offset(item, copyItem(item))),
  };
}

/** Delete selected objects and dissolve selected containers, preserving other members. */
export function removeTreeSelection(scene: GroupGeometry, selected: ReadonlySet<string>): GroupGeometry {
  const parents = new Map(scene.groups.map((group) => [group.id, group.parentId]));
  const retainedParent = (id?: string): string | undefined => {
    while (id && selected.has(id)) id = parents.get(id);
    return id;
  };
  return {
    groups: scene.groups.filter((group) => !selected.has(group.id)).map((group) => selected.has(group.parentId ?? '')
      ? { ...group, parentId: retainedParent(group.parentId), position: reparentPosition(group.position, scene.groups, group.parentId, retainedParent(group.parentId)) } : group),
    boxes: scene.boxes.filter((box) => !selected.has(box.id)).map((box) => {
      const next = selected.has(box.groupId ?? '') ? reparentBox(box, scene.groups, retainedParent(box.groupId)) : box;
      if (!next.relative || !selected.has(next.relative.boxId)) return next;
      const expressions = { ...next.expressions };
      for (const field of ['relative.offset', 'relative.u.offset', 'relative.v.offset', 'position.0', 'position.1', 'position.2'] as const) delete expressions[field];
      return { ...next, relative: undefined, expressions };
    }),
    sketches: scene.sketches.filter((item) => !selected.has(item.id)).map((item) => selected.has(item.groupId ?? '')
      ? { ...item, groupId: retainedParent(item.groupId), position: reparentPosition(item.position, scene.groups, item.groupId, retainedParent(item.groupId)) } : item),
    rectangles: scene.rectangles.filter((item) => !selected.has(item.id)).map((item) => selected.has(item.groupId ?? '')
      ? { ...item, groupId: retainedParent(item.groupId), position: reparentPosition(item.position, scene.groups, item.groupId, retainedParent(item.groupId)).slice(0, 2) as [number, number] } : item),
    measurements: scene.measurements.filter((item) => !selected.has(item.id)).map((item) => selected.has(item.groupId ?? '')
      ? { ...item, groupId: retainedParent(item.groupId) } : item),
  };
}

/** Copy a branch beside its source; IDs inside relations follow the copied objects. */
export function duplicateGroupBranch(scene: GroupGeometry, groupId: string, order: string[], createId: () => string = () => crypto.randomUUID()) {
  if (!scene.groups.some((group) => group.id === groupId)) throw new Error('Unknown group.');
  const copy = duplicateTreeSelection(scene, new Set([groupId]), order, createId);
  return { ...copy, rootId: copy.rootIds[0] };
}
