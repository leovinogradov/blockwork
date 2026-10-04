import type { ModelDocument } from './documents';

export type SaveFileHandle = {
  name: string;
  createWritable(): Promise<{ write(source: string): Promise<void>; close(): Promise<void> }>;
};
export type SaveFilePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
  excludeAcceptAllOption: boolean;
}) => Promise<SaveFileHandle>;

export function javascriptFilename(value: string): string {
  const name = value.trim();
  if (!name || /[\\/\x00-\x1f]/.test(name) || name === '.' || name === '..') {
    throw new Error('Enter a filename without folders.');
  }
  return name.replace(/\.(m?js|txt)$/i, '') + '.js';
}

/** Adopt the native picker's filename only after its write succeeds. */
export async function saveDocumentFile(modelDocument: ModelDocument, options: {
  pickFile?: SaveFilePicker;
  download(source: string, filename: string): void;
}): Promise<'saved' | 'downloaded' | null> {
  const source = modelDocument.source;
  const suggestedName = javascriptFilename(modelDocument.name);
  try {
    if (options.pickFile) {
      const handle = await options.pickFile({
        suggestedName,
        types: [{ description: 'JavaScript source', accept: { 'text/javascript': ['.js'] } }],
        excludeAcceptAllOption: true,
      });
      const writable = await handle.createWritable();
      await writable.write(source);
      await writable.close();
      modelDocument.name = handle.name;
      return 'saved';
    }
    // Ordinary downloads expose no final filename to the app.
    options.download(source, suggestedName);
    return 'downloaded';
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return null;
    throw error;
  }
}
