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

## 脚本文件详解

### 入口脚本

#### [scripts/ensure-browser-session.mjs](scripts/ensure-browser-session.mjs)

会话建立入口脚本。调用 `session-manager.mjs` 中的 `ensureBrowserSession()`，通过环境变量 `CHROME_DEVTOOLS_CLI_CHANNEL` 指定 Chrome 渠道（默认 `stable`），成功后以 JSON 格式输出会话信息，失败则输出错误并以非零退出码退出。

#### [scripts/stop-cli-session.mjs](scripts/stop-cli-session.mjs)

会话清理入口脚本。通过 `resolveChromeDevtoolsCliRunner()` 查找本地 CLI（禁止自动安装），执行 `stopCli()` 停止 CLI 守护进程。对于"未运行""无守护进程"等非致命错误会静默忽略，不会关闭浏览器窗口。

### 核心模块（scripts/lib/）

#### [scripts/lib/session-manager.mjs](scripts/lib/session-manager.mjs)

**整个 skill 的核心编排模块**，包含以下主要功能：

- **CLI 运行器解析**（`resolveChromeDevtoolsCliRunner`）：按优先级查找可用的 CLI——本地已安装 → 自动全局安装 → npx 临时运行。
- **本地 CLI 发现**（`findLocalChromeDevtoolsCli`）：遍历系统 PATH，查找 `chrome-devtools` 或 `chrome-devtools-mcp` 可执行文件，Windows 下兼容 PATHEXT 扩展名。
- **CLI 能力探测**（`learnHelpCommandsWithRunner`）：通过 `--help` 输出实时检测 CLI 是否支持 `--browserUrl`、`--wsEndpoint`、`--autoConnect` 等参数。
- **浏览器实例发现**（`tryResolveLiveBrowserFromUserDataDir`）：从 DevToolsActivePort 文件中读取调试端口信息，通过 HTTP 探测或 WebSocket 直连确认浏览器是否可复用。
- **会话建立主流程**（`ensureBrowserSession`）：按 `autoConnect → 复用真实 Chrome → 复用备用 profile → 启动新 Chrome` 的优先级建立浏览器会话。
- **两种运行器实现**：`createLocalCliRunner`（直接调用本地 CLI 命令）和 `createNpxCliRunner`（通过 npx 临时下载运行），统一接口便于无缝切换。

#### [scripts/lib/chrome-process.mjs](scripts/lib/chrome-process.mjs)

Chrome 进程管理模块，负责浏览器的启动与就绪检测：

- **`findExistingPath`**：从候选路径列表中查找第一个存在的 Chrome 可执行文件。
- **`findFreePort`**：通过创建临时 TCP 服务器让系统自动分配空闲端口，然后立即关闭服务器以释放该端口。
- **`launchChromeDetached`**：以 detached（独立）模式启动 Chrome 进程，传入 `--remote-debugging-port`、`--user-data-dir` 等参数，使浏览器在父进程退出后继续运行。
- **`waitForDevToolsActivePort`**：每 250ms 轮询等待 DevToolsActivePort 文件出现（默认超时 15 秒）。
- **`waitForBrowserReady`**：先等待 DevToolsActivePort 文件写入完成，再通过 HTTP 探测确认调试端口可正常访问。

#### [scripts/lib/platform-paths.mjs](scripts/lib/platform-paths.mjs)

跨平台路径解析模块，根据操作系统和 Chrome 渠道返回对应路径：

- **`normalizeChannel`**：规范化渠道名称（stable/beta/dev/canary）并校验。
- **`getFallbackProfileDir`**：返回 CLI 使用的备用配置文件目录（`~/.cache/chrome-devtools-mcp-cli/` 下）。
- **`getRealUserDataDir`**：返回 Chrome 真实用户数据目录路径（Windows: `%LOCALAPPDATA%\Google\Chrome\User Data`；macOS: `~/Library/Application Support/Google/Chrome`；Linux: `~/.config/google-chrome`）。
- **`getChromeExecutableCandidates`**：返回 Chrome 可执行文件的候选路径列表，覆盖 Windows（Program Files）、macOS（/Applications）和 Linux（/usr/bin）三个平台。

