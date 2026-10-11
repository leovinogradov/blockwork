import type { ModelDocument } from './documents';
import { fileName } from './file-names';

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
  return fileName(value) + '.js';
}

/** Export a snapshot without renaming or linking the browser file. */
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
