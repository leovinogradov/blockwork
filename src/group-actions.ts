import { normalizeTreeOrder, type TreeItem } from './component-tree';
import { groupDescendants, type GroupSpec } from './groups';
import type { Measurement } from './measurements';
import type { BoxSpec } from './model';
import type { ModelSketch } from './model-sketch';
import type { SketchShape } from './sketch';

/** Group visibility masks descendants without changing their own visibility settings. */
export function effectiveHiddenIds(groups: GroupSpec[], items: TreeItem[], hiddenIds: Iterable<string>): Set<string> {
  const hidden = new Set(hiddenIds);
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

/** Copy a branch beside its source; IDs inside relations follow the copied objects. */
export function duplicateGroupBranch(scene: GroupGeometry, groupId: string, order: string[], createId: () => string = () => crypto.randomUUID()) {
  const root = scene.groups.find((group) => group.id === groupId);
  if (!root) throw new Error('Unknown group.');
  const descendants = groupDescendants(scene.groups, groupId);
  const members = [...scene.boxes, ...scene.sketches, ...scene.rectangles, ...scene.measurements];
  const belongs = (item: TreeItem) => !!item.groupId && descendants.has(item.groupId);
  const ids = new Map([...scene.groups.filter((group) => descendants.has(group.id)), ...members.filter(belongs)].map((entry) => [entry.id, createId()]));
  const copyMember = <T extends TreeItem>(item: T): T => ({ ...structuredClone(item), id: ids.get(item.id)!, groupId: ids.get(item.groupId!)! });
  const groups = scene.groups.filter((group) => descendants.has(group.id)).map((group) => ({
    ...structuredClone(group), id: ids.get(group.id)!,
    ...(group.id === groupId
      ? { name: `${group.name} copy`, position: [group.position[0] + 1, group.position[1] + 1, group.position[2]] as [number, number, number] }
      : { parentId: ids.get(group.parentId!)! }),
  }));
  const boxes = scene.boxes.filter(belongs).map((box) => {
    const copy = copyMember(box);
    if (copy.relative) copy.relative.boxId = ids.get(copy.relative.boxId) ?? copy.relative.boxId;
    return copy;
  });
  const measurements = scene.measurements.filter(belongs).map((measurement) => {
    const copy = copyMember(measurement);
    for (const anchor of [copy.start, copy.end]) anchor.objectId = ids.get(anchor.objectId) ?? anchor.objectId;
    return copy;
  });
  const treeOrder = normalizeTreeOrder(order, scene.groups, members);
  const copiedOrder = treeOrder.filter((id) => ids.has(id)).map((id) => ids.get(id)!);
  treeOrder.splice(treeOrder.indexOf(groupId) + 1, 0, ...copiedOrder);
  return {
    groups, boxes, measurements, ids, treeOrder, rootId: ids.get(groupId)!,
    sketches: scene.sketches.filter(belongs).map(copyMember),
    rectangles: scene.rectangles.filter(belongs).map(copyMember),
  };
}
