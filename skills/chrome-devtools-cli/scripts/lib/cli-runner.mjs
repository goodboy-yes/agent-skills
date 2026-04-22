import { exec } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

import {
  buildCliCommand,
  buildNpxCommand,
  formatCommandFailure,
} from './npx-command.mjs';

const execAsync = promisify(exec);

export const DEFAULT_NPM_REGISTRY = 'https://registry.npmmirror.com/';
const DEFAULT_CLI_PACKAGE_SPEC = 'chrome-devtools-mcp@latest';
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

async function defaultInstallChromeDevtoolsCli({
  execCommand = defaultExecCommand,
  registry = DEFAULT_NPM_REGISTRY,
  packageSpec = DEFAULT_CLI_PACKAGE_SPEC,
} = {}) {
  const args = ['install', '-g', packageSpec];

  if (registry) {
    args.push(`--registry=${registry}`);
  }

  const command = buildCliCommand('npm', args);

  try {
    return await execCommand(command);
  } catch (error) {
    throw new Error(formatCommandFailure(command, error));
  }
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
      return await runCliCommand(cliCommand, ['start', `--browserUrl=${browserUrl}`], {
        execCommand,
      });
    },
    async startCliWithWsEndpoint(wsEndpoint) {
      return await runCliCommand(cliCommand, ['start', `--wsEndpoint=${wsEndpoint}`], {
        execCommand,
      });
    },
    async startCliAutoConnect(mode = 'start') {
      const args = mode === 'root' ? ['--autoConnect'] : ['start', '--autoConnect'];
      return await runCliCommand(cliCommand, args, { execCommand });
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
      return await runNpxCommand(['-y', 'chrome-devtools-mcp@latest', '--help'], {
        execCommand,
        registry,
      });
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
    async startCliAutoConnect(mode = 'root') {
      const args =
        mode === 'root'
          ? ['-y', 'chrome-devtools-mcp@latest', '--autoConnect']
          : ['-y', '-p', 'chrome-devtools-mcp@latest', 'chrome-devtools', 'start', '--autoConnect'];
      return await runNpxCommand(args, { execCommand, registry });
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

export function supportsStartAutoConnect(helpText = '') {
  return /--autoConnect\b/i.test(helpText);
}

export function resolveAutoConnectMode(helpInfo = {}) {
  if (supportsStartAutoConnect(helpInfo.rootPackageHelp)) {
    return 'root';
  }

  if (supportsStartAutoConnect(helpInfo.startHelp)) {
    return 'start';
  }

  return null;
}

export function supportsStartWsEndpoint(helpText = '') {
  return /--wsEndpoint\b/i.test(helpText);
}

export function getCliCapabilities(helpInfo = {}) {
  return {
    autoConnectMode: resolveAutoConnectMode(helpInfo),
    supportsWsEndpoint: supportsStartWsEndpoint(helpInfo.startHelp),
  };
}

async function tryResolveLocalCliRunner(
  cliCommand,
  {
    execCommand = defaultExecCommand,
  } = {},
) {
  if (!cliCommand) {
    return null;
  }

  const localRunner = createLocalCliRunner(cliCommand, { execCommand });

  try {
    const helpInfo = await learnHelpCommandsWithRunner(localRunner);
    if (!isCliCapableHelpInfo(helpInfo)) {
      return null;
    }

    return {
      ...localRunner,
      helpInfo,
    };
  } catch {
    return null;
  }
}

export async function findLocalChromeDevtoolsCli(
  {
    explicitCommand,
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
      // continue
    }
  }

  return null;
}

export async function resolveChromeDevtoolsCliRunner(
  {
    localCliCommand,
    npmRegistry = DEFAULT_NPM_REGISTRY,
    allowAutoInstall = true,
    packageSpec = DEFAULT_CLI_PACKAGE_SPEC,
  } = {},
  deps = {},
) {
  const execCommand = deps.execCommand ?? defaultExecCommand;
  const ensureNpxAvailable =
    deps.ensureNpxAvailable ??
    (async () => await defaultEnsureNpxAvailable({ execCommand }));
  const installChromeDevtoolsCli =
    deps.installChromeDevtoolsCli ??
    (async options => await defaultInstallChromeDevtoolsCli({
      execCommand,
      registry: npmRegistry,
      packageSpec,
      ...options,
    }));
  const findLocalCli = deps.findLocalChromeDevtoolsCli ?? findLocalChromeDevtoolsCli;

  const hasExplicitLocalCliCommand = Boolean(localCliCommand);
  const resolvedLocalCliCommand = localCliCommand ?? (await findLocalCli());
  const localRunner = await tryResolveLocalCliRunner(resolvedLocalCliCommand, { execCommand });

  if (localRunner) {
    return localRunner;
  }

  if (allowAutoInstall && !hasExplicitLocalCliCommand) {
    try {
      await installChromeDevtoolsCli({
        execCommand,
        registry: npmRegistry,
        packageSpec,
      });
    } catch {
      // fall back to npx
    }

    const installedLocalCliCommand = await findLocalCli();
    const installedLocalRunner = await tryResolveLocalCliRunner(installedLocalCliCommand, {
      execCommand,
    });

    if (installedLocalRunner) {
      return installedLocalRunner;
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
