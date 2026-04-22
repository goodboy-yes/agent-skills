# Chrome DevTools CLI 速查

## 推荐脚本顺序

```bash
node skills/chrome-devtools-cli/scripts/ensure-supported-node.mjs
node skills/chrome-devtools-cli/scripts/resolve-cli-runner.mjs
node skills/chrome-devtools-cli/scripts/detect-browser-state.mjs
```

如果 Chrome 已运行：

```bash
node skills/chrome-devtools-cli/scripts/attach-to-running-browser.mjs
```

如果 Chrome 未运行：

```bash
node skills/chrome-devtools-cli/scripts/launch-debug-chrome.mjs
node skills/chrome-devtools-cli/scripts/start-cli-session.mjs --browserUrl=http://127.0.0.1:9222
```

## 先查看当前 CLI 能力

```bash
chrome-devtools-mcp --help
chrome-devtools --help
chrome-devtools <command> --help
```

如果本机还没有可用 CLI，再改用：

```bash
npx -y chrome-devtools-mcp@latest --help
npx -y -p chrome-devtools-mcp@latest chrome-devtools --help
npx -y -p chrome-devtools-mcp@latest chrome-devtools <command> --help
```

重点看三种 transport：

- `--autoConnect`：通常出现在包根命令 `chrome-devtools-mcp --help`。
- `--browserUrl`：通过 `http://127.0.0.1:<port>/json/version` 发现 `webSocketDebuggerUrl`。
- `--wsEndpoint`：直接连接 `ws://127.0.0.1:<port>/devtools/browser/<id>`，跳过 `/json/version`。

## 会话流程

```bash
node skills/chrome-devtools-cli/scripts/ensure-browser-session.mjs
node skills/chrome-devtools-cli/scripts/stop-cli-session.mjs
```

`ensure-browser-session.mjs` 现在只是兼容入口，不是推荐主路径。

## 使用边界

- 主路径是“本机 CLI -> 自动安装 latest CLI -> npx fallback”。
- 优先复用已经运行中的真实 Chrome 登录态。
- 如果 live Chrome 暴露 `/json/version`，优先走 `--browserUrl`。
- 如果 live Chrome 只提供 `DevToolsActivePort`，且 `chrome-devtools start` 支持 `--wsEndpoint`，则走 `--wsEndpoint` 直连。
- 如果当前 Chrome 已运行，但既不能 `autoConnect` 也没有调试端口，脚本会退出并提示用户去 `chrome://inspect/#remote-debugging` 开启远程调试。
- 如果当前 Chrome 没有运行，脚本会直接用真实 profile 带调试端口启动 Chrome。
- 任务结束后保留浏览器，只停止 CLI daemon。
