# Chrome DevTools CLI Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 `chrome-devtools-cli` skill，让 agent 在需要真实浏览器能力时，无需手动配置 MCP 即可通过 Chrome DevTools CLI 复用现有 Chrome 或启动固定 profile 的 fallback Chrome。

**Architecture:** 采用“轻量 skill 文档 + Node 标准库脚本”的结构。`SKILL.md` 负责触发语义和使用规则，`scripts/` 负责 Node 版本预检、Chrome 路径解析、`DevToolsActivePort` 探测、profile 同步、fallback 浏览器启动以及 CLI daemon 的启动/停止编排。测试使用 Node 内置 `node:test`，避免引入额外依赖。

**Tech Stack:** Markdown skill 文件、Node.js 20+ 标准库、`node:test`、`npx -p chrome-devtools-mcp@latest chrome-devtools`

---

## 文件结构

### 新建文件

- `skills/chrome-devtools-cli/SKILL.md`
- `skills/chrome-devtools-cli/references/cli-quick-reference.md`
- `skills/chrome-devtools-cli/references/profile-strategy.md`
- `skills/chrome-devtools-cli/scripts/ensure-browser-session.mjs`
- `skills/chrome-devtools-cli/scripts/stop-cli-session.mjs`
- `skills/chrome-devtools-cli/scripts/lib/node-version.mjs`
- `skills/chrome-devtools-cli/scripts/lib/platform-paths.mjs`
- `skills/chrome-devtools-cli/scripts/lib/devtools-active-port.mjs`
- `skills/chrome-devtools-cli/scripts/lib/http-probe.mjs`
- `skills/chrome-devtools-cli/scripts/lib/profile-sync.mjs`
- `skills/chrome-devtools-cli/scripts/lib/chrome-process.mjs`
- `skills/chrome-devtools-cli/scripts/lib/session-manager.mjs`
- `skills/chrome-devtools-cli/tests/node-version.test.mjs`
- `skills/chrome-devtools-cli/tests/platform-paths.test.mjs`
- `skills/chrome-devtools-cli/tests/devtools-active-port.test.mjs`
- `skills/chrome-devtools-cli/tests/profile-sync.test.mjs`
- `skills/chrome-devtools-cli/tests/session-manager.test.mjs`

### 修改文件

- `README.md`

### 责任划分

- `SKILL.md`：定义触发条件、help 学习规则、启动脚本和停止脚本的使用方式。
- `references/cli-quick-reference.md`：收纳 CLI 命令模式、帮助命令和常见工作流。
- `references/profile-strategy.md`：解释真实 profile、固定 fallback profile、同步策略和清理边界。
- `scripts/lib/node-version.mjs`：Node 版本解析与兼容性校验。
- `scripts/lib/platform-paths.mjs`：解析真实 Chrome user data dir、fallback 目录和可执行文件候选路径。
- `scripts/lib/devtools-active-port.mjs`：读取并解析 `DevToolsActivePort`。
- `scripts/lib/http-probe.mjs`：通过 `/json/version` 验证 `browserUrl` 是否可连接。
- `scripts/lib/profile-sync.mjs`：best-effort 同步 profile，排除锁文件和缓存。
- `scripts/lib/chrome-process.mjs`：选择空闲端口、启动 fallback Chrome、等待浏览器就绪。
- `scripts/lib/session-manager.mjs`：串联“预检 → 复用真实 Chrome → 复用 fallback Chrome → 同步 → 启动 fallback → 启动 CLI”。
- `scripts/ensure-browser-session.mjs`：CLI 包装入口，输出 JSON 结果。
- `scripts/stop-cli-session.mjs`：停止 `chrome-devtools` daemon，但不关闭浏览器。
- `tests/*.test.mjs`：覆盖纯逻辑和编排分支，避免第一版行为漂移。

## Task 1: Node 版本门禁

**Files:**
- Create: `skills/chrome-devtools-cli/scripts/lib/node-version.mjs`
- Test: `skills/chrome-devtools-cli/tests/node-version.test.mjs`

- [ ] **Step 1: 写失败测试**

```js
// skills/chrome-devtools-cli/tests/node-version.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertSupportedNodeVersion,
  isSupportedNodeVersion,
  parseNodeVersion,
} from '../scripts/lib/node-version.mjs';

test('parseNodeVersion 解析带 v 前缀的版本号', () => {
  assert.deepEqual(parseNodeVersion('v20.19.1'), {
    major: 20,
    minor: 19,
    patch: 1,
  });
});

test('isSupportedNodeVersion 接受 20.19+', () => {
  assert.equal(isSupportedNodeVersion({ major: 20, minor: 19, patch: 0 }), true);
  assert.equal(isSupportedNodeVersion({ major: 20, minor: 18, patch: 9 }), false);
});

test('isSupportedNodeVersion 接受 22.12+ 和 23+', () => {
  assert.equal(isSupportedNodeVersion({ major: 22, minor: 12, patch: 0 }), true);
  assert.equal(isSupportedNodeVersion({ major: 22, minor: 11, patch: 9 }), false);
  assert.equal(isSupportedNodeVersion({ major: 23, minor: 0, patch: 0 }), true);
});

test('assertSupportedNodeVersion 对不兼容版本抛出明确错误', () => {
  assert.throws(
    () => assertSupportedNodeVersion('v18.20.0'),
    /chrome-devtools-mcp 需要 Node \^20\.19\.0 \|\| \^22\.12\.0 \|\| >=23/
  );
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test skills/chrome-devtools-cli/tests/node-version.test.mjs`  
Expected: FAIL，提示 `ERR_MODULE_NOT_FOUND`，因为 `scripts/lib/node-version.mjs` 还不存在。

