import test from 'node:test';
import assert from 'node:assert/strict';
import { WheelGestureClassifier, type WheelSample } from '../src/wheel-gesture';

const sample = (timeStamp: number, fields: Partial<WheelSample> = {}): WheelSample => ({
  timeStamp, deltaMode: 0, deltaX: 0, deltaY: 0, ctrlKey: false, metaKey: false, ...fields,
});

test('horizontal movement identifies trackpad slides regardless of Shift or magnitude', () => {
  const classifier = new WheelGestureClassifier();
  for (const deltaX of [0.5, 5, 85, -2.5]) {
    assert.equal(classifier.classify(sample(0, { deltaX })).action, 'orbit');
  }
  assert.equal(classifier.classify(sample(0, { deltaX: 0.001, deltaY: 3 })).action, 'pending', 'tiny axis noise is insufficient');
});

test('clear mouse ticks and pinch always zoom, even between trackpad samples', () => {
  const classifier = new WheelGestureClassifier();
  classifier.classify(sample(0, { deltaX: 12, deltaY: 7 }));
  for (const fields of [
    { deltaY: 100 }, { deltaY: 120 }, { deltaX: 100 },
    { deltaX: 5, deltaY: 3, deltaMode: 1 }, { deltaY: 1, deltaMode: 2 },
    { deltaX: 5, deltaY: 3, wheelDeltaY: -120 },
    { deltaX: 5, deltaY: 3, ctrlKey: true }, { deltaY: 3, metaKey: true },
  ]) {
    assert.equal(classifier.classify(sample(5, fields)).action, 'zoom');
    assert.equal(classifier.classify(sample(6, { deltaX: 8, deltaY: 11 })).action, 'orbit');
  }
});

test('small and fractional input alone remains undecided; repeated smooth wheel steps favor zoom', () => {
  for (const deltas of [[0.4, 0.4, 0.4], [12.5, 12.5, 12.5], [4, 8, 16], [2, 2.01, 2]]) {
    const classifier = new WheelGestureClassifier();
    const decisions = deltas.map((deltaY, index) => classifier.classify(sample(index * 12, { deltaY })));
    assert.deepEqual(decisions.map((decision) => decision.action), ['pending', 'zoom', 'zoom']);
    assert.equal(decisions[1].resolvePending, true);
  }
});

test('vertical trackpad needs three dense varying samples; clear wheel events do not supply that evidence', () => {
  const classifier = new WheelGestureClassifier();
  assert.equal(classifier.classify(sample(0, { deltaY: 4.2 })).action, 'pending');
  assert.equal(classifier.classify(sample(12, { deltaY: 6.7 })).action, 'pending');
  assert.equal(classifier.classify(sample(16, { deltaY: 100 })).action, 'zoom');
  assert.equal(classifier.classify(sample(20, { deltaY: -3, wheelDeltaY: 120 })).action, 'zoom');
  assert.deepEqual(classifier.classify(sample(24, { deltaY: 9.1 })), { action: 'orbit', resolvePending: true });
});

test('slow inputs, reversals, and idle periods cannot borrow earlier trackpad confidence', () => {
  const classifier = new WheelGestureClassifier();
  classifier.classify(sample(0, { deltaY: 4.2 }));
  assert.equal(classifier.classify(sample(50, { deltaY: 6.7 })).restartPending, true);
  assert.equal(classifier.classify(sample(60, { deltaY: -9.1 })).restartPending, true);
  assert.equal(classifier.classify(sample(500, { deltaY: 12.5 })).action, 'pending');
  classifier.reset();
  assert.equal(classifier.classify(sample(510, { deltaY: 3 })).action, 'pending');
});

test('mouse wheel cadence resolves on the second tick and stays responsive through acceleration and reversals', () => {
  const classifier = new WheelGestureClassifier();
  assert.equal(classifier.classify(sample(0, { deltaY: 12.5 })).action, 'pending');
  assert.deepEqual(classifier.classify(sample(55, { deltaY: 12.5 })), { action: 'zoom', resolvePending: true });
  for (const [time, deltaY] of [[110, 18.1], [165, 27.3], [220, -8.7]]) {
    assert.equal(classifier.classify(sample(time, { deltaY })).action, 'zoom');
  }
  assert.equal(classifier.classify(sample(500, { deltaY: 4.2 })).action, 'pending', 'idle expires the wheel burst');
  assert.equal(classifier.classify(sample(512, { deltaY: 6.7 })).action, 'pending');
  assert.equal(classifier.classify(sample(524, { deltaY: 9.1 })).action, 'orbit');
});

test('fallback zoom avoids repeated waits, but horizontal input and cancellation clear its confidence', () => {
  const classifier = new WheelGestureClassifier();
  classifier.classify(sample(0, { deltaY: 2.5 }));
  classifier.settlePendingZoom();
  assert.equal(classifier.classify(sample(90, { deltaY: 3.7 })).action, 'zoom');
  assert.equal(classifier.classify(sample(100, { deltaX: 4, deltaY: 5 })).action, 'orbit');
  for (const [index, deltaY] of [4.2, 6.7, 9.1].entries()) {
    assert.equal(classifier.classify(sample(110 + index * 12, { deltaY })).action, index < 2 ? 'pending' : 'orbit');
  }
  classifier.settlePendingZoom(); classifier.reset();
  assert.equal(classifier.classify(sample(140, { deltaY: 2.5 })).action, 'pending');
});
