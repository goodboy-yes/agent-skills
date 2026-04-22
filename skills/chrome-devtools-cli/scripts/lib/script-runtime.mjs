import { spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  assertSupportedNodeVersion,
  findSupportedNodeExecutableFromNvm,
} from './node-version.mjs';

export async function rerunCurrentScriptWithSupportedNodeIfNeeded(
  {
    scriptUrl,
    scriptArgs = process.argv.slice(2),
  } = {},
) {
  try {
    assertSupportedNodeVersion(process.version);

    return {
      nodePath: process.execPath,
      nodeVersion: process.version,
      source: 'current',
    };
  } catch (error) {
    const supportedNode = await findSupportedNodeExecutableFromNvm();

    if (!supportedNode || supportedNode === process.execPath) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nUnable to find a supported Node executable in nvm. Install Node 22.12+ (or 20.19+) in nvm and try again.`,
      );
    }

    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(supportedNode, [fileURLToPath(scriptUrl), ...scriptArgs], {
        stdio: 'inherit',
        windowsHide: true,
      });

      child.on('error', reject);
      child.on('exit', (code, signal) => {
        if (signal) {
          reject(new Error(`Supported Node process exited because of signal: ${signal}`));
          return;
        }

        resolve(code ?? 1);
      });
    });

    process.exit(exitCode);
  }
}

export async function runJsonCliScript(scriptUrl, handler) {
  try {
    const runtime = await rerunCurrentScriptWithSupportedNodeIfNeeded({ scriptUrl });
    const result = await handler({ runtime });

    if (result !== undefined) {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
