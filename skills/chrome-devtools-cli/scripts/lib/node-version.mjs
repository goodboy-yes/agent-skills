import { access, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

// 解析版本号字符串（如 "v22.12.0"）为 { major, minor, patch } 结构
export function parseNodeVersion(versionText) {
  // 去除前导 "v" 并按 "." 分割，提取主版本号、次版本号、修订号
  const cleaned = String(versionText).trim().replace(/^v/, '');
  const [majorText = '0', minorText = '0', patchText = '0'] = cleaned.split('.');

  return {
    major: Number.parseInt(majorText, 10),
    minor: Number.parseInt(minorText, 10),
    patch: Number.parseInt(patchText, 10),
  };
}

// 判断当前 Node.js 版本是否在支持范围内：^20.19.0 || ^22.12.0 || >=23
export function isSupportedNodeVersion(version) {
  // Node 23+ 全部支持
  if (version.major >= 23) {
    return true;
  }

  // Node 22 需要至少 22.12.0
  if (version.major === 22) {
    return version.minor >= 12;
  }

  // Node 20 需要至少 20.19.0
  if (version.major === 20) {
    return version.minor >= 19;
  }

  // 其他版本一律不支持
  return false;
}

// 将版本对象格式化为 "vX.Y.Z" 形式
function formatVersion(version) {
  return `v${version.major}.${version.minor}.${version.patch}`;
}

function compareNodeVersions(left, right) {
  if (left.major !== right.major) {
    return left.major - right.major;
  }

  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }

  return left.patch - right.patch;
}

function getNvmRoots({
  platform = process.platform,
  homeDir = os.homedir(),
  nvmHome,
} = {}) {
  if (nvmHome) {
    return [nvmHome];
  }

  if (platform === 'win32') {
    return [
      path.join(homeDir, 'AppData', 'Roaming', 'nvm'),
      path.join(homeDir, 'nvm'),
      'C:\\nvm',
    ];
  }

  return [path.join(homeDir, '.nvm', 'versions', 'node')];
}

function getNodeBinaryPath(versionDir, { platform = process.platform } = {}) {
  return platform === 'win32'
    ? path.join(versionDir, 'node.exe')
    : path.join(versionDir, 'bin', 'node');
}

// 断言当前 Node.js 版本满足最低要求，不满足则抛出错误
export function assertSupportedNodeVersion(versionText) {
  // 如果传入的是字符串则先解析为版本对象
  const version =
    typeof versionText === 'string' ? parseNodeVersion(versionText) : versionText;

  // 校验解析结果是否为有效整数
  if (
    !Number.isInteger(version.major) ||
    !Number.isInteger(version.minor) ||
    !Number.isInteger(version.patch)
  ) {
    throw new Error(`Unable to parse the current Node version: ${versionText}`);
  }

  // 检查版本是否在支持范围内
  if (!isSupportedNodeVersion(version)) {
    throw new Error(
      `chrome-devtools-mcp requires Node ^20.19.0 || ^22.12.0 || >=23, current version is ${formatVersion(version)}`,
    );
  }

  return version;
}

export async function findSupportedNodeExecutableFromNvm(
  {
    platform = process.platform,
    homeDir = os.homedir(),
    nvmHome = process.env.NVM_HOME,
    readdirFn = readdir,
    accessFn = access,
  } = {},
) {
  for (const rootDir of getNvmRoots({ platform, homeDir, nvmHome })) {
    let entries;

    try {
      entries = await readdirFn(rootDir, { withFileTypes: true });
    } catch {
      continue;
    }

    const supportedVersions = entries
      .filter(entry => entry?.isDirectory?.())
      .map(entry => ({
        name: entry.name,
        version: parseNodeVersion(entry.name),
        versionDir: path.join(rootDir, entry.name),
      }))
      .filter(candidate => isSupportedNodeVersion(candidate.version))
      .sort((left, right) => compareNodeVersions(right.version, left.version));

    for (const candidate of supportedVersions) {
      const binaryPath = getNodeBinaryPath(candidate.versionDir, { platform });

      try {
        await accessFn(binaryPath);
        return binaryPath;
      } catch {
        // 当前候选不可用，继续尝试下一个
      }
    }
  }

  return null;
}
