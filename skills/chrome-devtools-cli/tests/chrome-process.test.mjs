import test from 'node:test';
import assert from 'node:assert/strict';

import { waitForBrowserReady } from '../scripts/lib/chrome-process.mjs';

test('waitForBrowserReady falls back to probing a known browserUrl when DevToolsActivePort is missing', async () => {
  const probeCalls = [];

  const ready = await waitForBrowserReady(
    '/fallback-profile',
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
