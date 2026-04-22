import {
  getCliCapabilities,
  resolveChromeDevtoolsCliRunner,
} from './lib/cli-runner.mjs';
import { runJsonCliScript } from './lib/script-runtime.mjs';

await runJsonCliScript(import.meta.url, async () => {
  const cliRunner = await resolveChromeDevtoolsCliRunner();
  const helpInfo = cliRunner.helpInfo ?? {};

  return {
    kind: cliRunner.kind,
    command: cliRunner.command ?? null,
    registry: cliRunner.registry ?? null,
    helpInfo,
    capabilities: getCliCapabilities(helpInfo),
  };
});
