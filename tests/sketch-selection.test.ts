import test from 'node:test';
import assert from 'node:assert/strict';
import { createSketchSelectionCycle, sketchShapesAtPoint, sketchShapesInBox, updateSketchSelection } from '../src/sketch-selection';
import type { SketchShape } from '../src/sketch';

test('click selection replaces, toggles, and adds without mutating the previous selection', () => {
  const current = new Set(['a', 'b']);
  assert.deepEqual([...updateSketchSelection(current, ['c'], 'replace')], ['c']);
  assert.deepEqual([...updateSketchSelection(current, ['b', 'c', 'c'], 'toggle')], ['a', 'c']);
  assert.deepEqual([...updateSketchSelection(current, ['b', 'c'], 'add')], ['a', 'b', 'c']);
  assert.deepEqual([...updateSketchSelection(current, [], 'replace')], []);
  assert.deepEqual([...updateSketchSelection(current, [], 'toggle')], ['a', 'b']);
  assert.deepEqual([...current], ['a', 'b']);
});

const shapes: SketchShape[] = [
  { id: 'rectangle', name: 'Rectangle', size: [4, 3], position: [2, 2], color: '#fff' },
  { id: 'diagonal', name: 'Diagonal', kind: 'line', size: [-10, -10], position: [10, 10], color: '#fff' },
  { id: 'horizontal', name: 'Horizontal', kind: 'line', size: [10, 0], position: [0, 8], color: '#fff' },
  { id: 'vertical', name: 'Vertical', kind: 'line', size: [0, -10], position: [8, 10], color: '#fff' },
];
const project = (point: [number, number]): [number, number] => [point[0] * 10 + 100, 200 - point[1] * 10];

test('marquee selects intersecting rectangles and signed lines in either drag direction', () => {
  const first: [number, number] = [130, 160], opposite: [number, number] = [140, 170];
  assert.deepEqual(sketchShapesInBox(shapes, first, opposite, project, new Set()), ['rectangle', 'diagonal']);
  assert.deepEqual(sketchShapesInBox(shapes, opposite, first, project, new Set(['rectangle'])), ['diagonal']);
});

test('marquee checks line segments, not just their bounding boxes', () => {
  assert.deepEqual(sketchShapesInBox(shapes, [110, 110], [120, 120], project, new Set()), ['horizontal']);
  assert.deepEqual(sketchShapesInBox(shapes, [180, 100], [190, 110], project, new Set(['diagonal'])), ['vertical']);
  assert.deepEqual(sketchShapesInBox(shapes, [300, 300], [310, 310], project, new Set()), []);
});

const identity = (point: [number, number]) => point;
const rectangle = (id: string, position: [number, number], size: [number, number]): SketchShape => ({ id, name: id, position, size, color: '#fff' });

test('clicks rank only overlapping shapes by center distance, regardless of size or source order', () => {
  const overlapping = [rectangle('large', [0, 0], [20, 20]), rectangle('small', [1, 1], [4, 4]), rectangle('outside', [4, 4], [1, 1])];
  assert.deepEqual(sketchShapesAtPoint(overlapping, [3, 3], identity, new Set()), ['small', 'large']);
  assert.deepEqual(sketchShapesAtPoint([...overlapping].reverse(), [3, 3], identity, new Set()), ['small', 'large']);
  assert.deepEqual(sketchShapesAtPoint(overlapping, [3, 3], identity, new Set(['small'])), ['large']);
  assert.deepEqual(sketchShapesAtPoint(overlapping, [30, 30], identity, new Set()), []);
  // A small rectangle's far edge can lose to the center of a larger rectangle.
  assert.deepEqual(sketchShapesAtPoint([rectangle('small', [0, 0], [4, 4]), rectangle('large', [0, 0], [8, 8])], [4, 4], identity, new Set()), ['large', 'small']);
});

test('circle clicks use the curved boundary and text clicks use the top-left anchored bounds', () => {
  const circle: SketchShape = { ...rectangle('circle', [0, 0], [4, 4]), kind: 'circle' };
  const text: SketchShape = { ...rectangle('text', [0, 4], [4, 2]), kind: 'text', text: 'A', textHeight: 1 };
  assert.deepEqual(sketchShapesAtPoint([circle, text], [0.1, 3.9], identity, new Set()), ['text']);
  assert.deepEqual(sketchShapesAtPoint([circle, text], [2, 2], identity, new Set()), ['circle', 'text']);
  assert.deepEqual(sketchShapesAtPoint([text], [2, 5], identity, new Set()), []);
});

test('signed lines use a fixed pixel tolerance and rank by midpoint alongside other shapes', () => {
  const line: SketchShape = { ...rectangle('line', [10, 10], [-10, -10]), kind: 'line' };
  const box = rectangle('box', [0, 0], [2, 2]);
  assert.deepEqual(sketchShapesAtPoint([line, box], project([1, 1]), project, new Set()), ['box', 'line']);
  assert.deepEqual(sketchShapesAtPoint([line], project([5, 5]), project, new Set()), ['line']);
  assert.deepEqual(sketchShapesAtPoint([line], project([0, 10]), project, new Set()), []);
  const horizontal: SketchShape = { ...box, id: 'horizontal', kind: 'line', size: [10, 0] };
  assert.deepEqual(sketchShapesAtPoint([horizontal], [150, 210], project, new Set()), ['horizontal']);
  assert.deepEqual(sketchShapesAtPoint([horizontal], [150, 211], project, new Set()), []);
});

test('equal centers have stable ordering and fully coincident shapes remain reachable', () => {
  const coincident = ['a', 'b', 'c'].map((id) => rectangle(id, [0, 0], [4, 4]));
  const hits = sketchShapesAtPoint(coincident, [2, 2], identity, new Set());
  const cycle = createSketchSelectionCycle();
  assert.deepEqual(hits, ['a', 'b', 'c']);
  assert.deepEqual(Array.from({ length: 5 }, () => cycle.next([2, 2], hits)), ['a', 'b', 'c', 'a', 'b']);
});

test('cycling tolerates click jitter without reordering candidates', () => {
  const cycle = createSketchSelectionCycle();
  assert.equal(cycle.next([100, 100], ['a', 'b', 'c']), 'a');
  cycle.move([102, 101]);
  assert.equal(cycle.next([102, 101], ['c', 'b', 'a']), 'b');
  assert.equal(cycle.next([101, 100], ['b', 'c', 'a']), 'c');
  // Compare to the first click, not the previous click, to prevent gradual drift.
  assert.equal(cycle.next([105, 100], ['c', 'b', 'a']), 'c');
  assert.equal(cycle.next([105, 100], ['c', 'b', 'a']), 'b');
});

test('moving away and back, candidate changes, empty clicks, and explicit resets restart cycling', () => {
  const cycle = createSketchSelectionCycle();
  const next = (ids = ['a', 'b']) => cycle.next([100, 100], ids);
  assert.equal(next(), 'a');
  assert.equal(next(), 'b');
  cycle.move([110, 100]); cycle.move([100, 100]);
  assert.equal(next(), 'a');
  assert.equal(next(['a', 'c']), 'a');
  assert.equal(next(['c']), 'c');
  assert.equal(next([]), null);
  assert.equal(next(), 'a');
  cycle.reset();
  assert.equal(next(), 'a');
});
