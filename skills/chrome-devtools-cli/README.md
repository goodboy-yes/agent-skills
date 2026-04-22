# Chrome DevTools CLI Skill

这个目录封装了一套“尽量不让用户手动配置 MCP，也能把真实 Chrome 会话接进来”的工作流，供 Codex 在需要真实浏览器时复用。

它解决的不是“如何安装 `chrome-devtools-mcp`”这种单点问题，而是下面这一整条链路：

- 如何优先复用用户当前已经打开的真实 Chrome。
- 如何在本机已安装 CLI 和 `npx` 拉包之间自动选择。
- 如何在 `--browserUrl`、`--wsEndpoint`、固定回退 profile 之间切换。
- 如何在任务结束后只停止 CLI daemon，而不把浏览器直接关掉。

## 适用场景

- 需要真实 Chrome 登录态、Cookie、页面状态，而不是新开一个干净浏览器。
- 需要查看真实页面的 DOM、console、network、performance、截图结果。
- 需要把手工调试和 agent 调试串起来，不想让用户先自己配置 MCP。
- 需要在 `chrome-devtools-mcp` CLI 能力经常变化的前提下，尽量通过 `--help` 自适应。

## 目录说明

- [SKILL.md](SKILL.md)：skill 入口说明，告诉 agent 什么时候应该用这个 skill。
- [references/cli-quick-reference.md](references/cli-quick-reference.md)：CLI 常用命令和 transport 速查。
- [references/profile-strategy.md](references/profile-strategy.md)：真实 profile / 固定回退 profile 的策略说明。
- [scripts/ensure-browser-session.mjs](scripts/ensure-browser-session.mjs)：会话入口脚本。
- [scripts/stop-cli-session.mjs](scripts/stop-cli-session.mjs)：只停止 CLI daemon，不关闭浏览器。
- [scripts/lib/session-manager.mjs](scripts/lib/session-manager.mjs)：核心流程编排与 transport 选择逻辑。
- [tests/](tests/)：针对会话发现、命令拼接、profile 同步等行为的回归测试。

## 当前实现的完整流程

### 1. 入口

先运行：

```bash
node skills/chrome-devtools-cli/scripts/ensure-browser-session.mjs
```

这个脚本会调用 [scripts/lib/session-manager.mjs](scripts/lib/session-manager.mjs) 中的 `ensureBrowserSession()`，返回本次会话是如何建立或复用的。

### 2. 先决定用本地 CLI、自动安装 CLI，还是 `npx`

当前实现会先尝试在本机 `PATH` 中查找真正可用的 CLI：

- 优先找 `chrome-devtools`
- 其次找 `chrome-devtools-mcp`
- 如果本地命令只是包根命令、并不具备 `chrome-devtools start/stop` 语义，就不直接采用

如果本地没有合适 CLI，默认会先执行官方推荐的全局安装：

```bash
npm install -g chrome-devtools-mcp@latest --registry=https://registry.npmmirror.com/
```

安装完成后会重新探测本机 CLI。

如果自动安装失败，或者你显式禁用了自动安装，才退回到：

```bash
npx --registry=https://registry.npmmirror.com/ -y -p chrome-devtools-mcp@latest chrome-devtools ...
```

这样做的目的：

- 优先与使用者真实环境保持一致。
- 本地有可用 CLI 时，不依赖外部 registry。
- 本地缺少 CLI 时，优先对齐官方 `cli.md` 推荐的安装方式。
- 自动安装失败时，仍然能通过 `npx` 自动补齐运行能力。

如果你需要禁用自动安装，可以在运行前设置：

```powershell
$env:CHROME_DEVTOOLS_CLI_DISABLE_AUTO_INSTALL = "1"
```

### 3. 先读实时帮助，再决定 transport

当前实现不会凭记忆假设参数，而是先读取：

```bash
chrome-devtools-mcp --help
chrome-devtools --help
chrome-devtools start --help
```

如果本机 CLI 还不存在，才改用 `npx` 版帮助输出做能力核查。

然后根据帮助信息决定本次能走哪些 transport。

### 4. transport 选择顺序

当前仓库里的逻辑顺序是：

