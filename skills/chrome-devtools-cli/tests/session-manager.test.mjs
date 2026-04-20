import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ensureBrowserSession,
  resolveChromeDevtoolsCliRunner,
  tryResolveLiveBrowserFromUserDataDir,
} from '../scripts/lib/session-manager.mjs';

test('resolveChromeDevtoolsCliRunner prefers a local CLI when it supports help and start help', async () => {
  const commands = [];
  const cliHelp = `chrome-devtools <command> [...args] --flags

Commands:
  chrome-devtools start  Start or restart chrome-devtools-mcp
  chrome-devtools stop   Stop chrome-devtools-mcp if any`;
  const startHelp = `chrome-devtools start

Start or restart chrome-devtools-mcp`;

  const runner = await resolveChromeDevtoolsCliRunner(
    {
      npmRegistry: 'https://registry.npmmirror.com/',
    },
    {
      findLocalChromeDevtoolsCli: async () => 'chrome-devtools',
      execCommand: async command => {
        commands.push(command);

        if (command === 'chrome-devtools start --help') {
          return { stdout: startHelp, stderr: '' };
        }

        return { stdout: cliHelp, stderr: '' };
      },
      ensureNpxAvailable: async () => {
        throw new Error('npx should not be checked when local CLI works');
      },
    },
  );

  assert.equal(runner.kind, 'local');
  assert.deepEqual(commands, [
    'chrome-devtools --help',
    'chrome-devtools --help',
    'chrome-devtools start --help',
  ]);
});

test('resolveChromeDevtoolsCliRunner falls back to npx with registry override when local CLI is missing', async () => {
  const commands = [];

  const runner = await resolveChromeDevtoolsCliRunner(
    {
      npmRegistry: 'https://registry.npmmirror.com/',
    },
    {
      findLocalChromeDevtoolsCli: async () => null,
      execCommand: async command => {
        commands.push(command);
        return { stdout: 'ok', stderr: '' };
      },
    },
  );

  assert.equal(runner.kind, 'npx');
  assert.deepEqual(commands, [
    'npx --version',
    'npx --registry=https://registry.npmmirror.com/ -y chrome-devtools-mcp@latest --help',
    'npx --registry=https://registry.npmmirror.com/ -y -p chrome-devtools-mcp@latest chrome-devtools --help',
    'npx --registry=https://registry.npmmirror.com/ -y -p chrome-devtools-mcp@latest chrome-devtools start --help',
  ]);
});

test('resolveChromeDevtoolsCliRunner uses npmmirror as the default npx registry', async () => {
  const commands = [];

  const runner = await resolveChromeDevtoolsCliRunner(
    {},
    {
      findLocalChromeDevtoolsCli: async () => null,
      execCommand: async command => {
        commands.push(command);
        return { stdout: 'ok', stderr: '' };
      },
    },
  );

  assert.equal(runner.kind, 'npx');
  assert.deepEqual(commands, [
    'npx --version',
    'npx --registry=https://registry.npmmirror.com/ -y chrome-devtools-mcp@latest --help',
    'npx --registry=https://registry.npmmirror.com/ -y -p chrome-devtools-mcp@latest chrome-devtools --help',
    'npx --registry=https://registry.npmmirror.com/ -y -p chrome-devtools-mcp@latest chrome-devtools start --help',
  ]);
});

test('resolveChromeDevtoolsCliRunner falls back to npx when local CLI cannot use start help', async () => {
  const commands = [];

  const runner = await resolveChromeDevtoolsCliRunner(
    {
      npmRegistry: 'https://registry.npmmirror.com/',
    },
    {
      findLocalChromeDevtoolsCli: async () => 'chrome-devtools-mcp',
      execCommand: async command => {
        commands.push(command);

        if (command === 'chrome-devtools-mcp start --help') {
          throw new Error('local CLI does not support start');
        }

        return { stdout: 'ok', stderr: '' };
      },
    },
  );

  assert.equal(runner.kind, 'npx');
  assert.deepEqual(commands, [
    'chrome-devtools-mcp --help',
    'chrome-devtools-mcp --help',
    'chrome-devtools-mcp start --help',
    'npx --version',
    'npx --registry=https://registry.npmmirror.com/ -y chrome-devtools-mcp@latest --help',
    'npx --registry=https://registry.npmmirror.com/ -y -p chrome-devtools-mcp@latest chrome-devtools --help',
    'npx --registry=https://registry.npmmirror.com/ -y -p chrome-devtools-mcp@latest chrome-devtools start --help',
  ]);
});

