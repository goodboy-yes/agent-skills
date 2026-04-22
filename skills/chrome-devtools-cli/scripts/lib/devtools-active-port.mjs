import { readFile } from 'node:fs/promises';
import path from 'node:path';

// 解析 DevToolsActivePort 文件内容，提取调试端口号和 WebSocket 路径
export function parseDevToolsActivePort(fileContent) {
  // 文件格式：第一行为端口号，第二行为 WebSocket 路径
  const [rawPort, rawPath] = String(fileContent)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const port = Number.parseInt(rawPort, 10);

  // 校验端口号和路径是否有效
  if (!rawPort || !rawPath || Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid DevToolsActivePort contents: ${JSON.stringify(fileContent)}`);
  }

  // 构造 HTTP 调试地址和 WebSocket 调试地址
  return {
    port,
    path: rawPath,
    browserUrl: `http://127.0.0.1:${port}`,
    webSocketDebuggerUrl: `ws://127.0.0.1:${port}${rawPath}`,
  };
}

// 从 Chrome 用户数据目录中读取 DevToolsActivePort 文件并解析
export async function readDevToolsActivePort(userDataDir) {
  // DevToolsActivePort 文件位于用户数据目录根目录下
  const filePath = path.join(userDataDir, 'DevToolsActivePort');
  const fileContent = await readFile(filePath, 'utf8');

  return {
    filePath,
    ...parseDevToolsActivePort(fileContent),
  };
}
