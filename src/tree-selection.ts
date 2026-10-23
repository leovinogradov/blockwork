export type TreeSelectionModifiers = { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean };

/** File-browser selection uses the displayed order, never hidden descendants. */
export function updateTreeSelection(
  current: Iterable<string>, visibleIds: string[], id: string, anchorId: string | null,
  { shiftKey, ctrlKey, metaKey }: TreeSelectionModifiers = {},
) {
  const selected = new Set(current);
  const additive = ctrlKey || metaKey;
  const anchor = anchorId && visibleIds.includes(anchorId) ? anchorId
    : visibleIds.find((entry) => selected.has(entry)) ?? id;
  if (shiftKey) {
    const first = visibleIds.indexOf(anchor), last = visibleIds.indexOf(id);
    const range = first < 0 || last < 0 ? [id] : visibleIds.slice(Math.min(first, last), Math.max(first, last) + 1);
    return { ids: new Set([...(additive ? selected : []), ...range]), anchorId: anchor };
  }
  if (!additive) return { ids: new Set([id]), anchorId: id };
  if (selected.has(id)) selected.delete(id); else selected.add(id);
  return { ids: selected, anchorId: id };
}
