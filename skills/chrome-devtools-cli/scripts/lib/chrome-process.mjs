import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

import { readDevToolsActivePort } from './devtools-active-port.mjs';
import { probeBrowserUrl } from './http-probe.mjs';

// 延时工具函数，用于轮询等待
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 从候选路径列表中查找第一个存在的 Chrome 可执行文件
export async function findExistingPath(candidates) {
  for (const candidate of candidates) {
    try {
      // 检查文件是否可访问
      await access(candidate);
      return candidate;
    } catch {
      // 当前候选不存在，尝试下一个
    }
  }

  throw new Error(`Unable to find a Chrome executable from: ${candidates.join(', ')}`);
}

// 通过创建临时 TCP 服务器获取一个系统分配的空闲端口
export async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();

    server.on('error', reject);
    // 监听端口 0 让系统自动分配空闲端口，绑定到 127.0.0.1
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to allocate a local debugging port'));
        return;
      }

      // 获取分配的端口号后立即关闭服务器以释放端口
      const { port } = address;
      server.close(error => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

// 以 detached（独立）模式启动 Chrome 进程，使其在父进程退出后继续运行
export function launchChromeDetached({
  executablePath,
  userDataDir,
  port,
  extraArgs = [],
}) {
  // 构造 Chrome 启动参数
  const args = [
    `--remote-debugging-port=${port}`,    // 开启远程调试端口
    `--user-data-dir=${userDataDir}`,     // 指定用户数据目录
    '--no-first-run',                     // 跳过首次运行向导
    '--no-default-browser-check',         // 跳过默认浏览器检查
    ...extraArgs,                         // 额外自定义参数
  ];

  // 以 detached 模式启动 Chrome，忽略 stdio 输出
  const child = spawn(executablePath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,                    // Windows 下隐藏控制台窗口
  });

  // 解除父进程对子进程的引用，使其成为独立进程
  child.unref();

  return {
    pid: child.pid,
    args,
  };
}

// 轮询等待 DevToolsActivePort 文件出现，直到超时
export async function waitForDevToolsActivePort(userDataDir, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  // 每 250ms 轮询一次，直到超时
  while (Date.now() < deadline) {
    try {
      return await readDevToolsActivePort(userDataDir);
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }

  // 超时后抛出错误
  const filePath = path.join(userDataDir, 'DevToolsActivePort');
  throw new Error(
    `Timed out waiting for DevToolsActivePort: ${filePath}${lastError ? `; last error: ${lastError.message}` : ''}`,
  );
}

// 等待浏览器完全就绪：先等待 DevToolsActivePort 文件出现，再探测调试端口可用
export async function waitForBrowserReady(userDataDir, timeoutMs = 15000) {
  // 先等待 DevToolsActivePort 文件写入完成
  const activePort = await waitForDevToolsActivePort(userDataDir, timeoutMs);
  // 再通过 HTTP 探测确认调试端口可正常访问
  return await probeBrowserUrl(activePort.browserUrl, timeoutMs);
}