- [ ] **Step 3: 写最小实现**

```js
// skills/chrome-devtools-cli/scripts/lib/node-version.mjs
export function parseNodeVersion(versionText) {
  const cleaned = versionText.trim().replace(/^v/, '');
  const [majorText = '0', minorText = '0', patchText = '0'] = cleaned.split('.');

  return {
    major: Number(majorText),
    minor: Number(minorText),
    patch: Number(patchText),
  };
}

export function isSupportedNodeVersion(version) {
  if (version.major >= 23) {
    return true;
  }

  if (version.major === 22) {
    return version.minor >= 12;
  }

  if (version.major === 20) {
    return version.minor >= 19;
  }

  return false;
}

function formatVersion(version) {
  return `v${version.major}.${version.minor}.${version.patch}`;
}

export function assertSupportedNodeVersion(versionText) {
  const version =
    typeof versionText === 'string' ? parseNodeVersion(versionText) : versionText;

  if (
    !Number.isInteger(version.major) ||
    !Number.isInteger(version.minor) ||
    !Number.isInteger(version.patch)
  ) {
    throw new Error(`无法解析 Node 版本: ${versionText}`);
  }

  if (!isSupportedNodeVersion(version)) {
    throw new Error(
      `chrome-devtools-mcp 需要 Node ^20.19.0 || ^22.12.0 || >=23，当前为 ${formatVersion(version)}`
    );
  }

  return version;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test skills/chrome-devtools-cli/tests/node-version.test.mjs`  
Expected: PASS，4 个测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add skills/chrome-devtools-cli/scripts/lib/node-version.mjs skills/chrome-devtools-cli/tests/node-version.test.mjs
git commit -m "feat: add node version guard for chrome devtools skill"
```

## Task 2: 平台路径解析

**Files:**
- Create: `skills/chrome-devtools-cli/scripts/lib/platform-paths.mjs`
- Test: `skills/chrome-devtools-cli/tests/platform-paths.test.mjs`

- [ ] **Step 1: 写失败测试**

```js
// skills/chrome-devtools-cli/tests/platform-paths.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  getChromeExecutableCandidates,
  getFallbackProfileDir,
  getRealUserDataDir,
  normalizeChannel,
} from '../scripts/lib/platform-paths.mjs';

test('normalizeChannel 默认返回 stable', () => {
  assert.equal(normalizeChannel(), 'stable');
});

test('getFallbackProfileDir 为 stable 使用 chrome-profile', () => {
  assert.equal(
    getFallbackProfileDir({ homeDir: '/Users/demo', channel: 'stable' }),
    path.join('/Users/demo', '.cache', 'chrome-devtools-mcp-cli', 'chrome-profile')
  );
});

test('getFallbackProfileDir 为 beta 使用带 channel 后缀的目录', () => {
  assert.equal(
    getFallbackProfileDir({ homeDir: '/Users/demo', channel: 'beta' }),
    path.join('/Users/demo', '.cache', 'chrome-devtools-mcp-cli', 'chrome-profile-beta')
  );
});

test('getRealUserDataDir 为 Windows stable 返回默认目录', () => {
  assert.equal(
    getRealUserDataDir({
      platform: 'win32',
      homeDir: 'C:\\Users\\demo',
      localAppData: 'C:\\Users\\demo\\AppData\\Local',
      channel: 'stable',
    }),
    path.join('C:\\Users\\demo\\AppData\\Local', 'Google', 'Chrome', 'User Data')
  );
});

test('getRealUserDataDir 支持 override', () => {
  assert.equal(
    getRealUserDataDir({
      platform: 'linux',
      homeDir: '/home/demo',
      override: '/tmp/custom-profile',
      channel: 'stable',
    }),
    '/tmp/custom-profile'
  );
});