1. 如果 `chrome-devtools start --help` 暴露了 `--autoConnect`，优先尝试 `autoConnect`
2. 否则先尝试复用真实 Chrome
3. 真实 Chrome 可复用时：
   - 如果 `/json/version` 可访问，走 `--browserUrl`
   - 如果 `/json/version` 不可访问，但 `chrome-devtools start --help` 支持 `--wsEndpoint`，走 `--wsEndpoint`
4. 如果真实 Chrome 不可复用，再尝试复用固定回退 profile 对应的备用 Chrome
5. 如果回退 profile 也没有现成会话，就同步 profile 副本并启动一个新的专用 Chrome

### 5. 真实 Chrome 复用的具体规则

对于真实 user data dir 和固定回退 profile，当前实现都会先读取 `DevToolsActivePort`。

然后分两种情况：

- 经典 HTTP 发现可用：
  - 从 `DevToolsActivePort` 拿到 `http://127.0.0.1:<port>`
  - 请求 `/json/version`
  - 读出 `webSocketDebuggerUrl`
  - 使用 `chrome-devtools start --browserUrl=...`
- HTTP 发现失败，但已有 WebSocket 端点：
  - 从 `DevToolsActivePort` 直接读到 `ws://127.0.0.1:<port>/devtools/browser/<id>`
  - 如果当前 CLI 支持 `--wsEndpoint`
  - 使用 `chrome-devtools start --wsEndpoint=...`

这一点是当前仓库近期补上的关键修正：  
之前实现会在读到 `DevToolsActivePort` 后，仍然强依赖 `/json/version`，导致“有 live session 但 HTTP 发现 404”的场景被误判成不可复用。现在已经补上 `wsEndpoint` 直连分支。

### 6. 无法复用时的回退策略

如果真实会话无法直接复用，当前实现会：

1. 尝试把真实 profile 中可安全复制的内容同步到固定回退 profile
2. 跳过 `DevToolsActivePort`、`Singleton*`、`Cache`、`Code Cache` 等瞬时文件
3. 即使同步失败，也继续尝试启动回退 Chrome
4. 使用非默认 `user-data-dir` 和 `--remote-debugging-port` 启动专用浏览器

### 7. 清理策略

任务结束后执行：

```bash
node skills/chrome-devtools-cli/scripts/stop-cli-session.mjs
```

它只会尝试停止 CLI daemon，不会关闭浏览器窗口，也不会删除固定回退 profile。

## 我们实际核验到的 CLI 能力

在当前这台开发机上，实际执行帮助命令得到的结论是：

- 本地只有 `chrome-devtools-mcp.ps1`
- 本地没有 `chrome-devtools`
- `npx ... chrome-devtools start --help` 支持：
  - `--browserUrl`
  - `--wsEndpoint`
- `npx ... chrome-devtools start --help` 不支持：
  - `--autoConnect`
- `chrome-devtools-mcp --help` 和 `npx ... chrome-devtools-mcp@latest --help` 支持：
  - `--autoConnect`
  - `--browserUrl`
  - `--wsEndpoint`

这说明一个很重要的事实：

- `--autoConnect` 是包根命令 `chrome-devtools-mcp` 的能力
- `--browserUrl` / `--wsEndpoint` 是 `chrome-devtools start` 这条子命令链路的稳定能力

因此，当前这个 skill 的稳定复用路径主要建立在 `browserUrl` / `wsEndpoint` 上。

## 官方文档核查后的结论

下面这些结论是根据官方 README、Chrome DevTools Protocol 文档和 Chrome for Developers 官方博客整理出来的。

### 1. `--browserUrl` 是 HTTP 发现模式

官方文档明确表明：

- `--browserUrl` 用来连接一个“正在运行、可调试”的 Chrome 实例
- 典型值是 `http://127.0.0.1:9222`
- Chrome DevTools Protocol 官方文档说明：浏览器级 WebSocket 端点会出现在 `/json/version` 返回的 `webSocketDebuggerUrl` 字段里

因此可以确认：

- `--browserUrl` 的本质是 “HTTP 发现 -> WebSocket”

### 2. `--wsEndpoint` 是直连 WebSocket

官方 README 明确把 `--wsEndpoint` 定义为：

