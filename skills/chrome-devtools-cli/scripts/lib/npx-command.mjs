export function quoteShellArg(arg, { platform = process.platform } = {}) {
  const value = String(arg);

  if (platform === 'win32') {
    if (value.length === 0) {
      return '""';
    }

    if (/[\s"&|<>^]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }

    return value;
  }

  if (value.length === 0) {
    return "''";
  }

  if (/[^A-Za-z0-9_/:=.,-]/.test(value)) {
    return `'${value.replace(/'/g, `'\"'\"'`)}'`;
  }

  return value;
}

export function buildCliCommand(command, args = [], options) {
  return [command, ...args].map(arg => quoteShellArg(arg, options)).join(' ');
}

export function buildNpxCommand(args, options = {}) {
  const { registry, ...shellOptions } = options;
  const registryArgs = registry ? [`--registry=${registry}`] : [];

  return buildCliCommand('npx', [...registryArgs, ...args], shellOptions);
}

export function formatCommandFailure(command, error) {
  const stderr = String(error?.stderr ?? '').trim();
  const stdout = String(error?.stdout ?? '').trim();
  const message = String(error?.message ?? '').trim();
  const details = [];

  if (stderr) {
    details.push(stderr);
  }

  if (!stderr && stdout) {
    details.push(stdout);
  }

  if (!stderr && !stdout && message) {
    details.push(message);
  }

  return [`Failed to run command: ${command}`, ...details].join('\n\n');
}
