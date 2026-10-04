import { groupDescendants, type GroupSpec } from './groups';

export type TreeItem = { id: string; groupId?: string };
export type TreeDrop = { targetId?: string; placement: 'before' | 'after' | 'inside' };

/** Keep saved order, remove deleted IDs, and append new entries in their original order. */
export function normalizeTreeOrder(order: unknown, groups: GroupSpec[], items: TreeItem[]): string[] {
  const ids = [...groups, ...items].map((entry) => entry.id), valid = new Set(ids);
  return [...new Set([...(Array.isArray(order) ? order.filter((id): id is string => typeof id === 'string' && valid.has(id)) : []), ...ids])];
}

/** Plan a sibling reorder or reparent without changing geometry or accepting cycles. */
export function planTreeMove(groups: GroupSpec[], items: TreeItem[], order: string[], id: string, drop: TreeDrop) {
  const group = groups.find((entry) => entry.id === id), item = items.find((entry) => entry.id === id);
  if (!group && !item) throw new Error('Unknown component.');
  if (drop.targetId === id) throw new Error('A component cannot be dropped onto itself.');
  const targetGroup = groups.find((entry) => entry.id === drop.targetId);
  const targetItem = items.find((entry) => entry.id === drop.targetId);
  if (drop.targetId && !targetGroup && !targetItem) throw new Error('Unknown drop target.');
  if (drop.placement === 'inside' && drop.targetId && !targetGroup) throw new Error('Only groups can contain components.');
  if (!drop.targetId && drop.placement !== 'inside') throw new Error('Choose a component to reorder beside.');
  const parentId = drop.placement === 'inside' ? targetGroup?.id : targetGroup?.parentId ?? targetItem?.groupId;
  if (group && parentId && groupDescendants(groups, id).has(parentId)) throw new Error('A group cannot contain itself or a descendant.');
  const previousParent = group ? group.parentId : item?.groupId;
  const currentOrder = normalizeTreeOrder(order, groups, items);
  const nextOrder = currentOrder.filter((entryId) => entryId !== id);
  if (drop.placement === 'inside') {
    const siblings = new Set([...groups.filter((entry) => entry.id !== id && entry.parentId === parentId), ...items.filter((entry) => entry.id !== id && entry.groupId === parentId)].map((entry) => entry.id));
    const lastSibling = nextOrder.reduce((last, entryId, index) => siblings.has(entryId) ? index : last, -1);
    nextOrder.splice(lastSibling < 0 ? nextOrder.length : lastSibling + 1, 0, id);
  } else {
    nextOrder.splice(nextOrder.indexOf(drop.targetId!) + (drop.placement === 'after' ? 1 : 0), 0, id);
  }
  const siblings = new Set([...groups.filter((entry) => entry.parentId === previousParent), ...items.filter((entry) => entry.groupId === previousParent)].map((entry) => entry.id));
  const previousSiblings = currentOrder.filter((entryId) => siblings.has(entryId));
  const nextSiblings = nextOrder.filter((entryId) => siblings.has(entryId));
  return { parentId, order: nextOrder, changed: previousParent !== parentId || previousSiblings.some((entryId, index) => entryId !== nextSiblings[index]) };
}
