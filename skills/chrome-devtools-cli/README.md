# Chrome DevTools CLI Skill

这个 skill 现在采用完全拆分的结构：

- `SKILL.md` 负责流程编排
- `scripts/` 负责单步命令入口
- `scripts/lib/` 负责可复用逻辑

主目标仍然是同一个：尽量把 `chrome-devtools-mcp` 接到用户当前的真实 Chrome 登录态。

## 设计原则

- 不把所有逻辑都塞进一个总入口脚本
- 每个脚本只负责一个明确动作
- skill 本身要能表达“先探测、再判断、再执行”的流程
- `ensure-browser-session.mjs` 只保留兼容价值，不再作为默认入口

## 脚本清单

### 运行时与环境

- [scripts/ensure-supported-node.mjs](scripts/ensure-supported-node.mjs)
  - 检查当前 Node 是否满足要求
  - 不满足时尝试从 `nvm` 找受支持版本并重启当前脚本

- [scripts/resolve-cli-runner.mjs](scripts/resolve-cli-runner.mjs)
  - 探测本机 CLI / 自动安装 / `npx` fallback
  - 输出 `autoConnect`、`wsEndpoint` 等能力信息

### 浏览器状态

- [scripts/detect-browser-state.mjs](scripts/detect-browser-state.mjs)
  - 判断 Chrome 是否在运行
  - 判断真实 profile 是否已经暴露可复用调试入口

### 会话动作

- [scripts/attach-to-running-browser.mjs](scripts/attach-to-running-browser.mjs)
  - 只处理“Chrome 已运行”时的 attach
  - 优先 `autoConnect`
  - 再尝试 `browserUrl` / `wsEndpoint`

- [scripts/launch-debug-chrome.mjs](scripts/launch-debug-chrome.mjs)
  - 只处理“Chrome 未运行”时，用真实 profile + 调试端口启动 Chrome
  - 只负责启动并等待浏览器 ready，不负责启动 CLI 会话

- [scripts/start-cli-session.mjs](scripts/start-cli-session.mjs)
  - 把 CLI 接到一个已知的 `browserUrl`、`wsEndpoint` 或 `autoConnect`

- [scripts/stop-cli-session.mjs](scripts/stop-cli-session.mjs)
  - 只停止 CLI daemon
  - 不关闭浏览器窗口

### 兼容入口

- [scripts/ensure-browser-session.mjs](scripts/ensure-browser-session.mjs)
  - 一次性跑完整链路的兼容包装
  - 内部已经退化成薄 orchestration，不再承载主要职责

## 推荐用法

### 分步用法

1. 确保 Node 可用

```bash
node skills/chrome-devtools-cli/scripts/ensure-supported-node.mjs
```

2. 探测 CLI 能力

```bash
node skills/chrome-devtools-cli/scripts/resolve-cli-runner.mjs
```

3. 探测浏览器状态

```bash
node skills/chrome-devtools-cli/scripts/detect-browser-state.mjs
```

4. 如果 Chrome 已运行，直接 attach

```bash
node skills/chrome-devtools-cli/scripts/attach-to-running-browser.mjs
```

5. 如果 Chrome 未运行，先启动调试 Chrome，再启动 CLI 会话

```bash
node skills/chrome-devtools-cli/scripts/launch-debug-chrome.mjs
node skills/chrome-devtools-cli/scripts/start-cli-session.mjs --browserUrl=http://127.0.0.1:9222
```

### 兼容总入口

如果你就是想一次性跑完整链路，也可以继续用：

```bash
node skills/chrome-devtools-cli/scripts/ensure-browser-session.mjs
```

但从 skill 设计上，它已经不是推荐主路径了。

## 当前边界

- 只复用真实 Chrome 登录态
- 不再维护 fallback profile
- 不再复制 `User Data`
- 不再尝试“新开隔离实例同时继承登录态”
- 如果当前 Chrome 已运行但既没有调试端口也不能 `autoConnect`，脚本会明确退出并提示用户开启远程调试

## 关键模块

- [scripts/lib/cli-runner.mjs](scripts/lib/cli-runner.mjs)
  - CLI 发现、安装、help 探测

- [scripts/lib/browser-state.mjs](scripts/lib/browser-state.mjs)
  - 浏览器运行状态和 live session 探测

- [scripts/lib/session-actions.mjs](scripts/lib/session-actions.mjs)
  - attach / launch 这两类动作

- [scripts/lib/session-manager.mjs](scripts/lib/session-manager.mjs)
  - 薄编排层与兼容导出

- [scripts/lib/script-runtime.mjs](scripts/lib/script-runtime.mjs)
  - 脚本统一的 Node bootstrap 和 JSON 输出包装
