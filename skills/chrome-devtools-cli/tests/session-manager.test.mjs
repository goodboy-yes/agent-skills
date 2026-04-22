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

test('resolveChromeDevtoolsCliRunner auto-installs latest CLI and retries local resolution when discovered local command is not usable', async () => {
  const commands = [];
  let phase = 'before-install';
  const rootHelp = `Options:
      --autoConnect  [boolean]
      --help         Show help  [boolean]`;
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
      findLocalChromeDevtoolsCli: async () =>
        phase === 'before-install' ? 'chrome-devtools-mcp' : 'chrome-devtools',
      execCommand: async command => {
        commands.push(command);

        if (command.startsWith('chrome-devtools-mcp')) {
          return { stdout: rootHelp, stderr: '' };
        }

        if (command === 'chrome-devtools start --help') {
          return { stdout: startHelp, stderr: '' };
        }

        return { stdout: cliHelp, stderr: '' };
      },
      installChromeDevtoolsCli: async ({ registry, packageSpec }) => {
        assert.equal(registry, 'https://registry.npmmirror.com/');
        assert.equal(packageSpec, 'chrome-devtools-mcp@latest');
        phase = 'after-install';
      },
      ensureNpxAvailable: async () => {
        throw new Error('npx should not be checked when install succeeds');
      },
    },
  );

  assert.equal(runner.kind, 'local');
  assert.deepEqual(commands, [
    'chrome-devtools-mcp --help',
    'chrome-devtools-mcp --help',
    'chrome-devtools-mcp start --help',
    'chrome-devtools --help',
    'chrome-devtools --help',
    'chrome-devtools start --help',
  ]);
});

