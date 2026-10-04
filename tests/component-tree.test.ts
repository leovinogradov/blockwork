import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTreeOrder, planTreeMove, type TreeItem } from '../src/component-tree';
import { createBlankDocument, resolveSnapshot, restoreWorkspace, serializeWorkspace } from '../src/documents';
import type { GroupSpec } from '../src/groups';

const groups: GroupSpec[] = [
  { id: 'a', name: 'A', position: [10, 20, 0] },
  { id: 'b', name: 'B', position: [-5, 0, 0] },
  { id: 'nested', name: 'Nested', position: [2, 3, 0], parentId: 'a' },
];
const items: TreeItem[] = [{ id: 'one' }, { id: 'two', groupId: 'a' }, { id: 'three', groupId: 'nested' }, { id: 'four', groupId: 'a' }];
const order = normalizeTreeOrder([], groups, items);
const siblings = (ids: string[], parent?: string, moving?: { id: string; parentId?: string }) => ids.filter((id) => {
  if (moving?.id === id) return moving.parentId === parent;
  const group = groups.find((entry) => entry.id === id);
  return (group ? group.parentId : items.find((entry) => entry.id === id)?.groupId) === parent;
});

test('reorders mixed groups and objects in both directions without changing their parent', () => {
  const before = planTreeMove(groups, items, order, 'one', { targetId: 'a', placement: 'before' });
  assert.equal(before.parentId, undefined);
  assert.deepEqual(siblings(before.order), ['one', 'a', 'b']);
  const after = planTreeMove(groups, items, before.order, 'a', { targetId: 'one', placement: 'after' });
  assert.deepEqual(siblings(after.order), ['one', 'a', 'b']);
  assert.equal(after.changed, false);
  const nested = planTreeMove(groups, items, order, 'four', { targetId: 'two', placement: 'before' });
  assert.equal(nested.parentId, 'a');
  assert.deepEqual(siblings(nested.order, 'a'), ['nested', 'four', 'two']);
});

test('drop into a group appends after existing children and accepts empty groups', () => {
  const move = planTreeMove(groups, items, order, 'one', { targetId: 'a', placement: 'inside' });
  assert.equal(move.parentId, 'a');
  assert.deepEqual(siblings(move.order, 'a', { id: 'one', parentId: move.parentId }), ['nested', 'two', 'four', 'one']);
  assert.equal(planTreeMove(groups, items, order, 'one', { targetId: 'b', placement: 'inside' }).parentId, 'b');
  assert.equal(planTreeMove(groups, items, order, 'b', { targetId: 'a', placement: 'inside' }).parentId, 'a');
});

test('drop beside a child changes parent, and root drop removes membership', () => {
  assert.equal(planTreeMove(groups, items, order, 'one', { targetId: 'three', placement: 'after' }).parentId, 'nested');
  const root = planTreeMove(groups, items, order, 'two', { placement: 'inside' });
  assert.equal(root.parentId, undefined);
  assert.deepEqual(siblings(root.order, undefined, { id: 'two' }), ['a', 'b', 'one', 'two']);
});

test('blocks cycles and invalid targets without mutating input', () => {
  const original = structuredClone({ groups, items, order });
  for (const drop of [
    { targetId: 'nested', placement: 'inside' as const },
    { targetId: 'three', placement: 'before' as const },
    { targetId: 'nested', placement: 'after' as const },
  ]) assert.throws(() => planTreeMove(groups, items, order, 'a', drop), /descendant/);
  assert.throws(() => planTreeMove(groups, items, order, 'a', { targetId: 'a', placement: 'inside' }), /itself/);
  assert.throws(() => planTreeMove(groups, items, order, 'one', { targetId: 'two', placement: 'inside' }), /Only groups/);
  assert.throws(() => planTreeMove(groups, items, order, 'missing', { placement: 'inside' }), /Unknown component/);
  assert.throws(() => planTreeMove(groups, items, order, 'one', { targetId: 'missing', placement: 'after' }), /Unknown drop/);
  assert.deepEqual({ groups, items, order }, original);
});

test('normalizes old saves, duplicates, deleted IDs, malformed data, and new entries', () => {
  assert.deepEqual(normalizeTreeOrder(['one', 'one', 'missing', 42, 'b'], groups, items), ['one', 'b', 'a', 'nested', 'two', 'three', 'four']);
  assert.deepEqual(normalizeTreeOrder(undefined, groups, items), order);
  assert.deepEqual(normalizeTreeOrder('bad', groups, items), order);
});

test('dropping the last child into its current group is a no-op despite unrelated entries', () => {
  assert.equal(planTreeMove(groups, items, order, 'four', { targetId: 'a', placement: 'inside' }).changed, false);
});

test('tree order survives reloads and undo snapshots independently for models and sketches', () => {
  for (const kind of ['model', 'sketch'] as const) {
    const document = createBlankDocument([], kind);
    document.groups = structuredClone(groups);
    const shape = { id: 'one', name: 'One', size: [2, 3], position: [1, 2], color: '#ffffff' };
    if (kind === 'sketch') document.rectangles = [{ ...shape, size: [2, 3], position: [1, 2] }];
    else document.boxes = [{ ...shape, size: [2, 3, 4], position: [1, 2, 3] }];
    document.treeOrder = ['one', 'b', 'a', 'nested'];
    const restored = restoreWorkspace(serializeWorkspace([document], document.id)).documents[0];
    assert.deepEqual(restored.treeOrder, document.treeOrder);
    assert.deepEqual(resolveSnapshot(restored.history[0], kind).treeOrder, document.treeOrder);
    restored.history[0].treeOrder!.reverse();
    assert.deepEqual(restored.treeOrder, document.treeOrder);
    assert.deepEqual(resolveSnapshot({ ...restored.history[0], treeOrder: undefined }, kind).treeOrder, ['a', 'b', 'nested', 'one']);
  }
});
