import { LibraryDataError, StorageConflictError } from './library-storage';

/** Keep browser exception names/messages, including DOMExceptions from another realm. */
export function storageErrorMessage(error: unknown): string {
  if (error instanceof LibraryDataError) return `${error.message} The saved library could not be loaded; this is a document-data error. Existing browser records have been left intact. Export any current work before reloading. Do not clear site data; it contains your saved files.`;
  if (error instanceof StorageConflictError) return error.message;
  const details = error !== null && typeof error === 'object' ? error as { name?: unknown; message?: unknown } : {};
  const name = typeof details.name === 'string' ? details.name : '';
  const message = typeof details.message === 'string' ? details.message : typeof error === 'string' ? error : '';
  const reason = [name && name !== 'Error' ? name : '', message].filter(Boolean).join(': ') || 'The browser did not provide an error reason.';
  const guidance = name === 'QuotaExceededError'
    ? 'Browser storage is full. Back up your library before freeing disk space or removing any site data.'
    : name === 'SecurityError' || name === 'NotAllowedError'
      ? 'Storage access was denied. Check this site’s cookies and site-data permissions (in Brave, check the Shields panel). If this is an embedded preview, open the app directly in a browser tab.'
      : name === 'VersionError'
        ? 'This library was created by a newer app version. Open the latest version of the app.'
        : 'The operation failed. The original error and operation details are logged in the browser console. Back up your work before reloading.';
  return `Local saving is unavailable. ${reason} ${guidance} Export files or use Files → Back up library to keep your current work.`;
}
