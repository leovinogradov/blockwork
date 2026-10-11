/** Browser names omit the source extension; exports add it at the boundary. */
export function fileName(value: string): string {
  const name = value.trim().replace(/\.(m?js|txt)$/i, '').trim();
  if (!name || /[\\/\x00-\x1f]/.test(name) || name === '.' || name === '..') {
    throw new Error('Enter a name without folders.');
  }
  return name;
}

export function nameKey(value: string): string { return fileName(value).toLowerCase(); }

export function uniqueFileName(value: string, names: string[]): string {
  const base = fileName(value);
  const used = new Set(names.map(nameKey));
  let name = base;
  for (let number = 2; used.has(nameKey(name)); number++) name = `${base} ${number}`;
  return name;
}
