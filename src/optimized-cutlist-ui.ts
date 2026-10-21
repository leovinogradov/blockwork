import type { ModelDocument } from './documents';
import { formatInches, parseInches } from './model';
import { optimizeCutlist, validateCutlistRows, validatePanelSizes, validateSawKerf, type CutlistLayout, type PanelSize } from './optimized-cutlist';

/** Owns the optimizer UI; the application only supplies document lifecycle hooks. */
export function createOptimizedCutlistUI(root: HTMLElement, hooks: {
  save(): void;
  openSource(id: string): void;
  findSource(id: string): ModelDocument | undefined;
  hasPendingDraft?(): boolean;
  apply(layout: CutlistLayout, panels: PanelSize[], kerf: number): void;
}) {
  const tools = document.createElement('section');
  tools.className = 'cutlist-tools-section';
  tools.hidden = true;
  tools.setAttribute('aria-labelledby', 'cutlist-tools-title');
  tools.innerHTML = `<h2 id="cutlist-tools-title" class="eyebrow">Cutlist Tools</h2><button id="open-cutlist-optimizer" class="button button-run cutlist-optimize-button" type="button" aria-haspopup="dialog" aria-controls="optimized-cutlist-dialog">Optimize Cutlist</button>`;
  root.querySelector('#tools-panel')!.prepend(tools);
  const trigger = tools.querySelector<HTMLButtonElement>('button')!;
  const host = document.createElement('dialog');
  host.id = 'optimized-cutlist-dialog';
  host.className = 'variable-dialog optimized-cutlist-dialog';
  host.setAttribute('aria-labelledby', 'optimized-cutlist-title');
  host.setAttribute('aria-describedby', 'optimized-cutlist-description');
  root.append(host);
  let current: ModelDocument | undefined;
  const focusWidth = (row: Element | null = host) => {
    const input = row?.querySelector<HTMLInputElement>('[data-panel-width]');
    input?.focus(); input?.select();
  };
  const open = () => {
    if (!current?.optimizedCutlist || host.open) return;
    refreshRunState();
    host.showModal(); focusWidth();
  };
  trigger.addEventListener('click', open);
  host.addEventListener('close', () => { if (!tools.hidden) trigger.focus(); });
  const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const panelRow = (size: PanelSize, index: number) => `<div class="cutlist-panel-size">
    <div class="cutlist-panel-heading"><strong data-panel-number>Panel ${index + 1}</strong><button type="button" class="icon-button cutlist-remove-panel" data-remove-panel aria-label="Remove panel size ${index + 1}" title="Remove panel size">×</button></div>
    <div class="cutlist-panel-dimensions"><label>Width<span class="cutlist-dimension-input"><input data-panel-width aria-label="Panel ${index + 1} width in inches" value="${formatInches(size.width)}" inputmode="decimal" autocomplete="off" aria-describedby="cutlist-dimension-help cutlist-optimizer-error" required /><span>in</span></span></label>
    <span class="cutlist-dimension-times" aria-hidden="true">×</span>
    <label>Height<span class="cutlist-dimension-input"><input data-panel-height aria-label="Panel ${index + 1} height in inches" value="${formatInches(size.height)}" inputmode="decimal" autocomplete="off" aria-describedby="cutlist-dimension-help cutlist-optimizer-error" required /><span>in</span></span></label></div></div>`;
  const readField = (input: HTMLInputElement, label: string, validate: (value: number) => number, markInvalid = true) => {
    if (markInvalid) input.removeAttribute('aria-invalid');
    try { return validate(parseInches(input.value)); }
    catch (reason) {
      if (markInvalid) input.setAttribute('aria-invalid', 'true');
      throw new Error(`${label}: ${reason instanceof Error ? reason.message : 'Enter a valid dimension.'}`);
    }
  };
  const readPanels = (markInvalid = true) => validatePanelSizes(Array.from(host.querySelectorAll('.cutlist-panel-size')).map((row, index) => {
    const positive = (value: number) => { if (value <= 0) throw new Error('Enter a positive dimension.'); return value; };
    return {
      width: readField(row.querySelector<HTMLInputElement>('[data-panel-width]')!, `Panel ${index + 1} width`, positive, markInvalid),
      height: readField(row.querySelector<HTMLInputElement>('[data-panel-height]')!, `Panel ${index + 1} height`, positive, markInvalid),
    };
  }));
  const error = (message: string) => {
    const output = host.querySelector<HTMLElement>('[data-optimizer-error]')!;
    output.textContent = message; output.hidden = !message;
  };
  const readKerf = (markInvalid = true) => readField(host.querySelector<HTMLInputElement>('#cutlist-saw-kerf')!, 'Saw kerf', validateSawKerf, markInvalid);
  const readOptimizationInputs = (markInvalid = true) => {
    if (current?.kind !== 'sketch' || !current.optimizedCutlist) throw new Error('Choose an optimized cutlist document.');
    const panels = readPanels(markInvalid), kerf = readKerf(markInvalid);
    if (hooks.hasPendingDraft?.() ?? current.draftDirty) throw new Error('Run or discard the source draft before optimizing.');
    const rows = validateCutlistRows(current.optimizedCutlist.rows);
    return { panels, kerf, rows };
  };
  const refreshRunState = () => {
    const button = host.querySelector<HTMLButtonElement>('#run-cutlist-optimizer');
    if (!button) return;
    let reason = '';
    try { readOptimizationInputs(false); }
    catch (error) { reason = error instanceof Error ? error.message : 'Enter valid optimizer inputs.'; }
    button.disabled = !!reason;
    button.title = reason;
  };
  const refreshControls = () => {
    const rows = Array.from(host.querySelectorAll('.cutlist-panel-size'));
    rows.forEach((row, index) => {
      row.querySelector('[data-panel-number]')!.textContent = `Panel ${index + 1}`;
      row.querySelector('[data-panel-width]')!.setAttribute('aria-label', `Panel ${index + 1} width in inches`);
      row.querySelector('[data-panel-height]')!.setAttribute('aria-label', `Panel ${index + 1} height in inches`);
      const remove = row.querySelector<HTMLButtonElement>('[data-remove-panel]')!;
      remove.setAttribute('aria-label', `Remove panel size ${index + 1}`);
      remove.disabled = rows.length === 1;
      remove.hidden = rows.length === 1;
      remove.title = remove.disabled ? 'Keep at least one panel size' : 'Remove panel size';
    });
    host.querySelector<HTMLButtonElement>('[data-add-panel]')!.disabled = rows.length >= 20;
    refreshRunState();
  };
  const saveInputs = () => {
    try {
      const panels = readPanels(), kerf = readKerf();
      if (current?.optimizedCutlist) { Object.assign(current.optimizedCutlist, { panels, kerf }); hooks.save(); }
      error('');
    } catch (reason) { error(reason instanceof Error ? reason.message : 'Enter valid panel sizes.'); }
    refreshControls();
  };
  host.addEventListener('change', saveInputs);
  host.addEventListener('input', refreshRunState);
  host.addEventListener('click', (event) => {
    const target = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!target || target.disabled) return;
    if (target.hasAttribute('data-close-optimizer')) {
      host.close();
    } else if (target.hasAttribute('data-open-cutlist-source')) {
      host.close();
      if (current?.optimizedCutlist) hooks.openSource(current.optimizedCutlist.source.documentId);
    } else if (target.hasAttribute('data-add-panel')) {
      const list = host.querySelector<HTMLElement>('[data-panel-sizes]')!;
      if (list.children.length >= 20) return;
      list.insertAdjacentHTML('beforeend', panelRow({ width: 96, height: 48 }, list.children.length));
      saveInputs(); focusWidth(list.lastElementChild);
    } else if (target.hasAttribute('data-remove-panel')) {
      const row = target.closest('.cutlist-panel-size')!;
      const next = row.nextElementSibling ?? row.previousElementSibling;
      if (!next) return;
      row.remove(); saveInputs(); focusWidth(next);
    }
  });
  host.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!host.open || !current?.optimizedCutlist) return;
    try {
      const { panels, kerf, rows } = readOptimizationInputs();
      // Compute everything before replacing the previous drawing. Failures retain it.
      const layout = optimizeCutlist(rows, panels, kerf);
      hooks.apply(layout, panels, kerf);
      hooks.save();
      host.querySelector<HTMLElement>('[data-optimizer-summary]')!.textContent = `Last run: ${layout.panels.length} panel${layout.panels.length === 1 ? '' : 's'} · ${rows.length} pieces · ${(100 * layout.usedArea / layout.totalArea).toFixed(1)}% utilization`;
      error('');
      host.close();
    } catch (reason) {
      error(reason instanceof Error ? reason.message : 'Could not optimize the cutlist.');
      host.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();
      refreshRunState();
    }
  });
  return {
    load(doc: ModelDocument) {
      const opening = current?.id !== doc.id;
      if (opening && host.open) host.close();
      current = doc;
      const data = doc.optimizedCutlist;
      tools.hidden = !data;
      root.classList.toggle('optimized-cutlist-mode', !!data);
      if (!data) { host.replaceChildren(); return; }
      const source = hooks.findSource(data.source.documentId);
      const panels = Array.isArray(data.panels) ? data.panels : [];
      host.innerHTML = `<div class="cutlist-controls-heading"><div><h2 id="optimized-cutlist-title">Optimize Cutlist</h2><p id="optimized-cutlist-description">Set your panel sizes and saw kerf, then optimize.</p></div></div>
        <form id="cutlist-optimizer-form" class="cutlist-optimizer-form" novalidate><div class="optimized-cutlist-body">
          <section class="cutlist-settings" aria-labelledby="cutlist-panels-title"><div class="cutlist-section-heading"><h3 id="cutlist-panels-title">Panel sizes</h3><span class="cutlist-unit-label">INCHES</span></div>
            <p id="cutlist-dimension-help" class="cutlist-description">Unlimited stock. Decimals and fractions accepted.</p>
            <div data-panel-sizes>${panels.map(panelRow).join('')}</div><button type="button" class="button cutlist-add-panel" data-add-panel>＋ Add panel size</button>
            <section class="cutlist-kerf-settings" aria-labelledby="cutlist-kerf-title">
              <label class="cutlist-kerf-field" for="cutlist-saw-kerf"><span id="cutlist-kerf-title">Saw kerf</span><span class="cutlist-dimension-input"><input id="cutlist-saw-kerf" inputmode="decimal" autocomplete="off" value="${formatInches(data.kerf)}" aria-describedby="cutlist-kerf-help cutlist-optimizer-error" required /><span>in</span></span></label>
              <p id="cutlist-kerf-help" class="cutlist-description">Blade width removed per cut. Use 0 for none.</p>
            </section>
          </section><section class="cutlist-snapshot" aria-labelledby="cutlist-pieces-title"><div class="cutlist-section-heading"><h3 id="cutlist-pieces-title">Cutlist</h3><span class="cutlist-piece-count">${data.rows.length} pieces</span></div>
            <div class="cutlist-source-reference">Source: <button type="button" class="source-name-button" data-open-cutlist-source ${source ? '' : 'disabled'}>${escape(source?.name ?? data.source.name)}</button>${source ? '' : '<span> · source unavailable</span>'}</div>
            <div class="cutlist-table-scroll"><table class="cutlist-pieces"><caption>Saved snapshot · ${data.ignored.length} ignored · dimensions in inches</caption><thead><tr><th scope="col">#</th><th scope="col">Component</th><th scope="col">Length</th><th scope="col">Width</th></tr></thead><tbody>${data.rows.map((row, index) => `<tr><td>${index + 1}</td><td>${escape(row.name)}</td><td>${formatInches(row.length)}</td><td>${formatInches(row.width)}</td></tr>`).join('')}</tbody></table></div>
          </section></div><footer class="cutlist-modal-footer"><div class="cutlist-footer-status"><p id="cutlist-optimizer-error" data-optimizer-error class="dialog-error" role="alert" hidden></p><p data-optimizer-summary class="cutlist-summary" role="status" aria-live="polite">${doc.rectangles.length ? 'Optimizing again replaces the current drawing.' : 'Ready to create your panel layout.'}</p></div><div class="cutlist-modal-actions"><button type="button" class="button button-quiet" data-close-optimizer>Close</button><button id="run-cutlist-optimizer" type="submit" class="button button-run">Optimize Cutlist</button></div></footer></form>`;
      refreshControls();
      // Only prompt on file/tab open when there is no drawing yet.
      // Applying a layout reloads this same document and must not reopen the modal.
      if (opening && !doc.rectangles.length) open();
    },
  };
}
