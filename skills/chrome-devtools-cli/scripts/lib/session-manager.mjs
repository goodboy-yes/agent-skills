import { exec } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { assertSupportedNodeVersion } from './node-version.mjs';
import {
  getChromeExecutableCandidates,
  getFallbackProfileDir,
  getRealUserDataDir,
} from './platform-paths.mjs';
import { readDevToolsActivePort } from './devtools-active-port.mjs';
import { probeBrowserUrl } from './http-probe.mjs';
import { syncProfileCopy } from './profile-sync.mjs';
import {
  findExistingPath,
  findFreePort,
  launchChromeDetached,
  waitForBrowserReady,
} from './chrome-process.mjs';
import {
  buildCliCommand,
  buildNpxCommand,
  formatCommandFailure,
} from './npx-command.mjs';

const execAsync = promisify(exec);
const DEFAULT_NPM_REGISTRY =
  process.env.CHROME_DEVTOOLS_CLI_NPM_REGISTRY ?? 'https://registry.npmmirror.com/';
const LOCAL_CLI_NAMES = ['chrome-devtools', 'chrome-devtools-mcp'];

function createExecOptions() {
  return {
    timeout: 180000,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  };
}

async function defaultExecCommand(command) {
  return await execAsync(command, createExecOptions());
}

function getCommandOutput(result) {
  return `${result?.stdout ?? ''}${result?.stderr ?? ''}`;
}

async function runNpxCommand(
  args,
  {
    execCommand = defaultExecCommand,
    registry = DEFAULT_NPM_REGISTRY,
  } = {},
) {
  const command = buildNpxCommand(args, { registry });

  try {
    return await execCommand(command);
  } catch (error) {
    throw new Error(formatCommandFailure(command, error));
  }
}

async function runCliCommand(
  cliCommand,
  args,
  {
    execCommand = defaultExecCommand,
  } = {},
) {
  const command = buildCliCommand(cliCommand, args);

  try {
    return await execCommand(command);
  } catch (error) {
    throw new Error(formatCommandFailure(command, error));
  }
}

export async function runHelpCommand(args, options) {
  const result = await runNpxCommand(args, options);
  return getCommandOutput(result);
}

async function defaultEnsureNpxAvailable({
  execCommand = defaultExecCommand,
} = {}) {
  await execCommand(buildNpxCommand(['--version']));
}

function createLocalCliRunner(
  cliCommand,
  {
    execCommand = defaultExecCommand,
  } = {},
) {
  return {
    kind: 'local',
    command: cliCommand,
    async runRootHelp() {
      return await runCliCommand(cliCommand, ['--help'], { execCommand });
    },
    async runCliHelp() {
      return await runCliCommand(cliCommand, ['--help'], { execCommand });
    },
    async runStartHelp() {
      return await runCliCommand(cliCommand, ['start', '--help'], { execCommand });
    },
    async startCli(browserUrl) {
      return await runCliCommand(
        cliCommand,
        ['start', `--browserUrl=${browserUrl}`],
        { execCommand },
      );
    },
    async startCliWithWsEndpoint(wsEndpoint) {
      return await runCliCommand(
        cliCommand,
        ['start', `--wsEndpoint=${wsEndpoint}`],
        { execCommand },
      );
    },
    async startCliAutoConnect() {
      return await runCliCommand(cliCommand, ['start', '--autoConnect'], {
        execCommand,
      });
    },
    async stopCli() {
      return await runCliCommand(cliCommand, ['stop'], { execCommand });
    },
  };
}

