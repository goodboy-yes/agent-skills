import http from 'node:http';

export async function probeBrowserUrl(browserUrl, timeoutMs = 1500) {
  const normalizedBrowserUrl = String(browserUrl).replace(/\/$/, '');
  const versionUrl = new URL('/json/version', `${normalizedBrowserUrl}/`);

  const payload = await new Promise((resolve, reject) => {
    const req = http.get(versionUrl, res => {
      let body = '';

      res.on('data', chunk => {
        body += chunk;
      });

      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Browser probe failed with status ${res.statusCode}`));
          return;
        }

        resolve(body);
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Browser probe timed out: ${versionUrl.href}`));
    });

    req.on('error', reject);
  });

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
