/** Bind an accessible export dropdown without knowing about export formats. */
export function bindExportMenu(trigger: HTMLButtonElement, menu: HTMLElement) {
  const items = () => Array.from(menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')).filter((item) => !item.disabled);
  const close = (restoreFocus = false) => {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  };
  const open = (last = false) => {
    if (trigger.disabled) return;
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    const enabled = items();
    (last ? enabled.at(-1) : enabled[0])?.focus();
  };
  trigger.addEventListener('click', () => { if (menu.hidden) open(); else close(true); });
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); open(event.key === 'ArrowUp');
    }
  });
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); close(true); return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const enabled = items();
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
    enabled[next]?.focus();
  });
  menu.addEventListener('click', (event) => {
    const item = (event.target as Element).closest<HTMLButtonElement>('button[role="menuitem"]');
    // The selected action may disable itself before this click bubbles here.
    if (item) close(true);
  });
  document.addEventListener('pointerdown', (event) => {
    const target = event.target as Node;
    if (!menu.hidden && !menu.contains(target) && !trigger.contains(target)) close();
  });
  document.addEventListener('focusin', (event) => {
    const target = event.target as Node;
    if (!menu.hidden && !menu.contains(target) && !trigger.contains(target)) close();
  });
  return { close };
}
