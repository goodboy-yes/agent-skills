import path from 'node:path';
import {
  copyFile,
  mkdir,
  readdir,
  rm,
  stat,
} from 'node:fs/promises';

// 需要排除复制的文件名（Chrome 运行时锁文件和套接字文件）
const EXCLUDED_NAMES = new Set([
  'DevToolsActivePort',
  'SingletonCookie',
  'SingletonLock',
  'SingletonSocket',
]);

// 需要排除复制的目录名（Chrome 各类缓存目录）
const EXCLUDED_DIRS = new Set([
  'Cache',
  'Code Cache',
  'Crashpad',
  'GPUCache',
  'GrShaderCache',
  'ShaderCache',
]);

// 将反斜杠统一转换为正斜杠，确保跨平台路径一致性
function normalizeRelativePath(relativePath) {
  return String(relativePath).replace(/\\/g, '/');
}

// 判断某个相对路径是否应该被复制（排除运行时锁文件和缓存目录）
export function shouldCopyProfilePath(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const parts = normalized.split('/').filter(Boolean);

  if (parts.length === 0) {
    return true;
  }

  // 排除已知的运行时文件
  if (parts.some(part => EXCLUDED_NAMES.has(part))) {
    return false;
  }

  // 排除以 Singleton 开头的文件（Chrome 实例锁）
  if (parts.some(part => part.startsWith('Singleton'))) {
    return false;
  }

  // 排除缓存目录
  if (parts.some(part => EXCLUDED_DIRS.has(part))) {
    return false;
  }

  return true;
}

// 递归复制目录，跳过不需要的文件和目录
async function copyDirectory(sourceDir, targetDir, relativeDir = '') {
  // 确保目标目录存在
  await mkdir(targetDir, { recursive: true });
  // 读取源目录下所有条目
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    // 计算当前条目的相对路径
    const entryRelativePath = relativeDir
      ? `${relativeDir}/${entry.name}`
      : entry.name;

    // 检查是否应该跳过该条目
    if (!shouldCopyProfilePath(entryRelativePath)) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    // 如果是子目录则递归复制
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath, entryRelativePath);
      continue;
    }

    // 如果是文件则确保目标目录存在后复制
    if (entry.isFile()) {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
    }
  }
}

// 将 Chrome 真实用户数据目录同步到备用配置文件目录（用于独立启动）
export async function syncProfileCopy({ sourceDir, targetDir }) {
  try {
    // 校验源目录存在且为目录
    const sourceStats = await stat(sourceDir);
    if (!sourceStats.isDirectory()) {
      throw new Error(`Profile source is not a directory: ${sourceDir}`);
    }

    // 创建目标目录并递归复制
    await mkdir(targetDir, { recursive: true });
    await copyDirectory(sourceDir, targetDir);

    return {
      ok: true,
      sourceDir,
      targetDir,
    };
  } catch (error) {
    // 复制失败时返回错误信息而不是抛出异常
    return {
      ok: false,
      sourceDir,
      targetDir,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// 清除备用配置文件目录
export async function clearProfileCopy(targetDir) {
  await rm(targetDir, { recursive: true, force: true });
}
