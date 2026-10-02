import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFaceColor } from '../src/face-color';

test('parses picker hex colors without losing alpha', () => {
  assert.deepEqual(parseFaceColor('#d9a76e80'), { color: '#d9a76e', opacity: 128 / 255 });
  assert.deepEqual(parseFaceColor('#1230'), { color: '#112233', opacity: 0 });
  assert.deepEqual(parseFaceColor('#abcdefFF'), { color: '#abcdef', opacity: 1 });
});

test('parses CSS alpha colors and preserves opaque colors', () => {
  assert.deepEqual(parseFaceColor('rgba(255, 0, 32, 0.25)'), { color: 'rgb(255, 0, 32)', opacity: 0.25 });
  assert.deepEqual(parseFaceColor('hsla(120, 40%, 50%, .5)'), { color: 'hsl(120, 40%, 50%)', opacity: 0.5 });
  assert.deepEqual(parseFaceColor('#d9a76e'), { color: '#d9a76e', opacity: 1 });
  assert.deepEqual(parseFaceColor('transparent'), { color: 0x8795a1, opacity: 0.2 });
});