test('resolveChromeDevtoolsCliRunner falls back to npx with registry override when auto-install is disabled and local CLI is missing', async () => {
  const commands = [];

  const runner = await resolveChromeDevtoolsCliRunner(
    {
      npmRegistry: 'https://registry.npmmirror.com/',
      allowAutoInstall: false,
    },
    {
      findLocalChromeDevtoolsCli: async () => null,
      execCommand: async command => {
        commands.push(command);
        return { stdout: 'ok', stderr: '' };
      },
      installChromeDevtoolsCli: async () => {
        throw new Error('auto-install should be disabled');
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
    {
      allowAutoInstall: false,
    },
    {
      findLocalChromeDevtoolsCli: async () => null,
      execCommand: async command => {
        commands.push(command);
        return { stdout: 'ok', stderr: '' };
      },
      installChromeDevtoolsCli: async () => {
        throw new Error('auto-install should be disabled');
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
      allowAutoInstall: false,
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
      installChromeDevtoolsCli: async () => {
        throw new Error('auto-install should be disabled');
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
      allowAutoInstall: false,
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
      installChromeDevtoolsCli: async () => {
        throw new Error('auto-install should be disabled');
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

test('resolveChromeDevtoolsCliRunner falls back to npx when auto-install fails', async () => {
  const commands = [];
  let installCalls = 0;

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
      installChromeDevtoolsCli: async () => {
        installCalls += 1;
        throw new Error('global install failed');
      },
    },
  );

  assert.equal(installCalls, 1);
  assert.equal(runner.kind, 'npx');
  assert.deepEqual(commands, [
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

test('ensureBrowserSession uses autoConnect when Chrome is already running and the CLI supports it', async () => {
  const autoConnectModes = [];

  const result = await ensureBrowserSession(
    { channel: 'stable' },
    {
      processVersion: 'v22.12.0',
      realUserDataDir: '/real-profile',
      isChromeRunning: async () => true,
      tryResolveLiveBrowser: async () => null,
      findChromeExecutable: async () => {
        throw new Error('Chrome should not be launched when autoConnect works');
      },
      resolveChromeDevtoolsCliRunner: async () => ({
        helpInfo: {
          rootPackageHelp: '--autoConnect',
          startHelp: '',
        },
        startCli: async () => {
          throw new Error('browserUrl transport should not be used');
        },
        startCliWithWsEndpoint: async () => {
          throw new Error('wsEndpoint transport should not be used');
        },
        startCliAutoConnect: async mode => {
          autoConnectModes.push(mode);
          return { stdout: '', stderr: '' };
        },
      }),
    },
  );

  assert.deepEqual(autoConnectModes, ['root']);
  assert.equal(result.mode, 'reuse-running');
  assert.equal(result.transport, 'autoConnect');
});

test('ensureBrowserSession uses wsEndpoint when a running Chrome does not expose /json/version', async () => {
  const wsEndpoints = [];

  const result = await ensureBrowserSession(
    { channel: 'stable' },
    {
      processVersion: 'v22.12.0',
      realUserDataDir: '/real-profile',
      isChromeRunning: async () => true,
      tryResolveLiveBrowser: async () => ({
        browserUrl: 'http://127.0.0.1:9222',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/demo',
        transport: 'wsEndpoint',
      }),
      findChromeExecutable: async () => {
        throw new Error('Chrome should not be launched when a live session exists');
      },
      resolveChromeDevtoolsCliRunner: async () => ({
        helpInfo: {
          rootPackageHelp: '',
          startHelp: '--wsEndpoint',
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
});

test('ensureBrowserSession falls back to browserUrl when autoConnect fails but a running Chrome exposes a debugging port', async () => {
  const browserUrls = [];
  let autoConnectCalls = 0;

  const result = await ensureBrowserSession(
    { channel: 'stable' },
    {
      processVersion: 'v22.12.0',
      realUserDataDir: '/real-profile',
      isChromeRunning: async () => true,
      tryResolveLiveBrowser: async () => ({
        browserUrl: 'http://127.0.0.1:9222',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/demo',
        transport: 'browserUrl',
      }),
      findChromeExecutable: async () => {
        throw new Error('Chrome should not be launched when a live session exists');
      },
      resolveChromeDevtoolsCliRunner: async () => ({
        helpInfo: {
          rootPackageHelp: '--autoConnect',
          startHelp: '',
        },
        startCli: async browserUrl => {
          browserUrls.push(browserUrl);
          return { stdout: '', stderr: '' };
        },
        startCliWithWsEndpoint: async () => {
          throw new Error('wsEndpoint transport should not be used');
        },
        startCliAutoConnect: async () => {
          autoConnectCalls += 1;
          throw new Error('autoConnect not enabled in Chrome');
        },
      }),
    },
  );

  assert.equal(autoConnectCalls, 1);
  assert.deepEqual(browserUrls, ['http://127.0.0.1:9222']);
  assert.equal(result.mode, 'reuse-running');
  assert.equal(result.transport, 'browserUrl');
});

test('ensureBrowserSession exits with guidance when Chrome is already running but cannot be reused', async () => {
  await assert.rejects(
    () =>
      ensureBrowserSession(
        { channel: 'stable' },
        {
          processVersion: 'v22.12.0',
          realUserDataDir: 'C:\\Users\\demo\\AppData\\Local\\Google\\Chrome\\User Data',
          isChromeRunning: async () => true,
          tryResolveLiveBrowser: async () => null,
          findChromeExecutable: async () => {
            throw new Error('Chrome should not be launched while the profile is already in use');
          },
          resolveChromeDevtoolsCliRunner: async () => ({
            helpInfo: {
              rootPackageHelp: '--autoConnect',
              startHelp: '',
            },
            startCli: async () => {
              throw new Error('browserUrl transport should not be used');
            },
            startCliWithWsEndpoint: async () => {
              throw new Error('wsEndpoint transport should not be used');
            },
            startCliAutoConnect: async () => {
              throw new Error('autoConnect not enabled');
            },
          }),
        },
      ),
    /chrome:\/\/inspect\/#remote-debugging[\s\S]*完全退出当前 Chrome 再重试/i,
  );
});

test('ensureBrowserSession launches Chrome with the real profile when Chrome is not already running', async () => {
  let launchedWith;
  let waitedWith;
  const browserUrls = [];

  const result = await ensureBrowserSession(
    { channel: 'stable' },
    {
      processVersion: 'v22.12.0',
      realUserDataDir: '/real-profile',
      chromeExecutablePath: '/path/to/chrome',
      isChromeRunning: async () => false,
      tryResolveLiveBrowser: async () => null,
      findChromeExecutable: async () => {
        throw new Error('findChromeExecutable should not be called when an explicit executable is provided');
      },
      findFreePort: async () => 9555,
      launchChromeDetached: async options => {
        launchedWith = options;
      },
      waitForBrowserReady: async (userDataDir, timeoutMs, options) => {
        waitedWith = { userDataDir, timeoutMs, options };
        return {
          browserUrl: options.browserUrl,
          webSocketDebuggerUrl: 'ws://127.0.0.1:9555/devtools/browser/demo',
        };
      },
      resolveChromeDevtoolsCliRunner: async () => ({
        helpInfo: {
          rootPackageHelp: '',
          startHelp: '',
        },
        startCli: async browserUrl => {
          browserUrls.push(browserUrl);
          return { stdout: '', stderr: '' };
        },
        startCliWithWsEndpoint: async () => {
          throw new Error('wsEndpoint transport should not be used');
        },
        startCliAutoConnect: async () => {
          throw new Error('autoConnect transport should not be used');
        },
      }),
    },
  );

  assert.deepEqual(launchedWith, {
    executablePath: '/path/to/chrome',
    userDataDir: '/real-profile',
    port: 9555,
  });
  assert.deepEqual(waitedWith, {
    userDataDir: '/real-profile',
    timeoutMs: undefined,
    options: {
      browserUrl: 'http://127.0.0.1:9555',
    },
  });
  assert.deepEqual(browserUrls, ['http://127.0.0.1:9555']);
  assert.equal(result.mode, 'launched-real-profile');
  assert.equal(result.userDataDir, '/real-profile');
  assert.equal(result.transport, 'browserUrl');
});
