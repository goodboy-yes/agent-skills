import process from 'node:process';

import { ensureBrowserSession } from './lib/session-manager.mjs';

try {
  const result = await ensureBrowserSession({
    channel: process.env.CHROME_DEVTOOLS_CLI_CHANNEL ?? 'stable',
  });

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
