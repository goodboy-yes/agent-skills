import { runJsonCliScript } from './lib/script-runtime.mjs';

await runJsonCliScript(import.meta.url, async ({ runtime }) => runtime);
