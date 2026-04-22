import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  getChromeExecutableCandidates,
  getRealUserDataDir,
  normalizeChannel,
} from '../scripts/lib/platform-paths.mjs';

test('normalizeChannel defaults to stable', () => {
  assert.equal(normalizeChannel(), 'stable');
});

test('getRealUserDataDir returns the default Windows stable path', () => {
  assert.equal(
    getRealUserDataDir({
      platform: 'win32',
      homeDir: 'C:\\Users\\demo',
      localAppData: 'C:\\Users\\demo\\AppData\\Local',
      channel: 'stable',
    }),
    path.join('C:\\Users\\demo\\AppData\\Local', 'Google', 'Chrome', 'User Data'),
  );
});

test('getRealUserDataDir honors an override', () => {
  assert.equal(
    getRealUserDataDir({
      platform: 'linux',
      homeDir: '/home/demo',
      override: '/tmp/custom-profile',
      channel: 'stable',
    }),
    '/tmp/custom-profile',
  );
});

test('getChromeExecutableCandidates returns the macOS stable app path', () => {
  const candidates = getChromeExecutableCandidates({
    platform: 'darwin',
    homeDir: '/Users/demo',
    channel: 'stable',
  });

  assert.equal(
    candidates[0],
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  );
});
