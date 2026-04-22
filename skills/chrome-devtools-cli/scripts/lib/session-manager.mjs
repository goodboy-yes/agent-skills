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

// 将 exec 回调形式转为 Promise 形式
const execAsync = promisify(exec);

// 默认 npm registry，可通过环境变量覆盖
const DEFAULT_NPM_REGISTRY =
  process.env.CHROME_DEVTOOLS_CLI_NPM_REGISTRY ?? 'https://registry.npmmirror.com/';
// 默认 CLI 包名和版本
const DEFAULT_CLI_PACKAGE_SPEC = 'chrome-devtools-mcp@latest';
// 禁用自动安装的环境变量名
const DISABLE_AUTO_INSTALL_ENV_VAR = 'CHROME_DEVTOOLS_CLI_DISABLE_AUTO_INSTALL';
// 本地 CLI 可执行文件的候选名称
const LOCAL_CLI_NAMES = ['chrome-devtools', 'chrome-devtools-mcp'];

// 创建 exec 命令的通用配置选项
function createExecOptions() {
  return {
    timeout: 180000,        // 超时 3 分钟
    windowsHide: true,      // Windows 下隐藏控制台窗口
    maxBuffer: 10 * 1024 * 1024, // 最大缓冲区 10MB
  };
}

// 使用 execAsync 执行命令
async function defaultExecCommand(command) {
  return await execAsync(command, createExecOptions());
}

// 合并 stdout 和 stderr 输出
function getCommandOutput(result) {
  return `${result?.stdout ?? ''}${result?.stderr ?? ''}`;
}

// 执行 npx 命令（带 registry 参数）
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

// 执行本地 CLI 命令
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

// 运行 npx 帮助命令，返回合并的输出
export async function runHelpCommand(args, options) {
  const result = await runNpxCommand(args, options);
  return getCommandOutput(result);
}

// 检查 npx 是否可用（执行 npx --version）
async function defaultEnsureNpxAvailable({
  execCommand = defaultExecCommand,
} = {}) {
  await execCommand(buildNpxCommand(['--version']));
}

