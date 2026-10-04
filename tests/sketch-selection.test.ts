import test from 'node:test';
import assert from 'node:assert/strict';
import { sketchShapesInBox, updateSketchSelection } from '../src/sketch-selection';
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
