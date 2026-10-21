import test from 'node:test';
import assert from 'node:assert/strict';
import { storageErrorMessage } from '../src/storage-errors';
import { LibraryDataError, StorageConflictError } from '../src/library-storage';

test('storage denial retains the browser exception and suggests site-specific checks', () => {
  const message = storageErrorMessage(new DOMException('Access is denied for this document.', 'SecurityError'));
  assert.match(message, /SecurityError: Access is denied for this document\./);
  assert.match(message, /Brave.*Shields/);
  assert.match(message, /embedded preview/);
  assert.match(message, /Back up library/);
});

test('full storage and newer databases have distinct recovery advice', () => {
  assert.match(storageErrorMessage({ name: 'QuotaExceededError', message: 'Disk full' }), /QuotaExceededError: Disk full.*Back up your library before freeing/);
  assert.match(storageErrorMessage(new DOMException('Too new', 'VersionError')), /newer app version/);
});

test('unexpected and missing rejection values still explain what to do', () => {
  assert.match(storageErrorMessage(new Error('Corrupt workspace')), /Corrupt workspace/);
  assert.match(storageErrorMessage('Database offline'), /Database offline/);
  assert.match(storageErrorMessage(undefined), /did not provide an error reason/);
  assert.doesNotMatch(storageErrorMessage(new Error('Text requires an explicit letter height in inches.')), /Shields|permissions|disk space/);
});

test('document-data errors name the saved file and retain their original validation cause', () => {
  const cause = new Error('Text requires an explicit letter height in inches.');
  const error = new LibraryDataError(`Could not open saved file “Optimized cutlist”: ${cause.message}`, cause);
  const message = storageErrorMessage(error);
  assert.match(message, /Optimized cutlist.*explicit letter height/);
  assert.match(message, /document-data error/);
  assert.doesNotMatch(message, /Shields|permissions|disk space/);
  assert.equal(error.cause, cause);
});

test('revision conflicts retain their specific recovery advice', () => {
  const error = new StorageConflictError('file');
  assert.equal(storageErrorMessage(error), error.message);
});
