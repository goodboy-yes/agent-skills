import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  parseDevToolsActivePort,
  readDevToolsActivePort,
} from '../scripts/lib/devtools-active-port.mjs';
import { probeBrowserUrl } from '../scripts/lib/http-probe.mjs';

test('parseDevToolsActivePort parses the port and websocket path', () => {
  const result = parseDevToolsActivePort('9222\n/devtools/browser/abc\n');

  assert.equal(result.port, 9222);
  assert.equal(result.browserUrl, 'http://127.0.0.1:9222');
  assert.equal(result.webSocketDebuggerUrl, 'ws://127.0.0.1:9222/devtools/browser/abc');
});

test('readDevToolsActivePort reads the file from a profile directory', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'cdt-port-'));
  await writeFile(
    path.join(tempDir, 'DevToolsActivePort'),
    '9333\n/devtools/browser/xyz\n',
    'utf8',
  );

  const result = await readDevToolsActivePort(tempDir);
  assert.equal(result.port, 9333);
});

test('probeBrowserUrl returns ok when /json/version is reachable', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/json/version') {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          Browser: 'Chrome/144.0.0.0',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9321/devtools/browser/demo',
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.end('not found');
  });

  await new Promise(resolve => server.listen(9321, '127.0.0.1', resolve));

  try {
    const result = await probeBrowserUrl('http://127.0.0.1:9321');
    assert.equal(result.ok, true);
    assert.match(result.browserVersion, /Chrome\/144/);
  } finally {
    server.close();
  }
});