test('getChromeExecutableCandidates 为 macOS stable 返回 Chrome.app 路径', () => {
  const candidates = getChromeExecutableCandidates({
    platform: 'darwin',
    homeDir: '/Users/demo',
    channel: 'stable',
  });

  assert.equal(
    candidates[0],
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  );
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test skills/chrome-devtools-cli/tests/platform-paths.test.mjs`  
Expected: FAIL，提示 `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 写最小实现**

```js
// skills/chrome-devtools-cli/scripts/lib/platform-paths.mjs
import os from 'node:os';
import path from 'node:path';

const CHANNELS = new Set(['stable', 'beta', 'dev', 'canary']);

export function normalizeChannel(channel = 'stable') {
  if (!CHANNELS.has(channel)) {
    throw new Error(`不支持的 Chrome channel: ${channel}`);
  }

  return channel;
}

export function getFallbackProfileDir({
  homeDir = os.homedir(),
  channel = 'stable',
} = {}) {
  const normalized = normalizeChannel(channel);
  const profileDirName =
    normalized === 'stable' ? 'chrome-profile' : `chrome-profile-${normalized}`;

  return path.join(homeDir, '.cache', 'chrome-devtools-mcp-cli', profileDirName);
}

export function getRealUserDataDir({
  platform = process.platform,
  homeDir = os.homedir(),
  localAppData = process.env.LOCALAPPDATA,
  override,
  channel = 'stable',
} = {}) {
  if (override) {
    return override;
  }

  const normalized = normalizeChannel(channel);

  if (platform === 'win32') {
    const baseDir = localAppData ?? path.join(homeDir, 'AppData', 'Local');
    const suffix = {
      stable: ['Google', 'Chrome', 'User Data'],
      beta: ['Google', 'Chrome Beta', 'User Data'],
      dev: ['Google', 'Chrome Dev', 'User Data'],
      canary: ['Google', 'Chrome SxS', 'User Data'],
    }[normalized];

    return path.join(baseDir, ...suffix);
  }

  if (platform === 'darwin') {
    const suffix = {
      stable: ['Library', 'Application Support', 'Google', 'Chrome'],
      beta: ['Library', 'Application Support', 'Google', 'Chrome Beta'],
      dev: ['Library', 'Application Support', 'Google', 'Chrome Dev'],
      canary: ['Library', 'Application Support', 'Google', 'Chrome Canary'],
    }[normalized];

    return path.join(homeDir, ...suffix);
  }

  const suffix = {
    stable: ['.config', 'google-chrome'],
    beta: ['.config', 'google-chrome-beta'],
    dev: ['.config', 'google-chrome-unstable'],
    canary: ['.config', 'google-chrome-canary'],
  }[normalized];

  return path.join(homeDir, ...suffix);
}

export function getChromeExecutableCandidates({
  platform = process.platform,
  programFiles = process.env.ProgramFiles ?? 'C:\\Program Files',
  programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
  override,
  channel = 'stable',
} = {}) {
  if (override) {
    return [override];
  }

  const normalized = normalizeChannel(channel);

  if (platform === 'win32') {
    const relative = {
      stable: ['Google', 'Chrome', 'Application', 'chrome.exe'],
      beta: ['Google', 'Chrome Beta', 'Application', 'chrome.exe'],
      dev: ['Google', 'Chrome Dev', 'Application', 'chrome.exe'],
      canary: ['Google', 'Chrome SxS', 'Application', 'chrome.exe'],
    }[normalized];

    return [
      path.join(programFiles, ...relative),
      path.join(programFilesX86, ...relative),
    ];
  }

  if (platform === 'darwin') {
    return [
      {
        stable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        beta: '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
        dev: '/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev',
        canary:
          '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      }[normalized],
    ];
  }

  return {
    stable: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
    beta: ['/usr/bin/google-chrome-beta'],
    dev: ['/usr/bin/google-chrome-unstable'],
    canary: ['/usr/bin/google-chrome-canary'],
  }[normalized];
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test skills/chrome-devtools-cli/tests/platform-paths.test.mjs`  
Expected: PASS，6 个测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add skills/chrome-devtools-cli/scripts/lib/platform-paths.mjs skills/chrome-devtools-cli/tests/platform-paths.test.mjs
git commit -m "feat: add chrome path resolution helpers"
```

## Task 3: `DevToolsActivePort` 解析与 endpoint 探测

**Files:**
- Create: `skills/chrome-devtools-cli/scripts/lib/devtools-active-port.mjs`
- Create: `skills/chrome-devtools-cli/scripts/lib/http-probe.mjs`
- Test: `skills/chrome-devtools-cli/tests/devtools-active-port.test.mjs`

- [ ] **Step 1: 写失败测试**

```js
// skills/chrome-devtools-cli/tests/devtools-active-port.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  parseDevToolsActivePort,
  readDevToolsActivePort,
} from '../scripts/lib/devtools-active-port.mjs';
import { probeBrowserUrl } from '../scripts/lib/http-probe.mjs';

test('parseDevToolsActivePort 解析端口和 ws 路径', () => {
  const result = parseDevToolsActivePort('9222\n/devtools/browser/abc\n');

  assert.equal(result.port, 9222);
  assert.equal(result.browserUrl, 'http://127.0.0.1:9222');
  assert.equal(result.webSocketDebuggerUrl, 'ws://127.0.0.1:9222/devtools/browser/abc');
});

test('readDevToolsActivePort 从目录读取文件', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'cdt-port-'));
  await writeFile(
    path.join(tempDir, 'DevToolsActivePort'),
    '9333\n/devtools/browser/xyz\n',
    'utf8'
  );

  const result = await readDevToolsActivePort(tempDir);
  assert.equal(result.port, 9333);
});

