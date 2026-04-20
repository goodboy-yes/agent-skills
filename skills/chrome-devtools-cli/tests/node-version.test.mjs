import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertSupportedNodeVersion,
  isSupportedNodeVersion,
  parseNodeVersion,
} from '../scripts/lib/node-version.mjs';

test('parseNodeVersion parses versions with a v prefix', () => {
  assert.deepEqual(parseNodeVersion('v20.19.1'), {
    major: 20,
    minor: 19,
    patch: 1,
  });
});

test('isSupportedNodeVersion accepts 20.19+ only', () => {
  assert.equal(isSupportedNodeVersion({ major: 20, minor: 19, patch: 0 }), true);
  assert.equal(isSupportedNodeVersion({ major: 20, minor: 18, patch: 9 }), false);
});

test('isSupportedNodeVersion accepts 22.12+ and 23+', () => {
  assert.equal(isSupportedNodeVersion({ major: 22, minor: 12, patch: 0 }), true);
  assert.equal(isSupportedNodeVersion({ major: 22, minor: 11, patch: 9 }), false);
  assert.equal(isSupportedNodeVersion({ major: 23, minor: 0, patch: 0 }), true);
});

test('assertSupportedNodeVersion throws a clear error for unsupported versions', () => {
  assert.throws(
    () => assertSupportedNodeVersion('v18.20.0'),
    /chrome-devtools-mcp requires Node \^20\.19\.0 \|\| \^22\.12\.0 \|\| >=23/,
  );
});
