import { resolveChromeDevtoolsCliRunner } from './lib/cli-runner.mjs';
import { runJsonCliScript } from './lib/script-runtime.mjs';

// 判断停止 CLI 时出现的错误是否可以忽略（如 CLI 未运行、无守护进程等）
function canIgnoreStopError(error) {
  const text = `${error?.message ?? ''}\n${error?.stdout ?? ''}\n${error?.stderr ?? ''}`;
  return /not running|no daemon|no active/i.test(text);
}

await runJsonCliScript(import.meta.url, async () => {
  try {
    const cliRunner = await resolveChromeDevtoolsCliRunner({
      allowAutoInstall: false,
    });
    await cliRunner.stopCli();

    return {
      stopped: true,
    };
  } catch (error) {
    if (!canIgnoreStopError(error)) {
      throw error;
    }

    return {
      stopped: false,
      ignored: true,
    };
  }
});
