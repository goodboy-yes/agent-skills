---
name: chrome-devtools-cli
description: Use when 需要真实 Chrome 浏览器来排查页面问题、执行登录流程、检查 DOM 或 console、操作真实站点、截图、调试样式、分析性能，或完成其他浏览器驱动的工作流。需要当前登录态、真实页面状态、真实浏览器行为时，也要主动使用这个 skill，不要退回成纯代码猜测。
---

# Chrome DevTools CLI

当静态代码分析已经不够，而任务必须依赖真实 Chrome 会话时，使用这个 skill。

这个 skill 现在采用“编排层 + 单步脚本”的结构：

- `SKILL.md` 负责任务编排与分支判断
- `scripts/` 里的每个入口只做一个明确步骤
- `scripts/lib/` 负责可复用逻辑

不要把整个流程都压回 `ensure-browser-session.mjs`。它现在只是兼容入口，不是这个 skill 的主要使用方式。

## 编排流程

### 1. 先确认需要真实浏览器

当任务必须依赖下面这些真实信息时，再进入这个 skill：

- 当前登录态
- 真实 DOM / console / network / performance
- 真实页面渲染或交互结果
- 必须在真实 Chrome 中复现的问题

### 2. 先确保 Node 可用

先运行：

```bash
node skills/chrome-devtools-cli/scripts/ensure-supported-node.mjs
```

这个脚本只负责 Node 运行时：

- 当前 Node 满足要求时，直接返回
- 当前 Node 不满足要求时，尝试从 `nvm` 中找到受支持版本并重新运行脚本

### 3. 探测 CLI 能力

再运行：

```bash
node skills/chrome-devtools-cli/scripts/resolve-cli-runner.mjs
```

关注输出里的：

- `kind`
- `helpInfo`
- `capabilities.autoConnectMode`
- `capabilities.supportsWsEndpoint`

仍然要遵守这条规则：  
不要凭记忆假设 CLI 参数，必须以当前环境中的 `--help` 输出为准。

### 4. 探测浏览器状态

再运行：

```bash
node skills/chrome-devtools-cli/scripts/detect-browser-state.mjs
```

关注输出里的：

- `chromeRunning`
- `realUserDataDir`
- `liveBrowser`

### 5. 根据状态选择下一步

如果 `chromeRunning` 为 `true`：

```bash
node skills/chrome-devtools-cli/scripts/attach-to-running-browser.mjs
```

这个脚本会按顺序尝试：

1. `autoConnect`
2. `browserUrl`
3. `wsEndpoint`

如果当前 Chrome 已运行，但既不能复用调试端口，也不能 `autoConnect`，脚本会明确退出，并提示去 `chrome://inspect/#remote-debugging` 开启远程调试。

如果 `chromeRunning` 为 `false`：

先启动真实 profile 的调试 Chrome：

```bash
node skills/chrome-devtools-cli/scripts/launch-debug-chrome.mjs
```

然后用输出中的 `browserUrl` 再启动 CLI 会话：

```bash
node skills/chrome-devtools-cli/scripts/start-cli-session.mjs --browserUrl=http://127.0.0.1:9222
```

如果只有 WebSocket 端点，也可以：

```bash
node skills/chrome-devtools-cli/scripts/start-cli-session.mjs --wsEndpoint=ws://127.0.0.1:9222/devtools/browser/<id>
```

### 6. 执行实际浏览器任务

完成会话建立后，再去运行真正的 Chrome DevTools CLI 命令。

在执行任何 CLI 命令前，仍然要先读取当前环境里的实时帮助：

```bash
chrome-devtools-mcp --help
chrome-devtools --help
chrome-devtools <command> --help
```

如果当前机器还没有安装好本地 CLI，再退回到 `npx` 版本的帮助输出。

### 7. 清理

任务结束后，只停止 CLI daemon：

```bash
node skills/chrome-devtools-cli/scripts/stop-cli-session.mjs
```

不要关闭浏览器窗口。

## 脚本职责

- `ensure-supported-node.mjs`
  只处理 Node 版本与 `nvm` 回退
- `resolve-cli-runner.mjs`
  只处理 CLI 解析、安装与能力探测
- `detect-browser-state.mjs`
  只处理 Chrome 运行状态与调试端口探测
- `attach-to-running-browser.mjs`
  只处理“当前 Chrome 已运行”时的 attach
- `launch-debug-chrome.mjs`
  只处理“当前 Chrome 未运行”时的调试启动
- `start-cli-session.mjs`
  只处理把 CLI 接到一个已知 `browserUrl` / `wsEndpoint`
- `stop-cli-session.mjs`
  只处理 daemon 停止
- `ensure-browser-session.mjs`
  兼容入口；只有在确实需要一次性跑完整链路时才使用

## 使用规则

- 优先按分步脚本编排，不要默认先跑兼容总入口。
- 只复用真实 Chrome 登录态，不再创建 fallback profile，也不再复制用户数据目录。
- 如果当前 Chrome 已运行，优先尝试 attach；不要偷偷再开一个没有登录态的新实例。
- 如果当前 Chrome 没有运行，允许脚本直接用真实 profile 加调试端口拉起 Chrome。
- `DevToolsActivePort` 仍然优先用于发现 live session。
- 如果 `/json/version` 不可用，但 CLI 支持 `--wsEndpoint`，允许直接复用 WebSocket 端点。

## 参考资料

- [README.md](README.md)
- [CLI 速查](references/cli-quick-reference.md)
