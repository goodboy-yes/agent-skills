import http from 'node:http';

// 通过 HTTP 请求探测浏览器调试端口是否可用，并获取 WebSocket 调试地址
export async function probeBrowserUrl(browserUrl, timeoutMs = 1500) {
  // 规范化 URL（去除末尾斜杠），构造 /json/version 端点地址
  const normalizedBrowserUrl = String(browserUrl).replace(/\/$/, '');
  const versionUrl = new URL('/json/version', `${normalizedBrowserUrl}/`);

  // 发起 GET 请求获取浏览器版本信息
  const payload = await new Promise((resolve, reject) => {
    const req = http.get(versionUrl, res => {
      let body = '';

      // 逐步接收响应数据
      res.on('data', chunk => {
        body += chunk;
      });

      // 响应结束后校验状态码
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Browser probe failed with status ${res.statusCode}`));
          return;
        }

        resolve(body);
      });
    });

    // 设置超时，超时后销毁请求
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Browser probe timed out: ${versionUrl.href}`));
    });

    req.on('error', reject);
  });

  // 解析 JSON 响应，提取 webSocketDebuggerUrl
  const data = JSON.parse(payload);
  if (!data.webSocketDebuggerUrl) {
    throw new Error(`Browser probe response is missing webSocketDebuggerUrl: ${payload}`);
  }

  return {
    ok: true,
    browserUrl: normalizedBrowserUrl,
    browserVersion: data.Browser ?? 'unknown',
    webSocketDebuggerUrl: data.webSocketDebuggerUrl,
    raw: data,
  };
}
