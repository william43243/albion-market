import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldCancelDownload } from '../lib/downloadLifecycle';

test('navigation does not cancel an in-progress model download', () => {
  assert.equal(shouldCancelDownload('screen-unmount'), false);
});

test('explicit user cancellation still cancels the model download', () => {
  assert.equal(shouldCancelDownload('explicit-cancel'), true);
});
