import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attachCliToBrowserTarget,
  attachToRunningBrowser,
  launchDebugChromeSession,
} from '../scripts/lib/session-actions.mjs';

test('attachCliToBrowserTarget uses browserUrl transport for a known browser target', async () => {
  const browserUrls = [];

  const result = await attachCliToBrowserTarget({
    cliRunner: {
      helpInfo: { rootPackageHelp: '', startHelp: '' },
      startCli: async browserUrl => {
        browserUrls.push(browserUrl);
        return { stdout: 'started', stderr: '' };
      },
      startCliWithWsEndpoint: async () => {
        throw new Error('wsEndpoint should not be used');
      },
      startCliAutoConnect: async () => {
        throw new Error('autoConnect should not be used');
      },
    },
    browserTarget: {
      browserUrl: 'http://127.0.0.1:9555',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9555/devtools/browser/demo',
      userDataDir: '/real-profile',
      transport: 'browserUrl',
    },
  });

  assert.deepEqual(browserUrls, ['http://127.0.0.1:9555']);
  assert.equal(result.transport, 'browserUrl');
  assert.equal(result.browserUrl, 'http://127.0.0.1:9555');
});

test('attachToRunningBrowser prefers autoConnect before direct endpoint reuse', async () => {
  const autoConnectModes = [];

  const result = await attachToRunningBrowser({
    cliRunner: {
      helpInfo: { rootPackageHelp: '--autoConnect', startHelp: '' },
      startCli: async () => {
        throw new Error('browserUrl should not be used when autoConnect works');
      },
      startCliWithWsEndpoint: async () => {
        throw new Error('wsEndpoint should not be used when autoConnect works');
      },
      startCliAutoConnect: async mode => {
        autoConnectModes.push(mode);
        return { stdout: '', stderr: '' };
      },
    },
    browserState: {
      chromeRunning: true,
      realUserDataDir: '/real-profile',
      liveBrowser: null,
    },
  });

  assert.deepEqual(autoConnectModes, ['root']);
  assert.equal(result.mode, 'reuse-running');
  assert.equal(result.transport, 'autoConnect');
});

test('launchDebugChromeSession starts Chrome with the real profile and waits for readiness', async () => {
  let launchedWith;
  let waitedWith;

  const result = await launchDebugChromeSession(
    {
      channel: 'stable',
      realUserDataDir: '/real-profile',
      chromeExecutablePath: '/path/to/chrome',
    },
    {
      findChromeExecutable: async () => {
        throw new Error('findChromeExecutable should not be used when executable path is explicit');
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
  assert.equal(result.mode, 'launched-real-profile');
  assert.equal(result.browserUrl, 'http://127.0.0.1:9555');
  assert.equal(result.userDataDir, '/real-profile');
});
