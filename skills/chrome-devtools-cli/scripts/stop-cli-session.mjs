import process from 'node:process';
import { resolveChromeDevtoolsCliRunner } from './lib/session-manager.mjs';

// 判断停止 CLI 时出现的错误是否可以忽略（如 CLI 未运行、无守护进程等）
function canIgnoreStopError(error) {
  const text = `${error?.message ?? ''}\n${error?.stdout ?? ''}\n${error?.stderr ?? ''}`;
  return /not running|no daemon|no active/i.test(text);
}

try {
  // 解析 CLI 运行器（禁止自动安装，仅使用本地已有的）
  const cliRunner = await resolveChromeDevtoolsCliRunner({
    allowAutoInstall: false,
  });

  // 执行停止命令
  await cliRunner.stopCli();
} catch (error) {
  // 如果是"未运行"类的错误则忽略，否则输出错误并以非零退出码退出
  if (!canIgnoreStopError(error)) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
