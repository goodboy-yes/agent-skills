import os from 'node:os';
import path from 'node:path';

const CHANNELS = new Set(['stable', 'beta', 'dev', 'canary']);

export function normalizeChannel(channel = 'stable') {
  const normalized = String(channel).trim().toLowerCase() || 'stable';

  if (!CHANNELS.has(normalized)) {
    throw new Error(`Unsupported Chrome channel: ${channel}`);
  }

  return normalized;
}

export function getFallbackProfileDir({
  homeDir = os.homedir(),
  channel = 'stable',
} = {}) {
  const normalized = normalizeChannel(channel);
  const profileDirName =
    normalized === 'stable' ? 'chrome-profile' : `chrome-profile-${normalized}`;

  return path.join(homeDir, '.cache', 'chrome-devtools-mcp-cli', profileDirName);
}

export function getRealUserDataDir({
  platform = process.platform,
  homeDir = os.homedir(),
  localAppData = process.env.LOCALAPPDATA,
  override,
  channel = 'stable',
} = {}) {
  if (override) {
    return override;
  }

  const normalized = normalizeChannel(channel);

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

  if (platform === 'darwin') {
    const suffix = {
      stable: ['Library', 'Application Support', 'Google', 'Chrome'],
      beta: ['Library', 'Application Support', 'Google', 'Chrome Beta'],
      dev: ['Library', 'Application Support', 'Google', 'Chrome Dev'],
      canary: ['Library', 'Application Support', 'Google', 'Chrome Canary'],
    }[normalized];

    return path.join(homeDir, ...suffix);
  }

  const suffix = {
    stable: ['.config', 'google-chrome'],
    beta: ['.config', 'google-chrome-beta'],
    dev: ['.config', 'google-chrome-unstable'],
    canary: ['.config', 'google-chrome-canary'],
  }[normalized];

  return path.join(homeDir, ...suffix);
}

export function getChromeExecutableCandidates({
  platform = process.platform,
  programFiles = process.env.ProgramFiles ?? 'C:\\Program Files',
  programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
  override,
  channel = 'stable',
} = {}) {
  if (override) {
    return [override];
  }

  const normalized = normalizeChannel(channel);

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

  return {
    stable: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
    beta: ['/usr/bin/google-chrome-beta'],
    dev: ['/usr/bin/google-chrome-unstable'],
    canary: ['/usr/bin/google-chrome-canary'],
  }[normalized];
}
