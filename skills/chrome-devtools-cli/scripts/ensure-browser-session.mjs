import process from 'node:process';

import { ensureBrowserSession } from './lib/session-manager.mjs';

// 入口脚本：确保浏览器会话可用并以 JSON 格式输出结果
try {
  // 调用 ensureBrowserSession，通过环境变量 CHROME_DEVTOOLS_CLI_CHANNEL 指定 Chrome 渠道
  const result = await ensureBrowserSession({
    channel: process.env.CHROME_DEVTOOLS_CLI_CHANNEL ?? 'stable',
  });

  // 以格式化的 JSON 输出结果
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  // 输出错误信息并以非零退出码退出
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
