import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';
import { attachInstruction, extractInstruction } from '@atlaskit/pragmatic-drag-and-drop-hitbox/list-item';
import type { TreeDrop } from './component-tree';

/** Wire browser drag behaviour separately from the tree's model and undo state. */
export function bindTreeDrag({ element, canEdit, canMove, onMove, rowSelector = '[data-tree-id]', handleSelector = '.component-select', isContainer = (row) => row.classList.contains('group-row'), rootTargets }: {
  element: HTMLElement;
  canEdit: () => boolean;
  canMove: (id: string, drop: TreeDrop) => boolean;
  onMove: (id: string, drop: TreeDrop) => void;
  rowSelector?: string;
  handleSelector?: string;
  isContainer?: (row: HTMLElement) => boolean;
  rootTargets?: { element: HTMLElement; targetId?: string }[];
}) {
  if (!canEdit()) return () => {};
  const cleanups: (() => void)[] = [];
  const ownsDrag = (data: Record<string, unknown>) => data.tree === element && typeof data.id === 'string';
  const roots = rootTargets ?? [{ element: element.querySelector<HTMLElement>('[data-tree-root]')! }];
  const clearIndicators = () => {
    element.querySelectorAll<HTMLElement>('.tree-drop-before,.tree-drop-after,.tree-drop-inside').forEach((row) => row.classList.remove('tree-drop-before', 'tree-drop-after', 'tree-drop-inside'));
    for (const root of roots) root.element.classList.remove('tree-drop-inside');
  };
  const clearDrag = () => {
    clearIndicators();
    element.classList.remove('tree-drag-active');
    element.querySelectorAll('.tree-dragging').forEach((row) => row.classList.remove('tree-dragging'));
  };
  for (const row of element.querySelectorAll<HTMLElement>(rowSelector)) {
    const id = row.dataset.treeId!;
    const availability = (sourceId: string, placement: TreeDrop['placement']) => canMove(sourceId, { targetId: id, placement }) ? 'available' as const : 'blocked' as const;
    cleanups.push(combine(
      draggable({
        element: row,
        dragHandle: row.querySelector(handleSelector)!,
        canDrag: () => canEdit(),
        getInitialData: () => ({ tree: element, id }),
        onDragStart: () => { element.classList.add('tree-drag-active'); row.classList.add('tree-dragging'); },
      }),
      dropTargetForElements({
        element: row,
        canDrop: ({ source }) => canEdit() && ownsDrag(source.data) && source.data.id !== id,
        getData: ({ source, input }) => attachInstruction({ id }, {
          element: row, input,
          operations: {
            'reorder-before': availability(source.data.id as string, 'before'),
            'reorder-after': availability(source.data.id as string, 'after'),
            combine: isContainer(row) ? availability(source.data.id as string, 'inside') : 'not-available',
          },
        }),
      }),
    ));
  }
  for (const root of roots) cleanups.push(dropTargetForElements({
    element: root.element,
    canDrop: ({ source }) => canEdit() && ownsDrag(source.data) && canMove(source.data.id as string, { targetId: root.targetId, placement: 'inside' }),
    getData: () => ({ root: true, id: root.targetId }),
  }));
  const showIndicator = (data: Record<string, unknown>, target: Element) => {
    clearIndicators();
    if (data.root && target instanceof HTMLElement) { target.classList.add('tree-drop-inside'); return; }
    const instruction = extractInstruction(data);
    if (!instruction || instruction.blocked || !(target instanceof HTMLElement)) return;
    if (instruction.operation === 'combine') { target.classList.add('tree-drop-inside'); return; }
    const after = instruction.operation === 'reorder-after';
    let indicator = target;
    // An expanded group moves with its whole branch; draw "after" below its children.
    if (after && isContainer(target)) {
      const depth = Number(target.style.getPropertyValue('--tree-depth'));
      let next = target.nextElementSibling;
      while (next instanceof HTMLElement && next.dataset.treeId && Number(next.style.getPropertyValue('--tree-depth')) > depth) {
        indicator = next; next = next.nextElementSibling;
      }
    }
    indicator.style.setProperty('--drop-depth', target.style.getPropertyValue('--tree-depth'));
    indicator.classList.add(after ? 'tree-drop-after' : 'tree-drop-before');
  };
  cleanups.push(monitorForElements({
    canMonitor: ({ source }) => ownsDrag(source.data),
    onDrag: ({ location }) => {
      const target = location.current.dropTargets[0];
      if (target) showIndicator(target.data, target.element); else clearIndicators();
    },
    onDropTargetChange: ({ location }) => {
      const target = location.current.dropTargets[0];
      if (target) showIndicator(target.data, target.element); else clearIndicators();
    },
    onDrop: ({ source, location }) => {
      clearDrag();
      const target = location.current.dropTargets[0];
      if (!target || !canEdit()) return;
      if (target.data.root) { onMove(source.data.id as string, { targetId: target.data.id as string | undefined, placement: 'inside' }); return; }
      const instruction = extractInstruction(target.data);
      if (!instruction || instruction.blocked) return;
      onMove(source.data.id as string, { targetId: target.data.id as string, placement: instruction.operation === 'combine' ? 'inside' : instruction.operation === 'reorder-before' ? 'before' : 'after' });
    },
  }), autoScrollForElements({
    element,
    canScroll: ({ source }) => canEdit() && ownsDrag(source.data),
    getAllowedAxis: () => 'vertical',
  }));
  return () => { combine(...cleanups)(); clearDrag(); };
}

/** Existing component-tree defaults share the same drag engine as the file library. */
export const bindComponentTreeDrag = bindTreeDrag;