- 直接连接 `ws://127.0.0.1:9222/devtools/browser/<id>`
- 作为 `--browserUrl` 的替代方案

因此可以确认：

- `--wsEndpoint` 的本质是 “跳过 HTTP 发现，直接 WebSocket 直连”

### 3. `--autoConnect` 是 Chrome 144+ 的权限式自动连接流程

官方博客和 README 都明确说明：

- `--autoConnect` 面向 Chrome 144+
- 需要先在 `chrome://inspect/#remote-debugging` 启用远程调试
- MCP server 会向 Chrome 请求远程调试连接
- Chrome 会弹权限确认对话框

因此可以确认：

- `--autoConnect` 不是经典 `--remote-debugging-port=9222` 那条手动 HTTP 发现流程
- 它是 Chrome 新增的“本机活动浏览器自动连接”能力

### 4. `DevToolsActivePort` 与 `/json/version` 的关系

Chrome DevTools Protocol 官方文档明确说明：

- 如果 Chrome 使用 `--remote-debugging-port=0` 并自动选择端口，浏览器级 endpoint 会写入 `DevToolsActivePort`
- 浏览器级 WebSocket endpoint 也会通过 `/json/version` 的 `webSocketDebuggerUrl` 暴露出来

这能支持两个判断：

- 当 `/json/version` 可用时，`browserUrl` 路径最直接
- 当 `DevToolsActivePort` 已有 WebSocket 信息，但 HTTP 发现不可用时，`wsEndpoint` 是合理且必要的回退路径

### 5. Chrome 136+ 对 remote debugging port 的安全限制

Chrome 官方博客明确说明：

- 从 Chrome 136 起，`--remote-debugging-port` 和 `--remote-debugging-pipe` 不再对默认 profile 生效
- 必须同时指定一个非默认 `--user-data-dir`

因此当前 skill 选择固定回退 profile、避免直接拿默认 profile 暴露 remote debugging port，是符合官方安全方向的。

## 当前仓库的设计结论

综合代码实现、实际帮助输出和官方文档，当前 skill 的设计结论可以总结为：

- 优先复用真实 Chrome 会话，而不是默认新开一个干净浏览器。
- 如果本机已安装可用 CLI，优先使用本机 CLI。
- 如果本机缺少可用 CLI，默认自动安装官方推荐的 `chrome-devtools-mcp@latest` 全局 CLI。
- 只有自动安装失败，或者显式禁用了自动安装时，才退回到 `npx`。
- 对实时会话的复用，优先尝试 `browserUrl`。
- 当 live session 只有 `DevToolsActivePort`，但 `/json/version` 不可用时，改走 `wsEndpoint`。
- 固定回退 profile 是最后一道兜底，而不是默认工作模式。
- profile 同步失败不是致命错误，不能中断整个浏览器会话建立流程。
- 清理时只停止 daemon，不关闭浏览器，保证后续任务还能承接当前状态。

## 维护建议

- 每次升级 `chrome-devtools-mcp` 后，都重新跑一遍 `--help`，不要假设参数名和命令层级不变。
- 如果未来要把 `--autoConnect` 作为主路径，应优先对齐包根命令 `chrome-devtools-mcp` 的调用方式，而不是继续假设它一定存在于 `chrome-devtools start`。
- 如果后续增加 `--wsHeaders`、远程 WebSocket、代理穿透等能力，优先在 `session-manager.mjs` 中扩展 transport 探测，再补测试。

## 相关文件

- [SKILL.md](SKILL.md)
- [references/cli-quick-reference.md](references/cli-quick-reference.md)
- [references/profile-strategy.md](references/profile-strategy.md)
- [scripts/lib/session-manager.mjs](scripts/lib/session-manager.mjs)
- [tests/session-manager.test.mjs](tests/session-manager.test.mjs)

## 官方资料链接

- Chrome DevTools MCP README  
  https://github.com/ChromeDevTools/chrome-devtools-mcp
- Chrome DevTools Protocol  
  https://chromedevtools.github.io/devtools-protocol/
- Let your Coding Agent debug your browser session with Chrome DevTools MCP  
  https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session
- Changes to remote debugging switches to improve security  
  https://developer.chrome.com/blog/remote-debugging-port
