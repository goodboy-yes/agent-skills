import { detectBrowserState } from './lib/browser-state.mjs';
import { resolveChromeDevtoolsCliRunner } from './lib/cli-runner.mjs';
import { attachToRunningBrowser } from './lib/session-actions.mjs';
import { runJsonCliScript } from './lib/script-runtime.mjs';

await runJsonCliScript(import.meta.url, async () => {
  const cliRunner = await resolveChromeDevtoolsCliRunner();
  const browserState = await detectBrowserState({
    channel: 'stable',
  });

  return await attachToRunningBrowser({
    cliRunner,
    browserState,
  });
});