function createNpxCliRunner({
  execCommand = defaultExecCommand,
  registry = DEFAULT_NPM_REGISTRY,
} = {}) {
  return {
    kind: 'npx',
    registry,
    async runRootHelp() {
      return await runNpxCommand(
        ['-y', 'chrome-devtools-mcp@latest', '--help'],
        { execCommand, registry },
      );
    },
    async runCliHelp() {
      return await runNpxCommand(
        ['-y', '-p', 'chrome-devtools-mcp@latest', 'chrome-devtools', '--help'],
        { execCommand, registry },
      );
    },
    async runStartHelp() {
      return await runNpxCommand(
        ['-y', '-p', 'chrome-devtools-mcp@latest', 'chrome-devtools', 'start', '--help'],
        { execCommand, registry },
      );
    },
    async startCli(browserUrl) {
      return await runNpxCommand(
        [
          '-y',
          '-p',
          'chrome-devtools-mcp@latest',
          'chrome-devtools',
          'start',
          `--browserUrl=${browserUrl}`,
        ],
        { execCommand, registry },
      );
    },
    async startCliWithWsEndpoint(wsEndpoint) {
      return await runNpxCommand(
        [
          '-y',
          '-p',
          'chrome-devtools-mcp@latest',
          'chrome-devtools',
          'start',
          `--wsEndpoint=${wsEndpoint}`,
        ],
        { execCommand, registry },
      );
    },
    async startCliAutoConnect() {
      return await runNpxCommand(
        ['-y', '-p', 'chrome-devtools-mcp@latest', 'chrome-devtools', 'start', '--autoConnect'],
        { execCommand, registry },
      );
    },
    async stopCli() {
      return await runNpxCommand(
        ['-y', '-p', 'chrome-devtools-mcp@latest', 'chrome-devtools', 'stop'],
        { execCommand, registry },
      );
    },
  };
}

async function learnHelpCommandsWithRunner(runner) {
  const rootPackageHelp = getCommandOutput(await runner.runRootHelp());
  const cliHelp = getCommandOutput(await runner.runCliHelp());
  const startHelp = getCommandOutput(await runner.runStartHelp());

  return {
    rootPackageHelp,
    cliHelp,
    startHelp,
  };
}

function hasCliStartSemantics(helpText = '') {
  return /\bchrome-devtools start\b/i.test(helpText);
}

function isCliCapableHelpInfo(helpInfo = {}) {
  return hasCliStartSemantics(helpInfo.cliHelp) && hasCliStartSemantics(helpInfo.startHelp);
}

function supportsStartAutoConnect(helpText = '') {
  return /--autoConnect\b/i.test(helpText);
}

function supportsStartWsEndpoint(helpText = '') {
  return /--wsEndpoint\b/i.test(helpText);
}

export async function findLocalChromeDevtoolsCli(
  {
    explicitCommand = process.env.CHROME_DEVTOOLS_CLI_COMMAND,
    pathEnv = process.env.PATH ?? '',
    pathExtEnv = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD;.PS1',
    platform = process.platform,
    accessFn = access,
  } = {},
) {
  if (explicitCommand) {
    return explicitCommand;
  }

  const pathEntries = String(pathEnv)
    .split(path.delimiter)
    .map(entry => entry.trim())
    .filter(Boolean);

  const windowsExtensions =
    platform === 'win32'
      ? String(pathExtEnv)
        .split(';')
        .map(ext => ext.trim())
        .filter(Boolean)
      : [''];

  const seenCandidates = new Set();
  const candidates = [];

  for (const directory of pathEntries) {
    for (const name of LOCAL_CLI_NAMES) {
      const localCandidates =
        platform === 'win32'
          ? [name, ...windowsExtensions.map(ext => `${name}${ext.toLowerCase()}`)]
          : [name];

      for (const localCandidate of localCandidates) {
        const candidatePath = path.join(directory, localCandidate);
        const normalizedCandidate = candidatePath.toLowerCase();

        if (!seenCandidates.has(normalizedCandidate)) {
          seenCandidates.add(normalizedCandidate);
          candidates.push(candidatePath);
        }
      }
    }
  }

  for (const candidate of candidates) {
    try {
      await accessFn(candidate);
      return candidate;
    } catch {
      // Try the next candidate on PATH.
    }
  }

  return null;
}

