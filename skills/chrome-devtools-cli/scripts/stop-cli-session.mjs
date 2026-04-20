import process from 'node:process';
import { resolveChromeDevtoolsCliRunner } from './lib/session-manager.mjs';

function canIgnoreStopError(error) {
  const text = `${error?.message ?? ''}\n${error?.stdout ?? ''}\n${error?.stderr ?? ''}`;
  return /not running|no daemon|no active/i.test(text);
}

try {
  const cliRunner = await resolveChromeDevtoolsCliRunner();
  await cliRunner.stopCli();
} catch (error) {
  if (!canIgnoreStopError(error)) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