test('resolveChromeDevtoolsCliRunner falls back to npx when local command only prints root help', async () => {
  const commands = [];
  const rootHelp = `Options:
      --autoConnect  [boolean]
      --help         Show help  [boolean]`;

  const runner = await resolveChromeDevtoolsCliRunner(
    {
      npmRegistry: 'https://registry.npmmirror.com/',
    },
    {
      findLocalChromeDevtoolsCli: async () => 'chrome-devtools-mcp',
      execCommand: async command => {
        commands.push(command);

        if (command.startsWith('chrome-devtools-mcp')) {
          return { stdout: rootHelp, stderr: '' };
        }

        return { stdout: 'ok', stderr: '' };
      },
    },
  );

  assert.equal(runner.kind, 'npx');
  assert.deepEqual(commands, [
    'chrome-devtools-mcp --help',
    'chrome-devtools-mcp --help',
    'chrome-devtools-mcp start --help',
    'npx --version',
    'npx --registry=https://registry.npmmirror.com/ -y chrome-devtools-mcp@latest --help',
    'npx --registry=https://registry.npmmirror.com/ -y -p chrome-devtools-mcp@latest chrome-devtools --help',
    'npx --registry=https://registry.npmmirror.com/ -y -p chrome-devtools-mcp@latest chrome-devtools start --help',
  ]);
});

test('tryResolveLiveBrowserFromUserDataDir falls back to wsEndpoint when HTTP discovery fails', async () => {
  const result = await tryResolveLiveBrowserFromUserDataDir('/real-profile', {
    allowWsEndpointFallback: true,
    readDevToolsActivePortFn: async () => ({
      browserUrl: 'http://127.0.0.1:9222',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/demo',
    }),
    probeBrowserUrlFn: async () => {
      throw new Error('Browser probe failed with status 404');
    },
  });

  assert.deepEqual(result, {
    source: 'live',
    userDataDir: '/real-profile',
    browserUrl: 'http://127.0.0.1:9222',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/demo',
    transport: 'wsEndpoint',
    probeError: 'Browser probe failed with status 404',
  });
});

test('ensureBrowserSession uses wsEndpoint when live Chrome does not expose /json/version', async () => {
  const wsEndpoints = [];

  const result = await ensureBrowserSession(
    { channel: 'stable' },
    {
      processVersion: 'v22.12.0',
      realUserDataDir: '/real-profile',
      fallbackUserDataDir: '/fallback-profile',
      tryResolveLiveBrowser: async userDataDir =>
        userDataDir === '/real-profile'
          ? {
            browserUrl: 'http://127.0.0.1:9222',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/demo',
            transport: 'wsEndpoint',
          }
          : null,
      syncProfileCopy: async () => {
        throw new Error('sync should not be used');
      },
      findChromeExecutable: async () => '/path/to/chrome',
      findFreePort: async () => 9333,
      launchChromeDetached: async () => {
        throw new Error('fallback Chrome should not be launched');
      },
      waitForBrowserReady: async () => {
        throw new Error('fallback readiness should not be awaited');
      },
      resolveChromeDevtoolsCliRunner: async () => ({
        helpInfo: {
          startHelp: 'chrome-devtools start --wsEndpoint',
        },
        startCli: async () => {
          throw new Error('browserUrl transport should not be used');
        },
        startCliWithWsEndpoint: async wsEndpoint => {
          wsEndpoints.push(wsEndpoint);
          return { stdout: '', stderr: '' };
        },
        startCliAutoConnect: async () => {
          throw new Error('autoConnect transport should not be used');
        },
      }),
    },
  );

  assert.deepEqual(wsEndpoints, ['ws://127.0.0.1:9222/devtools/browser/demo']);
  assert.equal(result.mode, 'reuse-running');
  assert.equal(result.transport, 'wsEndpoint');
  assert.equal(result.browserUrl, 'http://127.0.0.1:9222');
  assert.equal(result.webSocketDebuggerUrl, 'ws://127.0.0.1:9222/devtools/browser/demo');
});