export async function resolveChromeDevtoolsCliRunner(
  {
    localCliCommand = process.env.CHROME_DEVTOOLS_CLI_COMMAND,
    npmRegistry = DEFAULT_NPM_REGISTRY,
  } = {},
  deps = {},
) {
  const execCommand = deps.execCommand ?? defaultExecCommand;
  const ensureNpxAvailable =
    deps.ensureNpxAvailable ??
    (async () => await defaultEnsureNpxAvailable({ execCommand }));
  const findLocalCli =
    deps.findLocalChromeDevtoolsCli ?? findLocalChromeDevtoolsCli;

  const resolvedLocalCliCommand =
    localCliCommand ?? (await findLocalCli());

  if (resolvedLocalCliCommand) {
    const localRunner = createLocalCliRunner(resolvedLocalCliCommand, {
      execCommand,
    });

    try {
      const helpInfo = await learnHelpCommandsWithRunner(localRunner);
      if (!isCliCapableHelpInfo(helpInfo)) {
        throw new Error('Local command does not expose chrome-devtools start/stop CLI semantics');
      }

      return {
        ...localRunner,
        helpInfo,
      };
    } catch {
      // Fall through to npx when the local command does not expose start/stop CLI semantics.
    }
  }

  await ensureNpxAvailable();

  const npxRunner = createNpxCliRunner({
    execCommand,
    registry: npmRegistry,
  });
  const helpInfo = await learnHelpCommandsWithRunner(npxRunner);

  return {
    ...npxRunner,
    helpInfo,
  };
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
      if (!allowWsEndpointFallback) {
        return null;
      }

      return {
        source: 'live',
        userDataDir,
        browserUrl: activePort.browserUrl,
        webSocketDebuggerUrl: activePort.webSocketDebuggerUrl,
        transport: 'wsEndpoint',
        probeError: error instanceof Error ? error.message : String(error),
      };
    }
  } catch {
    return null;
  }
}

async function defaultTryResolveLiveBrowser(userDataDir, options) {
  return await tryResolveLiveBrowserFromUserDataDir(userDataDir, options);
}

