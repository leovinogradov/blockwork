import test from 'node:test';
import assert from 'node:assert/strict';
import { updateTreeSelection } from '../src/tree-selection';

const visible = ['a', 'group', 'b', 'part', 'c', 'dimension'];

test('plain click replaces selection and Ctrl/Cmd-click independently toggles rows', () => {
  const plain = updateTreeSelection(['a', 'c'], visible, 'b', 'a');
  assert.deepEqual([...plain.ids], ['b']);
  assert.equal(plain.anchorId, 'b');
  for (const modifiers of [{ ctrlKey: true }, { metaKey: true }]) {
    const added = updateTreeSelection(plain.ids, visible, 'part', plain.anchorId, modifiers);
    assert.deepEqual([...added.ids], ['b', 'part']);
    assert.equal(added.anchorId, 'part');
    assert.deepEqual([...updateTreeSelection(added.ids, visible, 'b', added.anchorId, modifiers).ids], ['part']);
  }
});

test('Shift selects ranges in displayed order in both directions, retaining the anchor when shrinking', () => {
  const extended = updateTreeSelection(['b', 'dimension'], visible, 'c', 'b', { shiftKey: true });
  assert.deepEqual([...extended.ids], ['b', 'part', 'c']);
  assert.equal(extended.anchorId, 'b');
  const shrunk = updateTreeSelection(extended.ids, visible, 'part', extended.anchorId, { shiftKey: true });
  assert.deepEqual([...shrunk.ids], ['b', 'part']);
  assert.equal(shrunk.anchorId, 'b');
  assert.deepEqual([...updateTreeSelection(shrunk.ids, visible, 'a', shrunk.anchorId, { shiftKey: true }).ids], ['a', 'group', 'b']);
});

test('Ctrl/Cmd+Shift adds a range without toggling existing selected rows', () => {
  for (const modifiers of [{ ctrlKey: true }, { metaKey: true }]) {
    assert.deepEqual([...updateTreeSelection(['a', 'part'], visible, 'dimension', 'part', { ...modifiers, shiftKey: true }).ids], ['a', 'part', 'c', 'dimension']);
  }
});

test('collapsed or deleted anchors fall back to a visible selected row or the target', () => {
  assert.deepEqual([...updateTreeSelection(['hidden-child', 'b'], visible, 'c', 'hidden-child', { shiftKey: true }).ids], ['b', 'part', 'c']);
  assert.deepEqual([...updateTreeSelection(['hidden-child'], visible, 'c', 'hidden-child', { shiftKey: true }).ids], ['c']);
  assert.deepEqual([...updateTreeSelection([], visible, 'c', null, { shiftKey: true }).ids], ['c']);
});
