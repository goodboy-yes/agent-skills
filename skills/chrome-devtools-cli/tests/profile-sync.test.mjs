import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  shouldCopyProfilePath,
  syncProfileCopy,
} from '../scripts/lib/profile-sync.mjs';

test('shouldCopyProfilePath filters lock files and cache directories', () => {
  assert.equal(shouldCopyProfilePath('Default/Preferences'), true);
  assert.equal(shouldCopyProfilePath('DevToolsActivePort'), false);
  assert.equal(shouldCopyProfilePath('SingletonLock'), false);
  assert.equal(shouldCopyProfilePath('Default/Cache/index'), false);
  assert.equal(shouldCopyProfilePath('Default/Code Cache/js'), false);
});

test('syncProfileCopy copies normal files and skips DevToolsActivePort', async () => {
  const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'cdt-source-'));
  const targetDir = await mkdtemp(path.join(os.tmpdir(), 'cdt-target-'));

  await mkdir(path.join(sourceDir, 'Default'), { recursive: true });
  await writeFile(path.join(sourceDir, 'Default', 'Preferences'), '{"theme":"dark"}', 'utf8');
  await writeFile(
    path.join(sourceDir, 'DevToolsActivePort'),
    '9222\n/devtools/browser/demo\n',
    'utf8',
  );

  const result = await syncProfileCopy({
    sourceDir,
    targetDir,
  });

  assert.equal(result.ok, true);
  assert.equal(
    await readFile(path.join(targetDir, 'Default', 'Preferences'), 'utf8'),
    '{"theme":"dark"}',
  );
  await assert.rejects(() => readFile(path.join(targetDir, 'DevToolsActivePort'), 'utf8'));
});
