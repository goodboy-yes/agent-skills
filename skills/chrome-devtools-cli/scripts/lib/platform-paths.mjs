import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

// 支持的 Chrome 发布渠道
const CHANNELS = new Set(['stable', 'beta', 'dev', 'canary']);

// 规范化渠道名称，并校验是否在支持范围内
export function normalizeChannel(channel = 'stable') {
  const normalized = String(channel).trim().toLowerCase() || 'stable';

  if (!CHANNELS.has(normalized)) {
    throw new Error(`Unsupported Chrome channel: ${channel}`);
  }

  return normalized;
}

// 获取 Chrome 真实的用户数据目录（User Data），根据平台和渠道返回不同路径
export function getRealUserDataDir({
  platform = process.platform,
  homeDir = os.homedir(),
  localAppData = process.env.LOCALAPPDATA,
  override,
  channel = 'stable',
} = {}) {
  // 如果通过环境变量显式指定了路径，直接使用
  if (override) {
    return override;
  }

  const normalized = normalizeChannel(channel);

  // Windows 平台：Chrome 用户数据位于 %LOCALAPPDATA% 下
  if (platform === 'win32') {
    const baseDir = localAppData ?? path.join(homeDir, 'AppData', 'Local');
    const suffix = {
      stable: ['Google', 'Chrome', 'User Data'],
      beta: ['Google', 'Chrome Beta', 'User Data'],
      dev: ['Google', 'Chrome Dev', 'User Data'],
      canary: ['Google', 'Chrome SxS', 'User Data'],
    }[normalized];

    return path.join(baseDir, ...suffix);
  }

  // macOS 平台：Chrome 用户数据位于 ~/Library/Application Support 下
  if (platform === 'darwin') {
    const suffix = {
      stable: ['Library', 'Application Support', 'Google', 'Chrome'],
      beta: ['Library', 'Application Support', 'Google', 'Chrome Beta'],
      dev: ['Library', 'Application Support', 'Google', 'Chrome Dev'],
      canary: ['Library', 'Application Support', 'Google', 'Chrome Canary'],
    }[normalized];

    return path.join(homeDir, ...suffix);
  }

  // Linux 平台：Chrome 用户数据位于 ~/.config 下
  const suffix = {
    stable: ['.config', 'google-chrome'],
    beta: ['.config', 'google-chrome-beta'],
    dev: ['.config', 'google-chrome-unstable'],
    canary: ['.config', 'google-chrome-canary'],
  }[normalized];

  return path.join(homeDir, ...suffix);
}

// 获取 Chrome 可执行文件的候选路径列表，根据平台和渠道返回不同的候选位置
export function getChromeExecutableCandidates({
  platform = process.platform,
  programFiles = process.env.ProgramFiles ?? 'C:\\Program Files',
  programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
  override,
  channel = 'stable',
} = {}) {
  // 如果通过环境变量显式指定了可执行文件路径，直接使用
  if (override) {
    return [override];
  }

  const normalized = normalizeChannel(channel);

  // Windows 平台：查找 Program Files 和 Program Files (x86) 两个位置
  if (platform === 'win32') {
    const relative = {
      stable: ['Google', 'Chrome', 'Application', 'chrome.exe'],
      beta: ['Google', 'Chrome Beta', 'Application', 'chrome.exe'],
      dev: ['Google', 'Chrome Dev', 'Application', 'chrome.exe'],
      canary: ['Google', 'Chrome SxS', 'Application', 'chrome.exe'],
    }[normalized];

    return [
      path.join(programFiles, ...relative),
      path.join(programFilesX86, ...relative),
    ];
  }

  // macOS 平台：查找 /Applications 下的 .app 包
  if (platform === 'darwin') {
    return [
      {
        stable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        beta: '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
        dev: '/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev',
        canary:
          '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      }[normalized],
    ];
  }

  // Linux 平台：查找 /usr/bin 下的可执行文件
  return {
    stable: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
    beta: ['/usr/bin/google-chrome-beta'],
    dev: ['/usr/bin/google-chrome-unstable'],
    canary: ['/usr/bin/google-chrome-canary'],
  }[normalized];
}
