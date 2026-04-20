import { readFile } from 'node:fs/promises';
import path from 'node:path';

export function parseDevToolsActivePort(fileContent) {
  const [rawPort, rawPath] = String(fileContent)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const port = Number.parseInt(rawPort, 10);

  if (!rawPort || !rawPath || Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid DevToolsActivePort contents: ${JSON.stringify(fileContent)}`);
  }

  return {
    port,
    path: rawPath,
    browserUrl: `http://127.0.0.1:${port}`,
    webSocketDebuggerUrl: `ws://127.0.0.1:${port}${rawPath}`,
  };
}

export async function readDevToolsActivePort(userDataDir) {
  const filePath = path.join(userDataDir, 'DevToolsActivePort');
  const fileContent = await readFile(filePath, 'utf8');

  return {
    filePath,
    ...parseDevToolsActivePort(fileContent),
  };
}
