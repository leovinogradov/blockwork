export type WheelSample = Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY' | 'ctrlKey' | 'metaKey' | 'timeStamp'> & {
  wheelDelta?: number;
  wheelDeltaX?: number;
  wheelDeltaY?: number;
};

export type WheelDecision = { action: 'zoom' | 'orbit' | 'pending'; resolvePending?: boolean; restartPending?: boolean };
export const PENDING_WHEEL_MS = 75;
const SAMPLE_GAP_MS = 35;
const HISTORY_MS = 120;
const EPSILON = 0.01;

const nearMultiple = (value: number, step: number) => Math.abs(value) >= step
  && Math.abs(value / step - Math.round(value / step)) < EPSILON;
const quantizedPair = (a: number, b: number) => nearMultiple(Math.max(a, b), Math.min(a, b));

/** Mouse-first inference; no session-wide device choice or sticky orbit mode.
 * Clear mouse/pinch events bypass the short vertical history, so they can be
 * interleaved with a trackpad. Horizontal pixel motion is strong touchpad
 * evidence. Untagged vertical motion needs three rapidly varying samples.
 * See docs/navigation-input.md for thresholds, tradeoffs, and mixed inputs.
 */
export class WheelGestureClassifier {
  private vertical: { time: number; magnitude: number; direction: number }[] = [];

  reset() { this.vertical = []; }

  classify(event: WheelSample): WheelDecision {
    // Read units first: some browsers adapt delta getters after deltaMode access.
    const mode = event.deltaMode;
    const x = Math.abs(event.deltaX), y = Math.abs(event.deltaY);
    const time = event.timeStamp;
    this.vertical = this.vertical.filter((sample) => time >= sample.time && time - sample.time <= HISTORY_MS);
    if (event.ctrlKey || event.metaKey || mode !== 0) return { action: 'zoom' };
    const tick = y > EPSILON ? event.wheelDeltaY ?? event.wheelDelta : event.wheelDeltaX ?? event.wheelDelta;
    // Strong wheel signals win even during an ongoing trackpad gesture.
    if ((typeof tick === 'number' && nearMultiple(tick, 120))
      || nearMultiple(Math.max(x, y), 100) || nearMultiple(Math.max(x, y), 120)) return { action: 'zoom' };
    if (x > EPSILON) return { action: 'orbit' };
    if (!Number.isFinite(y) || y <= EPSILON) return { action: 'zoom' };
    const previous = this.vertical.at(-1);
    const direction = Math.sign(event.deltaY);
    const restartPending = previous !== undefined && (time - previous.time > SAMPLE_GAP_MS || previous.direction !== direction);
    if (restartPending) this.vertical = [];
    this.vertical.push({ time, magnitude: y, direction });
    this.vertical = this.vertical.slice(-3);
    if (this.vertical.length < 3) return { action: 'pending', restartPending };
    const [a, b, c] = this.vertical.map((sample) => sample.magnitude);
    // Fixed/repeated multiples are wheel evidence, including small fractional
    // high-resolution wheel steps. Fractional or small input alone proves nothing.
    if (quantizedPair(a, b) && quantizedPair(b, c)) return { action: 'zoom', resolvePending: true };
    const varying = !quantizedPair(a, b) && !quantizedPair(b, c)
      && Math.abs(a - b) / Math.max(a, b) >= 0.1
      && Math.abs(b - c) / Math.max(b, c) >= 0.1;
    return varying ? { action: 'orbit', resolvePending: true } : { action: 'pending' };
  }
}