test('reuses a running real Chrome first', async () => {
  const execCalls = [];
  const result = await ensureBrowserSession(
    { channel: 'stable' },
    {
      processVersion: 'v22.12.0',
      ensureNpxAvailable: async () => {},
      learnHelpCommands: async () => {},
      realUserDataDir: '/real-profile',
      fallbackUserDataDir: '/fallback-profile',
      tryResolveLiveBrowser: async userDataDir =>
        userDataDir === '/real-profile'
          ? { browserUrl: 'http://127.0.0.1:9222', source: 'real' }
          : null,
      syncProfileCopy: async () => {
        throw new Error('sync should not be used');
      },
      findChromeExecutable: async () => '/path/to/chrome',
      findFreePort: async () => 9333,
      launchChromeDetached: async () => {
        throw new Error('fallback Chrome should not be launched');
      },
      waitForBrowserReady: async () => {
        throw new Error('fallback readiness should not be awaited');
      },
      startCli: async browserUrl => {
        execCalls.push(browserUrl);
      },
    },
  );

  assert.equal(result.mode, 'reuse-running');
  assert.deepEqual(execCalls, ['http://127.0.0.1:9222']);
});

test('reuses an existing fallback Chrome before launching a new one', async () => {
  const result = await ensureBrowserSession(
    { channel: 'stable' },
    {
      processVersion: 'v22.12.0',
      ensureNpxAvailable: async () => {},
      learnHelpCommands: async () => {},
      realUserDataDir: '/real-profile',
      fallbackUserDataDir: '/fallback-profile',
      tryResolveLiveBrowser: async userDataDir =>
        userDataDir === '/fallback-profile'
          ? { browserUrl: 'http://127.0.0.1:9444', source: 'fallback' }
          : null,
      syncProfileCopy: async () => ({ ok: true }),
      findChromeExecutable: async () => '/path/to/chrome',
      findFreePort: async () => 9333,
      launchChromeDetached: async () => {
        throw new Error('fallback Chrome should not be launched again');
      },
      waitForBrowserReady: async () => {
        throw new Error('fallback readiness should not be awaited');
      },
      startCli: async () => {},
    },
  );

  assert.equal(result.mode, 'reuse-fallback');
  assert.equal(result.browserUrl, 'http://127.0.0.1:9444');
});

test('launches fallback Chrome even when profile sync fails', async () => {
  let launched = false;
  const result = await ensureBrowserSession(
    { channel: 'stable' },
    {
      processVersion: 'v22.12.0',
      ensureNpxAvailable: async () => {},
      learnHelpCommands: async () => {},
      realUserDataDir: '/real-profile',
      fallbackUserDataDir: '/fallback-profile',
      tryResolveLiveBrowser: async () => null,
      syncProfileCopy: async () => ({ ok: false, error: 'busy profile' }),
      findChromeExecutable: async () => '/path/to/chrome',
      findFreePort: async () => 9555,
      launchChromeDetached: async () => {
        launched = true;
      },
      waitForBrowserReady: async () => ({
        browserUrl: 'http://127.0.0.1:9555',
      }),
      startCli: async () => {},
    },
  );

  assert.equal(launched, true);
  assert.equal(result.mode, 'launched-fallback');
  assert.equal(result.syncStatus, 'failed');
});
