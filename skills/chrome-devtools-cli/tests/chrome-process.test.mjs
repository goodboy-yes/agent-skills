import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasRunningChromeProcess,
  waitForBrowserReady,
} from '../scripts/lib/chrome-process.mjs';

test('hasRunningChromeProcess recognizes Chrome processes from process listings', () => {
  assert.equal(hasRunningChromeProcess('"chrome.exe","1234","Console","1","250,000 K"'), true);
  assert.equal(hasRunningChromeProcess('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), true);
  assert.equal(hasRunningChromeProcess('Code.exe\nnode\npwsh'), false);
});

test('waitForBrowserReady falls back to probing a known browserUrl when DevToolsActivePort is missing', async () => {
  const probeCalls = [];

  const ready = await waitForBrowserReady(
    '/real-profile',
    50,
    {
      browserUrl: 'http://127.0.0.1:9555',
      waitForDevToolsActivePortFn: async () => {
        throw new Error('DevToolsActivePort missing');
      },
      probeBrowserUrlFn: async browserUrl => {
        probeCalls.push(browserUrl);
        return {
          ok: true,
          browserUrl,
          webSocketDebuggerUrl: 'ws://127.0.0.1:9555/devtools/browser/demo',
        };
      },
    },
  );

  assert.deepEqual(probeCalls, ['http://127.0.0.1:9555']);
  assert.deepEqual(ready, {
    ok: true,
    browserUrl: 'http://127.0.0.1:9555',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9555/devtools/browser/demo',
  });
});
