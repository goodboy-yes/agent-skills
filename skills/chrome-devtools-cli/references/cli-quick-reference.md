# Chrome DevTools CLI 速查

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

如果需要禁止自动全局安装，只在当前 PowerShell 窗口里临时设置：

```powershell
$env:CHROME_DEVTOOLS_CLI_DISABLE_AUTO_INSTALL = "1"
```

重点看三种 transport：

- `--autoConnect`：通常出现在包根命令 `chrome-devtools-mcp --help`。
- `--browserUrl`：通过 `http://127.0.0.1:<port>/json/version` 发现 `webSocketDebuggerUrl`。
- `--wsEndpoint`：直接连接 `ws://127.0.0.1:<port>/devtools/browser/<id>`，跳过 `/json/version`。

## 会话流程

```bash
node skills/chrome-devtools-cli/scripts/ensure-browser-session.mjs
npx -y -p chrome-devtools-mcp@latest chrome-devtools --help
node skills/chrome-devtools-cli/scripts/stop-cli-session.mjs
```

## 使用边界

- 主路径是“本机 CLI -> 自动安装 latest CLI -> npx fallback”。
- 优先复用已经运行中的真实 Chrome。
- 如果 live Chrome 暴露 `/json/version`，优先走 `--browserUrl`。
- 如果 live Chrome 只提供 `DevToolsActivePort`，且 `chrome-devtools start` 支持 `--wsEndpoint`，则走 `--wsEndpoint` 直连。
- 只有在无法复用现有会话时，才使用固定回退 profile。
- 任务结束后保留浏览器，只停止 CLI daemon。
