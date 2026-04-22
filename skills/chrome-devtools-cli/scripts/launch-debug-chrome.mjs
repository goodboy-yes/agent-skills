import { detectBrowserState } from './lib/browser-state.mjs';
import { launchDebugChromeSession } from './lib/session-actions.mjs';
import { runJsonCliScript } from './lib/script-runtime.mjs';

await runJsonCliScript(import.meta.url, async () => {
  const browserState = await detectBrowserState({
    channel: 'stable',
  });

  if (browserState.chromeRunning) {
    throw new Error('Chrome is already running; use attach-to-running-browser.mjs instead.');
  }

  return await launchDebugChromeSession({
    channel: 'stable',
    realUserDataDir: browserState.realUserDataDir,
  });
});