export async function ensureBrowserSession(
  {
    channel = 'stable',
    realUserDataDirOverride = process.env.CHROME_DEVTOOLS_CLI_USER_DATA_DIR,
    chromeExecutableOverride = process.env.CHROME_DEVTOOLS_CLI_CHROME_PATH,
    npmRegistry = DEFAULT_NPM_REGISTRY,
  } = {},
  deps = {},
) {
  assertSupportedNodeVersion(deps.processVersion ?? process.version);

  const useLegacyCliFlow =
    Boolean(deps.ensureNpxAvailable) ||
    Boolean(deps.learnHelpCommands) ||
    Boolean(deps.startCli) ||
    Boolean(deps.startCliWithWsEndpoint) ||
    Boolean(deps.startCliAutoConnect);
  const ensureNpxAvailable = deps.ensureNpxAvailable ?? defaultEnsureNpxAvailable;
  const learnHelpCommands = deps.learnHelpCommands;
  const tryResolveLiveBrowser = deps.tryResolveLiveBrowser ?? defaultTryResolveLiveBrowser;
  let startCli;
  let startCliWithWsEndpoint;
  let startCliAutoConnect;
  let helpInfo;

  if (useLegacyCliFlow) {
    startCli = deps.startCli ?? (async () => { });
    startCliWithWsEndpoint = deps.startCliWithWsEndpoint ?? (async () => { });
    startCliAutoConnect = deps.startCliAutoConnect ?? (async () => { });
    await ensureNpxAvailable();
    helpInfo = (await learnHelpCommands?.()) ?? {};
  } else {
    const cliRunner = await (deps.resolveChromeDevtoolsCliRunner ?? resolveChromeDevtoolsCliRunner)(
      {
        localCliCommand: process.env.CHROME_DEVTOOLS_CLI_COMMAND,
        npmRegistry,
      },
      deps,
    );

    startCli = async browserUrl => {
      const result = await cliRunner.startCli(browserUrl);

      return {
        mode: 'browserUrl',
        browserUrl,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      };
    };
    startCliWithWsEndpoint = async wsEndpoint => {
      const result = await cliRunner.startCliWithWsEndpoint(wsEndpoint);

      return {
        mode: 'wsEndpoint',
        webSocketDebuggerUrl: wsEndpoint,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      };
    };
    startCliAutoConnect = async () => {
      const result = await cliRunner.startCliAutoConnect();

      return {
        mode: 'autoConnect',
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      };
    };
    helpInfo = cliRunner.helpInfo ?? {};
  }

  if (supportsStartAutoConnect(helpInfo.startHelp)) {
    await startCliAutoConnect();

    return {
      mode: 'reuse-running',
      browserUrl: null,
      userDataDir: null,
      syncStatus: 'skipped',
      transport: 'autoConnect',
      helpInfo,
    };
  }

  const canUseWsEndpoint = supportsStartWsEndpoint(helpInfo.startHelp);

  const realUserDataDir =
    deps.realUserDataDir ??
    getRealUserDataDir({ channel, override: realUserDataDirOverride });
  const fallbackUserDataDir =
    deps.fallbackUserDataDir ?? getFallbackProfileDir({ channel });

  const realBrowser = await tryResolveLiveBrowser(realUserDataDir, {
    allowWsEndpointFallback: canUseWsEndpoint,
  });
  if (realBrowser) {
    if (realBrowser.transport === 'wsEndpoint') {
      await startCliWithWsEndpoint(realBrowser.webSocketDebuggerUrl);
    } else {
      await startCli(realBrowser.browserUrl);
    }

    return {
      mode: 'reuse-running',
      browserUrl: realBrowser.browserUrl,
      webSocketDebuggerUrl: realBrowser.webSocketDebuggerUrl ?? null,
      userDataDir: realUserDataDir,
      syncStatus: 'skipped',
      transport: realBrowser.transport ?? 'browserUrl',
      helpInfo,
    };
  }

  const fallbackBrowser = await tryResolveLiveBrowser(fallbackUserDataDir, {
    allowWsEndpointFallback: canUseWsEndpoint,
  });
  if (fallbackBrowser) {
    if (fallbackBrowser.transport === 'wsEndpoint') {
      await startCliWithWsEndpoint(fallbackBrowser.webSocketDebuggerUrl);
    } else {
      await startCli(fallbackBrowser.browserUrl);
    }

    return {
      mode: 'reuse-fallback',
      browserUrl: fallbackBrowser.browserUrl,
      webSocketDebuggerUrl: fallbackBrowser.webSocketDebuggerUrl ?? null,
      userDataDir: fallbackUserDataDir,
      syncStatus: 'skipped',
      transport: fallbackBrowser.transport ?? 'browserUrl',
      helpInfo,
    };
  }

  const syncResult = await (deps.syncProfileCopy ?? syncProfileCopy)({
    sourceDir: realUserDataDir,
    targetDir: fallbackUserDataDir,
  });

  const executablePath =
    deps.chromeExecutablePath ??
    (await (deps.findChromeExecutable ?? findExistingPath)(
      getChromeExecutableCandidates({
        channel,
        override: chromeExecutableOverride,
      }),
    ));

  const port = await (deps.findFreePort ?? findFreePort)();

  await (deps.launchChromeDetached ?? launchChromeDetached)({
    executablePath,
    userDataDir: fallbackUserDataDir,
    port,
  });

  const ready =
    (await (deps.waitForBrowserReady ?? waitForBrowserReady)(fallbackUserDataDir)) ?? {
      browserUrl: `http://127.0.0.1:${port}`,
    };

  await startCli(ready.browserUrl);

  return {
    mode: 'launched-fallback',
    browserUrl: ready.browserUrl,
    webSocketDebuggerUrl: ready.webSocketDebuggerUrl ?? null,
    userDataDir: fallbackUserDataDir,
    syncStatus: syncResult.ok ? 'success' : 'failed',
    syncError: syncResult.ok ? null : syncResult.error,
    transport: 'browserUrl',
    helpInfo,
  };
}
