import { readDevToolsActivePort } from './devtools-active-port.mjs';
import { probeBrowserUrl } from './http-probe.mjs';
import { getRealUserDataDir } from './platform-paths.mjs';
import { isChromeRunning } from './chrome-process.mjs';

export async function inspectLiveBrowserFromUserDataDir(
  userDataDir,
  {
    readDevToolsActivePortFn = readDevToolsActivePort,
    probeBrowserUrlFn = probeBrowserUrl,
  } = {},
) {
  const activePort = await readDevToolsActivePortFn(userDataDir);

  try {
    const probe = await probeBrowserUrlFn(activePort.browserUrl);

    return {
      source: 'live',
      userDataDir,
      browserUrl: probe.browserUrl,
      webSocketDebuggerUrl: probe.webSocketDebuggerUrl,
      transport: 'browserUrl',
    };
  } catch (error) {
    return {
      source: 'live',
      userDataDir,
      browserUrl: activePort.browserUrl,
      webSocketDebuggerUrl: activePort.webSocketDebuggerUrl,
      transport: 'wsEndpoint',
      probeError: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function tryResolveLiveBrowserFromUserDataDir(
  userDataDir,
  {
    allowWsEndpointFallback = false,
    readDevToolsActivePortFn = readDevToolsActivePort,
    probeBrowserUrlFn = probeBrowserUrl,
  } = {},
) {
  try {
    const liveBrowser = await inspectLiveBrowserFromUserDataDir(userDataDir, {
      readDevToolsActivePortFn,
      probeBrowserUrlFn,
    });

    if (liveBrowser.transport === 'wsEndpoint' && !allowWsEndpointFallback) {
      return null;
    }

    return liveBrowser;
  } catch {
    return null;
  }
}

export async function detectBrowserState(
  {
    channel = 'stable',
    realUserDataDir,
  } = {},
  deps = {},
) {
  const resolvedRealUserDataDir =
    realUserDataDir ?? getRealUserDataDir({ channel });
  const chromeRunning = await (deps.isChromeRunning ?? isChromeRunning)();
  const tryResolveLiveBrowser = deps.tryResolveLiveBrowser;
  const inspectLiveBrowser =
    deps.inspectLiveBrowserFromUserDataDir ?? inspectLiveBrowserFromUserDataDir;

  let liveBrowser = null;

  try {
    liveBrowser = tryResolveLiveBrowser
      ? await tryResolveLiveBrowser(resolvedRealUserDataDir)
      : await inspectLiveBrowser(resolvedRealUserDataDir, deps);
  } catch {
    liveBrowser = null;
  }

  return {
    chromeRunning,
    realUserDataDir: resolvedRealUserDataDir,
    liveBrowser,
  };
}
