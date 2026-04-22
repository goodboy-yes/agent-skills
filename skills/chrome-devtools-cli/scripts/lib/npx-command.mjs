import process from 'node:process';

// 对单个 shell 参数进行转义，适配 Windows (cmd) 和 Unix (bash) 两种平台
export function quoteShellArg(arg, { platform = process.platform } = {}) {
  const value = String(arg);

  // Windows 平台：使用双引号包裹，内部双引号转义为 ""
  if (platform === 'win32') {
    if (value.length === 0) {
      return '""';
    }

    if (/[\s"&|<>^]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }

    return value;
  }

  // Unix 平台：使用单引号包裹，内部单引号通过 '"'"' 转义
  if (value.length === 0) {
    return "''";
  }

  if (/[^A-Za-z0-9_/:=.,-]/.test(value)) {
    return `'${value.replace(/'/g, `'\"'\"'`)}'`;
  }

  return value;
}

// 将命令和参数列表拼接为完整的 shell 命令字符串
export function buildCliCommand(command, args = [], options) {
  return [command, ...args].map(arg => quoteShellArg(arg, options)).join(' ');
}

// 构造 npx 命令字符串，支持自定义 npm registry
export function buildNpxCommand(args, options = {}) {
  const { registry, ...shellOptions } = options;
  // 如果指定了 registry，添加 --registry 参数
  const registryArgs = registry ? [`--registry=${registry}`] : [];

  return buildCliCommand('npx', [...registryArgs, ...args], shellOptions);
}

// 格式化命令执行失败的错误信息，拼接 stderr、stdout 和错误消息
export function formatCommandFailure(command, error) {
  const stderr = String(error?.stderr ?? '').trim();
  const stdout = String(error?.stdout ?? '').trim();
  const message = String(error?.message ?? '').trim();
  const details = [];

  // 优先展示 stderr
  if (stderr) {
    details.push(stderr);
  }

  // 若无 stderr 则展示 stdout
  if (!stderr && stdout) {
    details.push(stdout);
  }

  // 若两者都为空则展示错误消息
  if (!stderr && !stdout && message) {
    details.push(message);
  }

  return [`Failed to run command: ${command}`, ...details].join('\n\n');
}
