import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCliCommand,
  buildNpxCommand,
  formatCommandFailure,
  quoteShellArg,
} from '../scripts/lib/npx-command.mjs';

test('quoteShellArg leaves simple Windows arguments unchanged', () => {
  assert.equal(quoteShellArg('--version', { platform: 'win32' }), '--version');
});

test('quoteShellArg wraps Windows arguments that contain spaces', () => {
  assert.equal(
    quoteShellArg('C:\\Program Files\\Chrome', { platform: 'win32' }),
    '"C:\\Program Files\\Chrome"',
  );
});

test('buildCliCommand quotes a local executable path on Windows', () => {
  assert.equal(
    buildCliCommand('C:\\Program Files\\nodejs\\chrome-devtools.cmd', ['start', '--help'], {
      platform: 'win32',
    }),
    '"C:\\Program Files\\nodejs\\chrome-devtools.cmd" start --help',
  );
});

test('buildNpxCommand builds a shell-safe command line on Windows with a registry override', () => {
  assert.equal(
    buildNpxCommand(
      ['-y', '-p', 'chrome-devtools-mcp@latest', 'chrome-devtools', 'start', '--help'],
      {
        platform: 'win32',
        registry: 'https://registry.npmmirror.com/',
      },
    ),
    'npx --registry=https://registry.npmmirror.com/ -y -p chrome-devtools-mcp@latest chrome-devtools start --help',
  );
});

test('formatCommandFailure includes stderr when available', () => {
  const message = formatCommandFailure('npx -y chrome-devtools-mcp@latest --help', {
    stderr: 'npm error 502 Bad Gateway',
  });

  assert.match(message, /chrome-devtools-mcp@latest --help/);
  assert.match(message, /502 Bad Gateway/);
});
