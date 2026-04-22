import process from 'node:process';

import { assertSupportedNodeVersion } from './node-version.mjs';
import {
  DEFAULT_NPM_REGISTRY,
  findLocalChromeDevtoolsCli,
  resolveChromeDevtoolsCliRunner,
  runHelpCommand,
} from './cli-runner.mjs';
import {
  detectBrowserState,
  inspectLiveBrowserFromUserDataDir,
  tryResolveLiveBrowserFromUserDataDir,
} from './browser-state.mjs';
import {
  attachCliToBrowserTarget,
  attachToRunningBrowser,
  buildChromeReuseGuidance,
  launchDebugChromeSession,
} from './session-actions.mjs';

export {
  DEFAULT_NPM_REGISTRY,
  findLocalChromeDevtoolsCli,
  resolveChromeDevtoolsCliRunner,
  runHelpCommand,
} from './cli-runner.mjs';

export {
  detectBrowserState,
  inspectLiveBrowserFromUserDataDir,
  tryResolveLiveBrowserFromUserDataDir,
} from './browser-state.mjs';

export {
  attachCliToBrowserTarget,
  attachToRunningBrowser,
  buildChromeReuseGuidance,
  launchDebugChromeSession,
} from './session-actions.mjs';

export async function ensureBrowserSession(
  {
    channel = 'stable',
    npmRegistry = DEFAULT_NPM_REGISTRY,
  } = {},
  deps = {},
) {
  assertSupportedNodeVersion(deps.processVersion ?? process.version);

  const cliRunner = await (deps.resolveChromeDevtoolsCliRunner ?? resolveChromeDevtoolsCliRunner)(
    {
      npmRegistry,
    },
    deps,
  );

  const browserState = await (deps.detectBrowserState ?? detectBrowserState)(
    {
      channel,
      realUserDataDir: deps.realUserDataDir,
    },
    deps,
  );

  if (browserState.chromeRunning) {
    return await (deps.attachToRunningBrowser ?? attachToRunningBrowser)({
      cliRunner,
      browserState,
    });
  }

  const launchedBrowserTarget = await (deps.launchDebugChromeSession ?? launchDebugChromeSession)(
    {
      channel,
      realUserDataDir: browserState.realUserDataDir,
      chromeExecutablePath: deps.chromeExecutablePath,
    },
    deps,
  );

  return await (deps.attachCliToBrowserTarget ?? attachCliToBrowserTarget)({
    cliRunner,
    browserTarget: launchedBrowserTarget,
  });
}