test('probeBrowserUrl 对 /json/version 成功响应返回 ok', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/json/version') {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          Browser: 'Chrome/144.0.0.0',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9321/devtools/browser/demo',
        })
      );
      return;
    }

    res.statusCode = 404;
    res.end('not found');
  });

  await new Promise(resolve => server.listen(9321, '127.0.0.1', resolve));

  try {
    const result = await probeBrowserUrl('http://127.0.0.1:9321');
    assert.equal(result.ok, true);
    assert.match(result.browserVersion, /Chrome\/144/);
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test skills/chrome-devtools-cli/tests/devtools-active-port.test.mjs`  
Expected: FAIL，提示模块不存在。

- [ ] **Step 3: 写最小实现**

```js
// skills/chrome-devtools-cli/scripts/lib/devtools-active-port.mjs
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export function parseDevToolsActivePort(fileContent) {
  const [rawPort, rawPath] = fileContent
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const port = Number.parseInt(rawPort, 10);
  if (!rawPort || !rawPath || Number.isNaN(port) || port <= 0) {
    throw new Error(`无效的 DevToolsActivePort 内容: ${JSON.stringify(fileContent)}`);
  }

  return {
    port,
    path: rawPath,
    browserUrl: `http://127.0.0.1:${port}`,
    webSocketDebuggerUrl: `ws://127.0.0.1:${port}${rawPath}`,
  };
}

export async function readDevToolsActivePort(userDataDir) {
  const filePath = path.join(userDataDir, 'DevToolsActivePort');
  const fileContent = await readFile(filePath, 'utf8');
  return {
    filePath,
    ...parseDevToolsActivePort(fileContent),
  };
}
```

```js
// skills/chrome-devtools-cli/scripts/lib/http-probe.mjs
import http from 'node:http';

export async function probeBrowserUrl(browserUrl, timeoutMs = 1500) {
  const versionUrl = new URL('/json/version', browserUrl.endsWith('/') ? browserUrl : `${browserUrl}/`);

  const payload = await new Promise((resolve, reject) => {
    const req = http.get(versionUrl, res => {
      let body = '';

      res.on('data', chunk => {
        body += chunk;
      });

      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`探测失败，状态码 ${res.statusCode}`));
          return;
        }

        resolve(body);
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`探测超时: ${versionUrl.href}`));
    });

    req.on('error', reject);
  });

  const data = JSON.parse(payload);
  if (!data.webSocketDebuggerUrl) {
    throw new Error(`响应缺少 webSocketDebuggerUrl: ${payload}`);
  }

  return {
    ok: true,
    browserUrl: browserUrl.replace(/\/$/, ''),
    browserVersion: data.Browser ?? 'unknown',
    webSocketDebuggerUrl: data.webSocketDebuggerUrl,
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test skills/chrome-devtools-cli/tests/devtools-active-port.test.mjs`  
Expected: PASS，3 个测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add skills/chrome-devtools-cli/scripts/lib/devtools-active-port.mjs skills/chrome-devtools-cli/scripts/lib/http-probe.mjs skills/chrome-devtools-cli/tests/devtools-active-port.test.mjs
git commit -m "feat: add devtools active port parsing and probe helpers"
```

## Task 4: Profile 同步过滤器

**Files:**
- Create: `skills/chrome-devtools-cli/scripts/lib/profile-sync.mjs`
- Test: `skills/chrome-devtools-cli/tests/profile-sync.test.mjs`

- [ ] **Step 1: 写失败测试**

```js
// skills/chrome-devtools-cli/tests/profile-sync.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { shouldCopyProfilePath, syncProfileCopy } from '../scripts/lib/profile-sync.mjs';

test('shouldCopyProfilePath 过滤锁文件和缓存目录', () => {
  assert.equal(shouldCopyProfilePath('Default/Preferences'), true);
  assert.equal(shouldCopyProfilePath('DevToolsActivePort'), false);
  assert.equal(shouldCopyProfilePath('SingletonLock'), false);
  assert.equal(shouldCopyProfilePath('Default/Cache/index'), false);
  assert.equal(shouldCopyProfilePath('Default/Code Cache/js'), false);
});

test('syncProfileCopy 会复制普通文件并跳过 DevToolsActivePort', async () => {
  const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'cdt-source-'));
  const targetDir = await mkdtemp(path.join(os.tmpdir(), 'cdt-target-'));

  await mkdir(path.join(sourceDir, 'Default'), { recursive: true });
  await writeFile(path.join(sourceDir, 'Default', 'Preferences'), '{"theme":"dark"}', 'utf8');
  await writeFile(path.join(sourceDir, 'DevToolsActivePort'), '9222\n/devtools/browser/demo\n', 'utf8');

  const result = await syncProfileCopy({ sourceDir, targetDir });
  assert.equal(result.ok, true);

  const preferences = await readFile(path.join(targetDir, 'Default', 'Preferences'), 'utf8');
  assert.equal(preferences, '{"theme":"dark"}');

  await assert.rejects(() => readFile(path.join(targetDir, 'DevToolsActivePort'), 'utf8'));
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test skills/chrome-devtools-cli/tests/profile-sync.test.mjs`  
Expected: FAIL，提示模块不存在。

- [ ] **Step 3: 写最小实现**

```js
// skills/chrome-devtools-cli/scripts/lib/profile-sync.mjs
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';

const EXCLUDED_NAMES = new Set([
  'DevToolsActivePort',
  'SingletonLock',
  'SingletonCookie',
  'SingletonSocket',
  'LOCK',
  'LOCKFILE',
]);

const EXCLUDED_SEGMENTS = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'GrShaderCache',
  'ShaderCache',
  'Crashpad',
]);

export function shouldCopyProfilePath(relativePath) {
  if (!relativePath || relativePath === '.') {
    return true;
  }

  const normalized = relativePath.replaceAll('\\', '/');
  const segments = normalized.split('/').filter(Boolean);

  for (const segment of segments) {
    if (EXCLUDED_NAMES.has(segment) || EXCLUDED_SEGMENTS.has(segment)) {
      return false;
    }
  }

  return true;
}

export async function syncProfileCopy({ sourceDir, targetDir }) {
  await mkdir(targetDir, { recursive: true });

  try {
    await cp(sourceDir, targetDir, {
      recursive: true,
      force: true,
      filter(sourcePath) {
        const relativePath = path.relative(sourceDir, sourcePath);
        return shouldCopyProfilePath(relativePath);
      },
    });

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test skills/chrome-devtools-cli/tests/profile-sync.test.mjs`  
Expected: PASS，2 个测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add skills/chrome-devtools-cli/scripts/lib/profile-sync.mjs skills/chrome-devtools-cli/tests/profile-sync.test.mjs
git commit -m "feat: add best effort profile sync for chrome devtools skill"
```

## Task 5: 会话编排与 fallback Chrome 启动

**Files:**
- Create: `skills/chrome-devtools-cli/scripts/lib/chrome-process.mjs`
- Create: `skills/chrome-devtools-cli/scripts/lib/session-manager.mjs`
- Create: `skills/chrome-devtools-cli/scripts/ensure-browser-session.mjs`
- Test: `skills/chrome-devtools-cli/tests/session-manager.test.mjs`

- [ ] **Step 1: 写失败测试**

```js
// skills/chrome-devtools-cli/tests/session-manager.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureBrowserSession } from '../scripts/lib/session-manager.mjs';

test('优先复用真实 Chrome', async () => {
  const execCalls = [];
  const result = await ensureBrowserSession(
    { channel: 'stable' },
    {
      processVersion: 'v22.12.0',
      ensureNpxAvailable: async () => {},
      learnHelpCommands: async () => {},
      realUserDataDir: '/real-profile',
      fallbackUserDataDir: '/fallback-profile',
      tryResolveLiveBrowser: async userDataDir =>
        userDataDir === '/real-profile'
          ? { browserUrl: 'http://127.0.0.1:9222', source: 'real' }
          : null,
      syncProfileCopy: async () => {
        throw new Error('不应该走到同步');
      },
      findChromeExecutable: async () => '/path/to/chrome',
      findFreePort: async () => 9333,
      launchChromeDetached: async () => {
        throw new Error('不应该启动 fallback Chrome');
      },
      waitForBrowserReady: async () => {
        throw new Error('不应该等待 fallback Chrome');
      },
      startCli: async browserUrl => {
        execCalls.push(browserUrl);
      },
    }
  );

  assert.equal(result.mode, 'reuse-running');
  assert.deepEqual(execCalls, ['http://127.0.0.1:9222']);
});

test('真实 Chrome 不可复用时，优先复用已存在的 fallback Chrome', async () => {
  const result = await ensureBrowserSession(
    { channel: 'stable' },
    {
      processVersion: 'v22.12.0',
      ensureNpxAvailable: async () => {},
      learnHelpCommands: async () => {},
      realUserDataDir: '/real-profile',
      fallbackUserDataDir: '/fallback-profile',
      tryResolveLiveBrowser: async userDataDir =>
        userDataDir === '/fallback-profile'
          ? { browserUrl: 'http://127.0.0.1:9444', source: 'fallback' }
          : null,
      syncProfileCopy: async () => ({ ok: true }),
      findChromeExecutable: async () => '/path/to/chrome',
      findFreePort: async () => 9333,
      launchChromeDetached: async () => {
        throw new Error('不应该重新启动 fallback Chrome');
      },
      waitForBrowserReady: async () => {
        throw new Error('不应该等待 fallback Chrome');
      },
      startCli: async () => {},
    }
  );

  assert.equal(result.mode, 'reuse-fallback');
  assert.equal(result.browserUrl, 'http://127.0.0.1:9444');
});

test('同步失败时仍然继续启动 fallback Chrome', async () => {
  let launched = false;
  const result = await ensureBrowserSession(
    { channel: 'stable' },
    {
      processVersion: 'v22.12.0',
      ensureNpxAvailable: async () => {},
      learnHelpCommands: async () => {},
      realUserDataDir: '/real-profile',
      fallbackUserDataDir: '/fallback-profile',
      tryResolveLiveBrowser: async () => null,
      syncProfileCopy: async () => ({ ok: false, error: 'busy profile' }),
      findChromeExecutable: async () => '/path/to/chrome',
      findFreePort: async () => 9555,
      launchChromeDetached: async () => {
        launched = true;
      },
      waitForBrowserReady: async () => ({
        browserUrl: 'http://127.0.0.1:9555',
      }),
      startCli: async () => {},
    }
  );

  assert.equal(launched, true);
  assert.equal(result.mode, 'launched-fallback');
  assert.equal(result.syncStatus, 'failed');
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test skills/chrome-devtools-cli/tests/session-manager.test.mjs`  
Expected: FAIL，提示模块不存在。

- [ ] **Step 3: 先写浏览器进程辅助模块**

```js
// skills/chrome-devtools-cli/scripts/lib/chrome-process.mjs
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { access } from 'node:fs/promises';

import { readDevToolsActivePort } from './devtools-active-port.mjs';
import { probeBrowserUrl } from './http-probe.mjs';

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function findExistingPath(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next candidate
    }
  }

  throw new Error(`未找到可用的 Chrome 可执行文件: ${candidates.join(', ')}`);
}

export async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('无法分配本地调试端口'));
        return;
      }

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