// 判断环境变量值是否为"真值"（1/true/yes/on）
function isTruthyEnvValue(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

// 全局安装 chrome-devtools-mcp CLI 包
async function defaultInstallChromeDevtoolsCli({
  execCommand = defaultExecCommand,
  registry = DEFAULT_NPM_REGISTRY,
  packageSpec = DEFAULT_CLI_PACKAGE_SPEC,
} = {}) {
  const args = ['install', '-g', packageSpec];

  // 添加自定义 registry 参数
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

// 创建本地 CLI 运器（已全局安装的 chrome-devtools 命令）
function createLocalCliRunner(
  cliCommand,
  {
    execCommand = defaultExecCommand,
  } = {},
) {
  return {
    kind: 'local',
    command: cliCommand,

    // 运行包级别的 --help
    async runRootHelp() {
      return await runCliCommand(cliCommand, ['--help'], { execCommand });
    },

    // 运行 chrome-devtools --help
    async runCliHelp() {
      return await runCliCommand(cliCommand, ['--help'], { execCommand });
    },

    // 运行 chrome-devtools start --help
    async runStartHelp() {
      return await runCliCommand(cliCommand, ['start', '--help'], { execCommand });
    },

    // 使用 browserUrl 模式启动 CLI
    async startCli(browserUrl) {
      return await runCliCommand(
        cliCommand,
        ['start', `--browserUrl=${browserUrl}`],
        { execCommand },
      );
    },

    // 使用 wsEndpoint 模式启动 CLI
    async startCliWithWsEndpoint(wsEndpoint) {
      return await runCliCommand(
        cliCommand,
        ['start', `--wsEndpoint=${wsEndpoint}`],
        { execCommand },
      );
    },

    // 使用 autoConnect 模式启动 CLI（自动检测运行中的浏览器）
    async startCliAutoConnect() {
      return await runCliCommand(cliCommand, ['start', '--autoConnect'], {
        execCommand,
      });
    },

    // 停止 CLI 守护进程
    async stopCli() {
      return await runCliCommand(cliCommand, ['stop'], { execCommand });
    },
  };
}

// 创建 npx CLI 运行器（通过 npx 临时下载并运行 CLI）
function createNpxCliRunner({
  execCommand = defaultExecCommand,
  registry = DEFAULT_NPM_REGISTRY,
} = {}) {
  return {
    kind: 'npx',
    registry,

    // 通过 npx 运行包级别 --help
    async runRootHelp() {
      return await runNpxCommand(
        ['-y', 'chrome-devtools-mcp@latest', '--help'],
        { execCommand, registry },
      );
    },

    // 通过 npx 运行 chrome-devtools --help
    async runCliHelp() {
      return await runNpxCommand(
        ['-y', '-p', 'chrome-devtools-mcp@latest', 'chrome-devtools', '--help'],
        { execCommand, registry },
      );
    },

    // 通过 npx 运行 chrome-devtools start --help
    async runStartHelp() {
      return await runNpxCommand(
        ['-y', '-p', 'chrome-devtools-mcp@latest', 'chrome-devtools', 'start', '--help'],
        { execCommand, registry },
      );
    },

    // 使用 browserUrl 模式通过 npx 启动 CLI
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

    // 使用 wsEndpoint 模式通过 npx 启动 CLI
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

    // 使用 autoConnect 模式通过 npx 启动 CLI
    async startCliAutoConnect() {
      return await runNpxCommand(
        ['-y', '-p', 'chrome-devtools-mcp@latest', 'chrome-devtools', 'start', '--autoConnect'],
        { execCommand, registry },
      );
    },

    // 通过 npx 停止 CLI 守护进程
    async stopCli() {
      return await runNpxCommand(
        ['-y', '-p', 'chrome-devtools-mcp@latest', 'chrome-devtools', 'stop'],
        { execCommand, registry },
      );
    },
  };
}

// 尝试将本地 CLI 命令解析为可用的运行器，验证其是否支持 start 子命令
async function tryResolveLocalCliRunner(
  cliCommand,
  {
    execCommand = defaultExecCommand,
  } = {},
) {
  // 如果没有提供命令则直接返回 null
  if (!cliCommand) {
    return null;
  }

  const localRunner = createLocalCliRunner(cliCommand, {
    execCommand,
  });

  try {
    // 获取帮助信息并验证 CLI 功能是否完整
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

// 从运行器获取三个级别的帮助信息（包级别、CLI 级别、start 子命令级别）
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

// 判断帮助文本中是否包含 "chrome-devtools start" 语义
function hasCliStartSemantics(helpText = '') {
  return /\bchrome-devtools start\b/i.test(helpText);
}

// 判断帮助信息是否表明 CLI 支持 start 子命令
function isCliCapableHelpInfo(helpInfo = {}) {
  return hasCliStartSemantics(helpInfo.cliHelp) && hasCliStartSemantics(helpInfo.startHelp);
}

// 判断 CLI 是否支持 --autoConnect 参数
function supportsStartAutoConnect(helpText = '') {
  return /--autoConnect\b/i.test(helpText);
}

// 判断 CLI 是否支持 --wsEndpoint 参数
function supportsStartWsEndpoint(helpText = '') {
  return /--wsEndpoint\b/i.test(helpText);
}

// 在系统 PATH 中查找本地已安装的 chrome-devtools CLI 可执行文件
export async function findLocalChromeDevtoolsCli(
  {
    explicitCommand = process.env.CHROME_DEVTOOLS_CLI_COMMAND,
    pathEnv = process.env.PATH ?? '',
    pathExtEnv = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD;.PS1',
    platform = process.platform,
    accessFn = access,
  } = {},
) {
  // 如果通过环境变量显式指定了命令，直接返回
  if (explicitCommand) {
    return explicitCommand;
  }

  // 将 PATH 环境变量按分隔符拆分为目录列表
  const pathEntries = String(pathEnv)
    .split(path.delimiter)
    .map(entry => entry.trim())
    .filter(Boolean);

  // Windows 平台需要处理 PATHEXT 扩展名（如 .exe, .cmd 等）
  const windowsExtensions =
    platform === 'win32'
      ? String(pathExtEnv)
        .split(';')
        .map(ext => ext.trim())
        .filter(Boolean)
      : [''];

  const seenCandidates = new Set();
  const candidates = [];

  // 遍历 PATH 中的每个目录，生成候选可执行文件路径
  for (const directory of pathEntries) {
    for (const name of LOCAL_CLI_NAMES) {
      // Windows 下需要尝试带扩展名和不带扩展名的候选
      const localCandidates =
        platform === 'win32'
          ? [name, ...windowsExtensions.map(ext => `${name}${ext.toLowerCase()}`)]
          : [name];

      for (const localCandidate of localCandidates) {
        const candidatePath = path.join(directory, localCandidate);
        const normalizedCandidate = candidatePath.toLowerCase();

        // 去重：避免重复检查相同的路径
        if (!seenCandidates.has(normalizedCandidate)) {
          seenCandidates.add(normalizedCandidate);
          candidates.push(candidatePath);
        }
      }
    }
  }

  // 按顺序尝试每个候选路径，返回第一个存在的
  for (const candidate of candidates) {
    try {
      await accessFn(candidate);
      return candidate;
    } catch {
      // 当前候选不存在，尝试下一个
    }
  }

  return null;
}

// 解析 chrome-devtools CLI 运行器：优先使用本地安装，其次尝试自动安装，最后回退到 npx
export async function resolveChromeDevtoolsCliRunner(
  {
    localCliCommand = process.env.CHROME_DEVTOOLS_CLI_COMMAND,
    npmRegistry = DEFAULT_NPM_REGISTRY,
    allowAutoInstall = !isTruthyEnvValue(process.env[DISABLE_AUTO_INSTALL_ENV_VAR]),
    packageSpec = DEFAULT_CLI_PACKAGE_SPEC,
  } = {},
  deps = {},
) {
  // 提取可注入的依赖函数，方便测试时替换
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
  const findLocalCli =
    deps.findLocalChromeDevtoolsCli ?? findLocalChromeDevtoolsCli;

  // 步骤 1：尝试查找本地已安装的 CLI 并验证其功能
  const hasExplicitLocalCliCommand = Boolean(localCliCommand);
  const resolvedLocalCliCommand =
    localCliCommand ?? (await findLocalCli());
  const localRunner = await tryResolveLocalCliRunner(resolvedLocalCliCommand, {
    execCommand,
  });

  // 如果本地 CLI 可用，直接返回
  if (localRunner) {
    return localRunner;
  }

  // 步骤 2：如果允许自动安装且没有显式指定本地命令，尝试全局安装
  if (allowAutoInstall && !hasExplicitLocalCliCommand) {
    try {
      await installChromeDevtoolsCli({
        execCommand,
        registry: npmRegistry,
        packageSpec,
      });
    } catch {
      // 安装失败则回退到 npx
    }

    // 安装后重新查找本地 CLI
    const installedLocalCliCommand = await findLocalCli();
    const installedLocalRunner = await tryResolveLocalCliRunner(installedLocalCliCommand, {
      execCommand,
    });

    if (installedLocalRunner) {
      return installedLocalRunner;
    }
  }

  // 步骤 3：本地和自动安装都不可用，回退到 npx 模式
  await ensureNpxAvailable();

  const npxRunner = createNpxCliRunner({
    execCommand,
    registry: npmRegistry,
  });
  // 获取 npx 模式的帮助信息
  const helpInfo = await learnHelpCommandsWithRunner(npxRunner);

  return {
    ...npxRunner,
    helpInfo,
  };
}

// 尝试从指定用户数据目录中发现正在运行的浏览器实例
export async function tryResolveLiveBrowserFromUserDataDir(
  userDataDir,
  {
    allowWsEndpointFallback = false,
    readDevToolsActivePortFn = readDevToolsActivePort,
    probeBrowserUrlFn = probeBrowserUrl,
  } = {},
) {
  try {
    // 读取 DevToolsActivePort 文件获取调试端口信息
    const activePort = await readDevToolsActivePortFn(userDataDir);

    try {
      // 通过 HTTP 探测验证浏览器调试端口是否可访问
      const probe = await probeBrowserUrlFn(activePort.browserUrl);

      return {
        source: 'live',
        userDataDir,
        browserUrl: probe.browserUrl,
        webSocketDebuggerUrl: probe.webSocketDebuggerUrl,
        transport: 'browserUrl',
      };
    } catch (error) {
      // HTTP 探测失败（可能端口可达但协议不兼容），尝试使用 WebSocket 直接连接
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
    // 无法读取 DevToolsActivePort 文件，说明没有运行中的浏览器实例
    return null;
  }
}

// 默认的浏览器实例发现函数
async function defaultTryResolveLiveBrowser(userDataDir, options) {
  return await tryResolveLiveBrowserFromUserDataDir(userDataDir, options);
}

// 主入口函数：确保浏览器会话可用
// 按优先级尝试：复用运行中的浏览器 → 使用备用配置文件启动新的浏览器
export async function ensureBrowserSession(
  {
    channel = 'stable',
    realUserDataDirOverride = process.env.CHROME_DEVTOOLS_CLI_USER_DATA_DIR,
    chromeExecutableOverride = process.env.CHROME_DEVTOOLS_CLI_CHROME_PATH,
    npmRegistry = DEFAULT_NPM_REGISTRY,
  } = {},
  deps = {},
) {
  // 检查 Node.js 版本是否满足最低要求
  assertSupportedNodeVersion(deps.processVersion ?? process.version);

  // 判断是否使用旧版 CLI 流程（通过 deps 注入的旧接口）
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
    // 旧版流程：直接使用注入的函数
    startCli = deps.startCli ?? (async () => { });
    startCliWithWsEndpoint = deps.startCliWithWsEndpoint ?? (async () => { });
    startCliAutoConnect = deps.startCliAutoConnect ?? (async () => { });
    await ensureNpxAvailable();
    helpInfo = (await learnHelpCommands?.()) ?? {};
  } else {
    // 新版流程：通过 resolveChromeDevtoolsCliRunner 获取 CLI 运行器
    const cliRunner = await (deps.resolveChromeDevtoolsCliRunner ?? resolveChromeDevtoolsCliRunner)(
      {
        localCliCommand: process.env.CHROME_DEVTOOLS_CLI_COMMAND,
        npmRegistry,
      },
      deps,
    );

    // 包装 startCli 方法，返回包含模式信息的结果
    startCli = async browserUrl => {
      const result = await cliRunner.startCli(browserUrl);

      return {
        mode: 'browserUrl',
        browserUrl,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      };
    };

    // 包装 startCliWithWsEndpoint 方法
    startCliWithWsEndpoint = async wsEndpoint => {
      const result = await cliRunner.startCliWithWsEndpoint(wsEndpoint);

      return {
        mode: 'wsEndpoint',
        webSocketDebuggerUrl: wsEndpoint,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      };
    };

    // 包装 startCliAutoConnect 方法
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

  // 优先级 1：如果 CLI 支持 --autoConnect，直接尝试自动连接运行中的浏览器
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

  // 检查 CLI 是否支持 --wsEndpoint 模式
  const canUseWsEndpoint = supportsStartWsEndpoint(helpInfo.startHelp);

  // 获取 Chrome 真实用户数据目录和备用配置文件目录路径
  const realUserDataDir =
    deps.realUserDataDir ??
    getRealUserDataDir({ channel, override: realUserDataDirOverride });
  const fallbackUserDataDir =
    deps.fallbackUserDataDir ?? getFallbackProfileDir({ channel });

  // 优先级 2：尝试从真实用户数据目录中发现运行中的浏览器实例
  const realBrowser = await tryResolveLiveBrowser(realUserDataDir, {
    allowWsEndpointFallback: canUseWsEndpoint,
  });
  if (realBrowser) {
    // 根据传输模式选择对应的 CLI 启动方式
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

  // 优先级 3：尝试从备用配置文件目录中发现运行中的浏览器实例
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

  // 优先级 4：没有可复用的浏览器实例，启动新的 Chrome 进程

  // 将真实用户数据同步到备用配置文件目录（避免锁定真实配置文件）
  const syncResult = await (deps.syncProfileCopy ?? syncProfileCopy)({
    sourceDir: realUserDataDir,
    targetDir: fallbackUserDataDir,
  });

  // 查找 Chrome 可执行文件路径
  const executablePath =
    deps.chromeExecutablePath ??
    (await (deps.findChromeExecutable ?? findExistingPath)(
      getChromeExecutableCandidates({
        channel,
        override: chromeExecutableOverride,
      }),
    ));

  // 获取一个空闲端口
  const port = await (deps.findFreePort ?? findFreePort)();

  // 以 detached 模式启动 Chrome
  await (deps.launchChromeDetached ?? launchChromeDetached)({
    executablePath,
    userDataDir: fallbackUserDataDir,
    port,
  });

  // 等待浏览器就绪（DevToolsActivePort 文件出现且调试端口可访问）
  const ready =
    (await (deps.waitForBrowserReady ?? waitForBrowserReady)(fallbackUserDataDir)) ?? {
      browserUrl: `http://127.0.0.1:${port}`,
    };

  // 使用 CLI 连接到新启动的浏览器
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
