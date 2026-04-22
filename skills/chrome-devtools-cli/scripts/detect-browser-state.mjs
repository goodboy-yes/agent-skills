import { detectBrowserState } from './lib/browser-state.mjs';
import { runJsonCliScript } from './lib/script-runtime.mjs';

await runJsonCliScript(import.meta.url, async () => await detectBrowserState({
  channel: 'stable',
}));
