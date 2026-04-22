import { ensureBrowserSession } from './lib/session-manager.mjs';
import { runJsonCliScript } from './lib/script-runtime.mjs';

await runJsonCliScript(import.meta.url, async () => {
  return await ensureBrowserSession({
    channel: 'stable',
  });
});
