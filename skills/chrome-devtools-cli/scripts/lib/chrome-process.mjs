import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

import { readDevToolsActivePort } from './devtools-active-port.mjs';
import { probeBrowserUrl } from './http-probe.mjs';

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function findExistingPath(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(`Unable to find a Chrome executable from: ${candidates.join(', ')}`);
}

export async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to allocate a local debugging port'));
        return;
      }

      const { port } = address;
      server.close(error => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

export function launchChromeDetached({
  executablePath,
  userDataDir,
  port,
  extraArgs = [],
}) {
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    ...extraArgs,
  ];

  const child = spawn(executablePath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });

  child.unref();

  return {
    pid: child.pid,
    args,
  };
}

export async function waitForDevToolsActivePort(userDataDir, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      return await readDevToolsActivePort(userDataDir);
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }

  const filePath = path.join(userDataDir, 'DevToolsActivePort');
  throw new Error(
    `Timed out waiting for DevToolsActivePort: ${filePath}${lastError ? `; last error: ${lastError.message}` : ''}`,
  );
}

export async function waitForBrowserReady(userDataDir, timeoutMs = 15000) {
  const activePort = await waitForDevToolsActivePort(userDataDir, timeoutMs);
  return await probeBrowserUrl(activePort.browserUrl, timeoutMs);
}
