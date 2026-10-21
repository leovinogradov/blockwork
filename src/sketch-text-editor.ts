import type { SketchTextShape } from './sketch';
import { textLayout } from './sketch-text';

/** A textarea in model space: typing changes the bounds, never the letter size. */
export function createSketchTextEditor(
  host: HTMLElement,
  project: (point: [number, number]) => [number, number],
  onFinish: (shape: SketchTextShape, text: string) => void,
  onVisibility: (id: string, editing: boolean) => void,
) {
  const input = document.createElement('textarea');
  input.className = 'sketch-inline-text';
  input.setAttribute('aria-label', 'Edit drawing text');
  input.setAttribute('wrap', 'off');
  input.setAttribute('spellcheck', 'false');
  input.maxLength = 4000;
  input.hidden = true;
  host.append(input);
  const context = document.createElement('canvas').getContext('2d')!;
  let active: SketchTextShape | null = null;
  let letterHeight = 1;
  let cachedText: string | undefined;
  let cachedLayout: ReturnType<typeof textLayout>;

  const update = () => {
    if (!active) return;
    const anchor = active.position;
    const [x, y] = project(anchor);
    const [, unitY] = project([anchor[0], anchor[1] + 1]);
    const pixelsPerInch = Math.abs(unitY - y);
    if (cachedText !== input.value) { cachedText = input.value; cachedLayout = textLayout(input.value, context, false); }
    const layout = cachedLayout;
    const scale = letterHeight * pixelsPerInch / layout.referenceHeight;
    Object.assign(input.style, {
      left: `${x - 1}px`, top: `${y + (layout.ascent - layout.cssBaseline) * scale - 1}px`,
      width: `${Math.max(24, layout.width * scale + 2)}px`,
      height: `${(layout.lines.length * layout.lineHeight + 4) * scale + 2}px`,
      fontSize: `${100 * scale}px`, lineHeight: `${layout.lineHeight * scale}px`,
      padding: `${2 * scale}px ${2 * scale}px ${2 * scale}px ${(2 + layout.left) * scale}px`,
      color: active.color,
    });
  };
  const finish = (cancel = false) => {
    if (!active) return;
    const shape = active, text = input.value;
    active = null;
    input.hidden = true;
    onVisibility(shape.id, false);
    if (!cancel && text !== shape.text) onFinish(shape, text);
  };
  input.addEventListener('input', update);
  input.addEventListener('blur', () => finish());
  input.addEventListener('pointerdown', (event) => event.stopPropagation());
  input.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { finish(); return; }
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); finish(true); }
    else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); finish(); }
  });
  return {
    get activeId() { return active?.id; },
    start(shape: SketchTextShape, selectAll = false) {
      finish();
      active = structuredClone(shape);
      letterHeight = shape.textHeight;
      input.value = shape.text!;
      input.hidden = false;
      onVisibility(shape.id, true);
      update();
      input.focus({ preventScroll: true });
      if (selectAll) input.select();
      else input.setSelectionRange(input.value.length, input.value.length);
    },
    update,
    finish,
    dispose() { finish(true); input.remove(); },
  };
}