export function launchChromeDetached({
  executablePath,
  userDataDir,
  port,
  extraArgs = [],
}) {
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    ...extraArgs,
  ];

  const child = spawn(executablePath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });

  child.unref();

  return {
    pid: child.pid,
    args,
  };
}

export async function waitForDevToolsActivePort(userDataDir, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      return await readDevToolsActivePort(userDataDir);
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }

  const filePath = path.join(userDataDir, 'DevToolsActivePort');
  throw new Error(
    `等待 DevToolsActivePort 超时: ${filePath}${lastError ? `，最后错误: ${lastError.message}` : ''}`
  );
}

export async function waitForBrowserReady(userDataDir, timeoutMs = 15000) {
  const activePort = await waitForDevToolsActivePort(userDataDir, timeoutMs);
  return await probeBrowserUrl(activePort.browserUrl, timeoutMs);
}
```

- [ ] **Step 4: 再写会话编排与 CLI 包装**

```js
// skills/chrome-devtools-cli/scripts/lib/session-manager.mjs
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { assertSupportedNodeVersion } from './node-version.mjs';
import {
  getChromeExecutableCandidates,
  getFallbackProfileDir,
  getRealUserDataDir,
} from './platform-paths.mjs';
import { readDevToolsActivePort } from './devtools-active-port.mjs';
import { probeBrowserUrl } from './http-probe.mjs';
import { syncProfileCopy } from './profile-sync.mjs';
import {
  findExistingPath,
  findFreePort,
  launchChromeDetached,
  waitForBrowserReady,
} from './chrome-process.mjs';