#### [scripts/lib/devtools-active-port.mjs](scripts/lib/devtools-active-port.mjs)

DevToolsActivePort 文件解析模块：

- **`parseDevToolsActivePort`**：解析文件内容（第一行为端口号，第二行为 WebSocket 路径），构造 HTTP 调试地址和 WebSocket 调试地址。
- **`readDevToolsActivePort`**：从 Chrome 用户数据目录中读取 DevToolsActivePort 文件并调用 `parseDevToolsActivePort` 解析。

#### [scripts/lib/http-probe.mjs](scripts/lib/http-probe.mjs)

浏览器调试端口 HTTP 探测模块：

- **`probeBrowserUrl`**：通过 HTTP GET 请求 `/json/version` 端点，验证浏览器调试端口是否可用，并从响应中提取 `webSocketDebuggerUrl`（WebSocket 调试地址）和浏览器版本信息。支持超时控制（默认 1500ms）。

#### [scripts/lib/profile-sync.mjs](scripts/lib/profile-sync.mjs)

Chrome 配置文件目录同步模块：

- **`shouldCopyProfilePath`**：判断某个文件/目录是否应被复制，自动排除 DevToolsActivePort、Singleton 锁文件以及 Cache 等缓存目录。
- **`copyDirectory`**：递归复制目录，跳过不需要的运行时锁文件和缓存目录。
- **`syncProfileCopy`**：将真实用户数据目录同步到备用配置文件目录，用于在不锁定真实 profile 的情况下启动独立 Chrome 实例。同步失败时返回错误信息而不抛出异常。
- **`clearProfileCopy`**：清除备用配置文件目录。

#### [scripts/lib/node-version.mjs](scripts/lib/node-version.mjs)

Node.js 版本校验模块：

- **`parseNodeVersion`**：将版本号字符串（如 `v22.12.0`）解析为 `{ major, minor, patch }` 结构。
- **`isSupportedNodeVersion`**：判断版本是否在支持范围内（`^20.19.0 || ^22.12.0 || >=23`）。
- **`assertSupportedNodeVersion`**：断言当前 Node.js 版本满足最低要求，不满足则抛出带清晰提示的错误。

#### [scripts/lib/npx-command.mjs](scripts/lib/npx-command.mjs)

Shell 命令构建模块：

- **`quoteShellArg`**：对单个 shell 参数进行转义，同时兼容 Windows（cmd 双引号）和 Unix（bash 单引号）两种平台的规则。
- **`buildCliCommand`**：将命令和参数列表拼接为完整的 shell 命令字符串，自动对每个参数进行平台适配的转义。
- **`buildNpxCommand`**：构造 npx 命令字符串，支持自定义 `--registry` 参数。
- **`formatCommandFailure`**：格式化命令执行失败的错误信息，优先展示 stderr，其次 stdout，最后错误消息。

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

## 现状

- Chrome DevTools 文档明确写了可以 “Run another Chrome instance with the --remote-debugging-port=PORT parameter”，也就是“运行另一个 Chrome 实例”。
  来源: https://developer.chrome.com/docs/devtools/remote-debugging/local-server/
- Chrome 官方在 2025 年 3 月 17 日宣布，从 Chrome 136 开始，--remote-debugging-port 和 --remote-debugging-pipe 对默认数据目录不再生效，必须配合非默认的 --user-data-dir。
  来源: https://developer.chrome.com/blog/remote-debugging-port

- Chrome DevTools MCP 官方 README 也写了两条连接方式：
  用 --browser-url 连接一个带远程调试端口的 Chrome
  用 --autoConnect 连接当前正在运行的 Chrome
  来源: https://github.com/ChromeDevTools/chrome-devtools-mcp

- Chrome for Developers 在 2025 年 12 月的文章里明确说，Chrome 144+ 支持直接连接 active browser sessions，也就是复用当前浏览器会话。
  来源: https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session
