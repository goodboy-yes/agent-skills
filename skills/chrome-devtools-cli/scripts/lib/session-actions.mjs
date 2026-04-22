import {
  getCliCapabilities,
} from './cli-runner.mjs';
import {
  findExistingPath,
  findFreePort,
  launchChromeDetached,
  waitForBrowserReady,
} from './chrome-process.mjs';
import { getChromeExecutableCandidates } from './platform-paths.mjs';

export function buildChromeReuseGuidance({ autoConnectMode, autoConnectError } = {}) {
  const instructions = [
    '检测到当前 Chrome 已经在运行，但这个会话既没有暴露可复用的调试端口，也还不能通过当前 CLI 自动接入。',
    '如需复用当前登录态，请先在 Chrome 中打开 chrome://inspect/#remote-debugging 并开启远程调试，然后重新运行并在浏览器里确认授权。',
    '如果你不打算走 autoConnect，请先完全退出当前 Chrome 再重试；CLI 会在 Chrome 未运行时用当前真实 profile 加上调试端口重新拉起浏览器。',
  ];

  if (autoConnectMode && autoConnectError) {
    instructions.push(`本次 autoConnect 失败原因：${autoConnectError}`);
  }

  return instructions.join('\n');
}

export async function attachCliToBrowserTarget({
  cliRunner,
  browserTarget,
}) {
  const helpInfo = cliRunner.helpInfo ?? {};
  const { supportsWsEndpoint } = getCliCapabilities(helpInfo);

  if (browserTarget.transport === 'autoConnect') {
    const autoConnectMode = browserTarget.autoConnectMode;
    if (!autoConnectMode) {
      throw new Error('Current chrome-devtools CLI does not support --autoConnect');
    }

    const result = await cliRunner.startCliAutoConnect(autoConnectMode);

    return {
      mode: browserTarget.mode ?? 'reuse-running',
      browserUrl: null,
      webSocketDebuggerUrl: null,
      userDataDir: browserTarget.userDataDir ?? null,
      transport: 'autoConnect',
      helpInfo,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  }

  if (browserTarget.transport === 'wsEndpoint') {
    if (!supportsWsEndpoint) {
      throw new Error('Current chrome-devtools CLI does not support --wsEndpoint');
    }

    const result = await cliRunner.startCliWithWsEndpoint(browserTarget.webSocketDebuggerUrl);

    return {
      mode: browserTarget.mode ?? 'reuse-running',
      browserUrl: browserTarget.browserUrl ?? null,
      webSocketDebuggerUrl: browserTarget.webSocketDebuggerUrl ?? null,
      userDataDir: browserTarget.userDataDir ?? null,
      transport: 'wsEndpoint',
      helpInfo,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  }

  const result = await cliRunner.startCli(browserTarget.browserUrl);

  return {
    mode: browserTarget.mode ?? 'reuse-running',
    browserUrl: browserTarget.browserUrl ?? null,
    webSocketDebuggerUrl: browserTarget.webSocketDebuggerUrl ?? null,
    userDataDir: browserTarget.userDataDir ?? null,
    transport: 'browserUrl',
    helpInfo,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export async function attachToRunningBrowser({
  cliRunner,
  browserState,
}) {
  const helpInfo = cliRunner.helpInfo ?? {};
  const { autoConnectMode } = getCliCapabilities(helpInfo);
  let autoConnectError = null;

  if (browserState.chromeRunning && autoConnectMode) {
    try {
      return await attachCliToBrowserTarget({
        cliRunner,
        browserTarget: {
          transport: 'autoConnect',
          autoConnectMode,
          userDataDir: browserState.realUserDataDir,
          mode: 'reuse-running',
        },
      });
    } catch (error) {
      autoConnectError = error instanceof Error ? error.message : String(error);
    }
  }

  if (browserState.liveBrowser) {
    return await attachCliToBrowserTarget({
      cliRunner,
      browserTarget: {
        ...browserState.liveBrowser,
        userDataDir: browserState.realUserDataDir,
        mode: 'reuse-running',
      },
    });
  }

  if (browserState.chromeRunning) {
    throw new Error(buildChromeReuseGuidance({ autoConnectMode, autoConnectError }));
  }

  throw new Error('Chrome is not running; launch a debug Chrome session first.');
}

export async function launchDebugChromeSession(
  {
    channel = 'stable',
    realUserDataDir,
    chromeExecutablePath,
  } = {},
  deps = {},
) {
  const executablePath =
    chromeExecutablePath ??
    (await (deps.findChromeExecutable ?? findExistingPath)(
      getChromeExecutableCandidates({ channel }),
    ));
  const port = await (deps.findFreePort ?? findFreePort)();

  await (deps.launchChromeDetached ?? launchChromeDetached)({
    executablePath,
    userDataDir: realUserDataDir,
    port,
  });

  const ready =
    (await (deps.waitForBrowserReady ?? waitForBrowserReady)(realUserDataDir, undefined, {
      browserUrl: `http://127.0.0.1:${port}`,
    })) ?? {
      browserUrl: `http://127.0.0.1:${port}`,
    };

  return {
    mode: 'launched-real-profile',
    browserUrl: ready.browserUrl,
    webSocketDebuggerUrl: ready.webSocketDebuggerUrl ?? null,
    userDataDir: realUserDataDir,
    transport: 'browserUrl',
    port,
  };
}