const execFileAsync = promisify(execFile);

async function defaultEnsureNpxAvailable() {
  await execFileAsync('npx', ['--version']);
}

async function defaultLearnHelpCommands() {
  const commands = [
    ['npx', ['-y', 'chrome-devtools-mcp@latest', '--help']],
    ['npx', ['-y', '-p', 'chrome-devtools-mcp@latest', 'chrome-devtools', '--help']],
    ['npx', ['-y', '-p', 'chrome-devtools-mcp@latest', 'chrome-devtools', 'start', '--help']],
  ];

  for (const [command, args] of commands) {
    await execFileAsync(command, args);
  }
}

async function defaultTryResolveLiveBrowser(userDataDir) {
  try {
    const activePort = await readDevToolsActivePort(userDataDir);
    const probe = await probeBrowserUrl(activePort.browserUrl);

    return {
      source: 'live',
      userDataDir,
      browserUrl: probe.browserUrl,
      webSocketDebuggerUrl: probe.webSocketDebuggerUrl,
    };
  } catch {
    return null;
  }
}

async function defaultStartCli(browserUrl) {
  await execFileAsync('npx', [
    '-y',
    '-p',
    'chrome-devtools-mcp@latest',
    'chrome-devtools',
    'start',
    `--browserUrl=${browserUrl}`,
  ]);
}

export async function ensureBrowserSession(
  {
    channel = 'stable',
    realUserDataDirOverride = process.env.CHROME_DEVTOOLS_CLI_USER_DATA_DIR,
    chromeExecutableOverride = process.env.CHROME_DEVTOOLS_CLI_CHROME_PATH,
  } = {},
  deps = {}
) {
  assertSupportedNodeVersion(deps.processVersion ?? process.version);

  const ensureNpxAvailable = deps.ensureNpxAvailable ?? defaultEnsureNpxAvailable;
  const learnHelpCommands = deps.learnHelpCommands ?? defaultLearnHelpCommands;
  const tryResolveLiveBrowser = deps.tryResolveLiveBrowser ?? defaultTryResolveLiveBrowser;
  const startCli = deps.startCli ?? defaultStartCli;
  const realUserDataDir =
    deps.realUserDataDir ??
    getRealUserDataDir({ channel, override: realUserDataDirOverride });
  const fallbackUserDataDir =
    deps.fallbackUserDataDir ?? getFallbackProfileDir({ channel });

  await ensureNpxAvailable();
  await learnHelpCommands();

  const realBrowser = await tryResolveLiveBrowser(realUserDataDir);
  if (realBrowser) {
    await startCli(realBrowser.browserUrl);
    return {
      mode: 'reuse-running',
      browserUrl: realBrowser.browserUrl,
      userDataDir: realUserDataDir,
      syncStatus: 'skipped',
    };
  }

  const fallbackBrowser = await tryResolveLiveBrowser(fallbackUserDataDir);
  if (fallbackBrowser) {
    await startCli(fallbackBrowser.browserUrl);
    return {
      mode: 'reuse-fallback',
      browserUrl: fallbackBrowser.browserUrl,
      userDataDir: fallbackUserDataDir,
      syncStatus: 'skipped',
    };
  }

  const syncResult = await (deps.syncProfileCopy ?? syncProfileCopy)({
    sourceDir: realUserDataDir,
    targetDir: fallbackUserDataDir,
  });

  const executablePath =
    deps.chromeExecutablePath ??
    (await (deps.findChromeExecutable ?? findExistingPath)(
      getChromeExecutableCandidates({
        channel,
        override: chromeExecutableOverride,
      })
    ));

  const port = await (deps.findFreePort ?? findFreePort)();

  await (deps.launchChromeDetached ?? launchChromeDetached)({
    executablePath,
    userDataDir: fallbackUserDataDir,
    port,
  });

  const ready =
    (await (deps.waitForBrowserReady ?? waitForBrowserReady)(fallbackUserDataDir)) ?? {
      browserUrl: `http://127.0.0.1:${port}`,
    };

  await startCli(ready.browserUrl);

  return {
    mode: 'launched-fallback',
    browserUrl: ready.browserUrl,
    userDataDir: fallbackUserDataDir,
    syncStatus: syncResult.ok ? 'success' : 'failed',
    syncError: syncResult.ok ? null : syncResult.error,
  };
}
```

```js
// skills/chrome-devtools-cli/scripts/ensure-browser-session.mjs
import process from 'node:process';

