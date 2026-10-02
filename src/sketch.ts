import { formatInches, parseInches } from './model';

export type RectangleSpec = {
  id: string;
  name: string;
  /** Width and height on the model's X/Y plane, in inches. */
  size: [number, number];
  /** Minimum X/Y corner in model coordinates, ready for later 3D placement. */
  position: [number, number];
  color: string;
};

/** Convert two sketch clicks into an axis-aligned rectangle in model X/Y coordinates. */
export function rectangleFromCorners(first: [number, number], opposite: [number, number], id: string, name: string, color: string): RectangleSpec {
  const size: [number, number] = [Math.abs(opposite[0] - first[0]), Math.abs(opposite[1] - first[1])];
  if (size.some((part) => part < 1 / 64)) throw new Error('Choose two different corners to draw a rectangle.');
  return validateRectangles([{ id, name, size, position: [Math.min(first[0], opposite[0]), Math.min(first[1], opposite[1])], color }])[0];
}

export function validateRectangles(input: unknown): RectangleSpec[] {
  if (!Array.isArray(input)) throw new Error('Sketch must be an array of rectangles.');
  if (input.length > 2000) throw new Error('A sketch can contain at most 2000 rectangles.');
  const ids = new Set<string>();
  return input.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Rectangle ${index + 1} must be an object.`);
    const raw = entry as Record<string, unknown>;
    if (typeof raw.id !== 'string' || !raw.id.trim()) throw new Error(`Rectangle ${index + 1} needs an ID.`);
    if (ids.has(raw.id)) throw new Error(`Duplicate rectangle ID: ${raw.id}`);
    ids.add(raw.id);
    if (typeof raw.name !== 'string' || !raw.name.trim()) throw new Error(`Rectangle ${raw.id} needs a name.`);
    if (typeof raw.color !== 'string' || !raw.color.trim()) throw new Error(`Rectangle ${raw.id} needs a color.`);
    const vector = (value: unknown, label: string): [number, number] => {
      if (!Array.isArray(value) || value.length !== 2) throw new Error(`Rectangle ${raw.id} ${label} must have two values.`);
      return value.map((part) => {
        if (typeof part !== 'number' && typeof part !== 'string') throw new Error(`Rectangle ${raw.id} ${label} values must be inches.`);
        return parseInches(part);
      }) as [number, number];
    };
    const size = vector(raw.size, 'size');
    if (size.some((part) => part <= 0)) throw new Error(`Rectangle ${raw.id} sizes must be positive.`);
    return { id: raw.id, name: raw.name, size, position: vector(raw.position ?? [0, 0], 'position'), color: raw.color };
  });
}

export function generateSketchSource(rectangles: RectangleSpec[]): string {
  const lines = ['// Draw rectangles on the X/Y plane. Dimensions are in inches.'];
  for (const rectangle of validateRectangles(rectangles)) {
    const vector = (values: [number, number]) => `[${values.map((value) => `inch(${JSON.stringify(formatInches(value))})`).join(', ')}]`;
    lines.push(`rectangle({ id: ${JSON.stringify(rectangle.id)}, name: ${JSON.stringify(rectangle.name)}, size: ${vector(rectangle.size)}, position: ${vector(rectangle.position)}, color: ${JSON.stringify(rectangle.color)} });`);
  }
  return `${lines.join('\n')}\n`;
}
