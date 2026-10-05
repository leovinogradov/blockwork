type Panel = 'sidebar' | 'inspector';
type Widths = Record<Panel, number>;

const STORAGE_KEY = 'blockwork.panel-widths.v1';
const MIN_WIDTHS: Widths = { sidebar: 180, inspector: 220 };

export function bindPanelResize(workspace: HTMLElement) {
  const mobile = window.matchMedia('(max-width: 760px)');
  const handles = Array.from(workspace.querySelectorAll<HTMLElement>('[data-resize-panel]'));
  let preferred: Partial<Widths> = {};
  let widths: Widths = { sidebar: 220, inspector: 265 };
  let available = 0;
  let drag: { handle: HTMLElement; panel: Panel; pointerId: number; x: number; width: number } | null = null;

  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (saved && typeof saved === 'object') {
      for (const panel of ['sidebar', 'inspector'] as const) {
        const width = (saved as Partial<Widths>)[panel];
        if (typeof width === 'number' && Number.isFinite(width) && width >= MIN_WIDTHS[panel]) preferred[panel] = width;
      }
    }
  } catch { /* Use defaults when local storage is unavailable or invalid. */ }

  const save = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferred)); }
    catch { /* Resizing also works without persistent storage. */ }
  };

  const otherPanel = (panel: Panel): Panel => panel === 'sidebar' ? 'inspector' : 'sidebar';
  const maximum = (panel: Panel) => available - widths[otherPanel(panel)];

  const refresh = () => {
    if (mobile.matches) return;
    const style = getComputedStyle(workspace);
    available = workspace.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      - 2 * parseFloat(style.getPropertyValue('--panel-divider-width'))
      - parseFloat(style.getPropertyValue('--stage-min-width'));
    widths = {
      sidebar: Math.max(MIN_WIDTHS.sidebar, preferred.sidebar ?? parseFloat(style.getPropertyValue('--sidebar-default-width'))),
      inspector: Math.max(MIN_WIDTHS.inspector, preferred.inspector ?? parseFloat(style.getPropertyValue('--inspector-default-width'))),
    };
    // Shrink both sides proportionally when the window cannot fit the preferred widths.
    const extra = widths.sidebar + widths.inspector - MIN_WIDTHS.sidebar - MIN_WIDTHS.inspector;
    const room = Math.max(0, available - MIN_WIDTHS.sidebar - MIN_WIDTHS.inspector);
    if (extra > room) {
      for (const panel of ['sidebar', 'inspector'] as const) {
        widths[panel] = MIN_WIDTHS[panel] + (widths[panel] - MIN_WIDTHS[panel]) * room / extra;
      }
    }
    for (const handle of handles) {
      const panel = handle.dataset.resizePanel as Panel;
      workspace.style.setProperty(`--${panel}-width`, `${widths[panel]}px`);
      handle.setAttribute('aria-valuemin', String(MIN_WIDTHS[panel]));
      handle.setAttribute('aria-valuemax', String(Math.round(maximum(panel))));
      handle.setAttribute('aria-valuenow', String(Math.round(widths[panel])));
      handle.setAttribute('aria-valuetext', `${Math.round(widths[panel])} pixels wide`);
    }
  };

  const resize = (panel: Panel, width: number) => {
    // Keep the opposite panel in place while dragging this divider.
    preferred = { ...widths, [panel]: Math.min(maximum(panel), Math.max(MIN_WIDTHS[panel], width)) };
    refresh();
  };

  const finish = () => {
    if (!drag) return;
    const { handle, pointerId } = drag;
    drag = null;
    handle.classList.remove('is-resizing');
    document.body.classList.remove('is-resizing-panels');
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    save();
  };

  for (const handle of handles) {
    const panel = handle.dataset.resizePanel as Panel;
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || mobile.matches || drag) return;
      event.preventDefault();
      refresh();
      drag = { handle, panel, pointerId: event.pointerId, x: event.clientX, width: widths[panel] };
      handle.focus();
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('is-resizing');
      document.body.classList.add('is-resizing-panels');
    });
    handle.addEventListener('pointermove', (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const delta = (event.clientX - drag.x) * (drag.panel === 'sidebar' ? 1 : -1);
      resize(drag.panel, drag.width + delta);
    });
    handle.addEventListener('pointerup', (event) => { if (drag?.pointerId === event.pointerId) finish(); });
    handle.addEventListener('pointercancel', (event) => { if (drag?.pointerId === event.pointerId) finish(); });
    handle.addEventListener('lostpointercapture', finish);
    handle.addEventListener('dblclick', () => {
      delete preferred[panel];
      refresh();
      save();
    });
    handle.addEventListener('keydown', (event) => {
      if (mobile.matches || event.ctrlKey || event.metaKey || event.altKey) return;
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      refresh();
      if (event.key === 'Enter') {
        delete preferred[panel];
        refresh();
      } else if (event.key === 'Home') resize(panel, MIN_WIDTHS[panel]);
      else if (event.key === 'End') resize(panel, maximum(panel));
      else {
        const direction = (event.key === 'ArrowRight' ? 1 : -1) * (panel === 'sidebar' ? 1 : -1);
        resize(panel, widths[panel] + direction * (event.shiftKey ? 40 : 10));
      }
      save();
    });
  }

  new ResizeObserver(refresh).observe(workspace);
  mobile.addEventListener('change', () => { finish(); refresh(); });
  refresh();
}