import { ensureBrowserSession } from './lib/session-manager.mjs';

try {
  const result = await ensureBrowserSession({
    channel: process.env.CHROME_DEVTOOLS_CLI_CHANNEL ?? 'stable',
  });

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
```

- [ ] **Step 5: 运行编排测试，确认通过**

Run: `node --test skills/chrome-devtools-cli/tests/session-manager.test.mjs`  
Expected: PASS，3 个测试全部通过。

- [ ] **Step 6: 提交**

```bash
git add skills/chrome-devtools-cli/scripts/lib/chrome-process.mjs skills/chrome-devtools-cli/scripts/lib/session-manager.mjs skills/chrome-devtools-cli/scripts/ensure-browser-session.mjs skills/chrome-devtools-cli/tests/session-manager.test.mjs
git commit -m "feat: add browser session orchestrator for chrome devtools skill"
```

## Task 6: 停止脚本与 skill 文档

**Files:**
- Create: `skills/chrome-devtools-cli/scripts/stop-cli-session.mjs`
- Create: `skills/chrome-devtools-cli/SKILL.md`
- Create: `skills/chrome-devtools-cli/references/cli-quick-reference.md`
- Create: `skills/chrome-devtools-cli/references/profile-strategy.md`

- [ ] **Step 1: 写停止脚本**

```js
// skills/chrome-devtools-cli/scripts/stop-cli-session.mjs
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';

const execFileAsync = promisify(execFile);

try {
  await execFileAsync('npx', [
    '-y',
    '-p',
    'chrome-devtools-mcp@latest',
    'chrome-devtools',
    'stop',
  ]);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
```

- [ ] **Step 2: 写 `SKILL.md`**

```md
---
name: chrome-devtools-cli
description: >-
  Provide browser inspection and control through Chrome DevTools CLI without
  requiring manual MCP configuration. Use when a task needs a real Chrome
  browser for page debugging, login flows, DOM or console inspection, live site
  interaction, screenshot capture, style debugging, performance analysis, or
  any other browser-driven workflow. Triggers include requests like
  "帮我看看这个页面为什么白屏", "打开浏览器登录一下后台，然后检查报错",
  "抓一下这个页面的 DOM 和 console 信息", "打开某个网址进行某些操作",
  "查看这里的样式为什么出不来", and "评估这个页面的性能".
---

# Chrome DevTools CLI

当任务必须依赖真实 Chrome 浏览器时，使用这个 skill。

## 工作顺序

1. 先确认任务确实需要真实浏览器，而不是静态分析就够了。
2. 先学习 CLI：

```bash
npx -y chrome-devtools-mcp@latest --help
npx -y -p chrome-devtools-mcp@latest chrome-devtools --help
npx -y -p chrome-devtools-mcp@latest chrome-devtools start --help
```

3. 运行会话编排脚本：

```bash
node skills/chrome-devtools-cli/scripts/ensure-browser-session.mjs
```

4. 使用 Chrome DevTools CLI 完成实际任务。始终优先查看子命令帮助：

```bash
npx -y -p chrome-devtools-mcp@latest chrome-devtools --help
npx -y -p chrome-devtools-mcp@latest chrome-devtools <command> --help
```

5. 任务完成后停止 CLI daemon，但不要关闭浏览器：

```bash
node skills/chrome-devtools-cli/scripts/stop-cli-session.mjs
```

## 注意事项

- 如果脚本提示 Node 版本不满足要求，先停下并告诉用户。
- `DevToolsActivePort` 只能作为候选信号，不能跳过实际探测。
- profile 同步失败时继续执行，只是登录态可能不完整。
- 不要在清理阶段关闭浏览器；后续任务需要复用它。

## 参考资料

- CLI 速查：`references/cli-quick-reference.md`
- Profile 策略：`references/profile-strategy.md`
```

- [ ] **Step 3: 写参考文档**

```md
<!-- skills/chrome-devtools-cli/references/cli-quick-reference.md -->
# Chrome DevTools CLI 速查

## 启动前先看帮助

```bash
npx -y chrome-devtools-mcp@latest --help
npx -y -p chrome-devtools-mcp@latest chrome-devtools --help
npx -y -p chrome-devtools-mcp@latest chrome-devtools <command> --help
```

## 会话工作流

```bash
node skills/chrome-devtools-cli/scripts/ensure-browser-session.mjs
npx -y -p chrome-devtools-mcp@latest chrome-devtools --help
node skills/chrome-devtools-cli/scripts/stop-cli-session.mjs
```

## 约束

- `chrome-devtools start` 当前不直接暴露 `--autoConnect`
- 优先复用现有 Chrome，否则回退到固定 fallback profile
- 停止 CLI 时不要关闭浏览器
```

```md
<!-- skills/chrome-devtools-cli/references/profile-strategy.md -->
# Profile 策略

## 两类 profile

- 真实 user data dir：用于尝试复用用户当前的 Chrome
- 固定 fallback profile：用于在无法复用真实 Chrome 时启动可持续复用的专用 Chrome

## 固定 fallback 目录

- stable：`~/.cache/chrome-devtools-mcp-cli/chrome-profile`
- beta：`~/.cache/chrome-devtools-mcp-cli/chrome-profile-beta`
- dev：`~/.cache/chrome-devtools-mcp-cli/chrome-profile-dev`
- canary：`~/.cache/chrome-devtools-mcp-cli/chrome-profile-canary`

## 同步策略

- 尽量把真实 profile 更新到固定 fallback profile
- 排除 `DevToolsActivePort`、`Singleton*`、`Cache`、`Code Cache` 等瞬时文件
- 同步失败不终止整个流程

## 结束策略

- 只停止 CLI daemon
- 不关闭浏览器
- 保留 fallback profile 供后续继续复用
```

- [ ] **Step 4: 验证文档和停止脚本存在**

Run: `rg -n "chrome-devtools-cli|stop-cli-session|ensure-browser-session" skills/chrome-devtools-cli`  
Expected: 命中 `SKILL.md`、两个 `references` 文件、`ensure-browser-session.mjs` 和 `stop-cli-session.mjs`。

- [ ] **Step 5: 提交**

```bash
git add skills/chrome-devtools-cli/SKILL.md skills/chrome-devtools-cli/references/cli-quick-reference.md skills/chrome-devtools-cli/references/profile-strategy.md skills/chrome-devtools-cli/scripts/stop-cli-session.mjs
git commit -m "feat: add chrome devtools cli skill docs"
```

## Task 7: README 集成与整体验证

**Files:**
- Modify: `README.md`
- Test: `skills/chrome-devtools-cli/tests/node-version.test.mjs`
- Test: `skills/chrome-devtools-cli/tests/platform-paths.test.mjs`
- Test: `skills/chrome-devtools-cli/tests/devtools-active-port.test.mjs`
- Test: `skills/chrome-devtools-cli/tests/profile-sync.test.mjs`
- Test: `skills/chrome-devtools-cli/tests/session-manager.test.mjs`

- [ ] **Step 1: 更新 README**

```md
<!-- README.md 在 “## skills 说明” 下新增这一段 -->
### chrome-devtools-cli

为 agent 提供 Chrome DevTools CLI 浏览器能力，无需手动配置 MCP。
适用场景：
（1）排查页面白屏、样式异常或运行时报错，
（2）打开网页并执行交互操作，
（3）抓取 DOM、console、network、截图等浏览器信息，
（4）评估页面性能，
（5）需要复用现有 Chrome 登录态或使用固定 fallback profile 的浏览器任务。
```

- [ ] **Step 2: 运行全部测试**

Run: `node --test skills/chrome-devtools-cli/tests`  
Expected: PASS，所有 `*.test.mjs` 通过。

- [ ] **Step 3: 做一次脚本级 smoke check**

Run: `node skills/chrome-devtools-cli/scripts/ensure-browser-session.mjs`  
Expected: 在本机环境满足条件时输出 JSON，至少包含 `mode`、`browserUrl`、`userDataDir`、`syncStatus`；如果 Node 版本或 Chrome 路径不满足，应输出明确错误信息，而不是无上下文失败。

- [ ] **Step 4: 停止 CLI smoke check**

Run: `node skills/chrome-devtools-cli/scripts/stop-cli-session.mjs`  
Expected: `chrome-devtools` daemon 停止；如果 daemon 未运行，命令仍然应可安全结束。

- [ ] **Step 5: 提交**

```bash
git add README.md
git commit -m "docs: document chrome devtools cli skill"
```

## 自检清单

- [ ] spec 覆盖检查：
  - Node 版本门禁：Task 1
  - CLI help 学习：Task 5 默认 `learnHelpCommands` + Task 6 `SKILL.md`
  - 复用真实 Chrome：Task 5 `ensureBrowserSession`
  - 复用 fallback Chrome：Task 5 `ensureBrowserSession`
  - fallback profile 同步失败继续执行：Task 4 + Task 5
  - 结束时停止 CLI 但保留浏览器：Task 6 停止脚本 + Task 5 外部启动 Chrome
  - 跨平台路径：Task 2
  - 文档与 README：Task 6、Task 7

- [ ] 占位符检查：
  - 搜索常见占位符关键词，确认任务正文里没有未填充内容
  - 预期：0 个真正的占位符命中

- [ ] 类型一致性检查：
  - `mode` 只允许：`reuse-running`、`reuse-fallback`、`launched-fallback`
  - `syncStatus` 只允许：`skipped`、`success`、`failed`
  - `browserUrl` 统一使用 `http://127.0.0.1:<port>`
