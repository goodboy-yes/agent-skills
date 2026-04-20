import path from 'node:path';
import {
  copyFile,
  mkdir,
  readdir,
  rm,
  stat,
} from 'node:fs/promises';

const EXCLUDED_NAMES = new Set([
  'DevToolsActivePort',
  'SingletonCookie',
  'SingletonLock',
  'SingletonSocket',
]);

const EXCLUDED_DIRS = new Set([
  'Cache',
  'Code Cache',
  'Crashpad',
  'GPUCache',
  'GrShaderCache',
  'ShaderCache',
]);

function normalizeRelativePath(relativePath) {
  return String(relativePath).replace(/\\/g, '/');
}

export function shouldCopyProfilePath(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const parts = normalized.split('/').filter(Boolean);

  if (parts.length === 0) {
    return true;
  }

  if (parts.some(part => EXCLUDED_NAMES.has(part))) {
    return false;
  }

  if (parts.some(part => part.startsWith('Singleton'))) {
    return false;
  }

  if (parts.some(part => EXCLUDED_DIRS.has(part))) {
    return false;
  }

  return true;
}

async function copyDirectory(sourceDir, targetDir, relativeDir = '') {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryRelativePath = relativeDir
      ? `${relativeDir}/${entry.name}`
      : entry.name;

    if (!shouldCopyProfilePath(entryRelativePath)) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath, entryRelativePath);
      continue;
    }

    if (entry.isFile()) {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
    }
  }
}

export async function syncProfileCopy({ sourceDir, targetDir }) {
  try {
    const sourceStats = await stat(sourceDir);
    if (!sourceStats.isDirectory()) {
      throw new Error(`Profile source is not a directory: ${sourceDir}`);
    }

    await mkdir(targetDir, { recursive: true });
    await copyDirectory(sourceDir, targetDir);

    return {
      ok: true,
      sourceDir,
      targetDir,
    };
  } catch (error) {
    return {
      ok: false,
      sourceDir,
      targetDir,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function clearProfileCopy(targetDir) {
  await rm(targetDir, { recursive: true, force: true });
}
