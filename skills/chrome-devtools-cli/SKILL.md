---
name: chrome-devtools-cli
description: Use when 需要真实 Chrome 浏览器来排查页面问题、执行登录流程、检查 DOM 或 console、操作真实站点、截图、调试样式、分析性能，或完成其他浏览器驱动的工作流，并且不希望让用户手动配置 MCP。
---

# Chrome DevTools CLI

当静态代码分析已经不够，而任务必须依赖真实 Chrome 会话时，使用这个 skill。

## 工作流程

1. 先确认当前任务确实需要真实浏览器，而不是仅靠代码阅读就能完成。
2. 优先运行会话引导脚本：

```bash
node skills/chrome-devtools-cli/scripts/ensure-browser-session.mjs
```

3. 在执行任何 CLI 命令前，先读取当前环境里的实时帮助：

```bash
npx -y chrome-devtools-mcp@latest --help
npx -y -p chrome-devtools-mcp@latest chrome-devtools --help
npx -y -p chrome-devtools-mcp@latest chrome-devtools <command> --help
```

4. 使用 Chrome DevTools CLI 完成实际的浏览器任务。
5. 任务结束后，只停止 CLI daemon：

```bash
node skills/chrome-devtools-cli/scripts/stop-cli-session.mjs
```

## 使用规则

- 不要凭记忆假设 CLI 参数，必须以当前环境中的 `--help` 输出为准。
- `DevToolsActivePort` 优先用于发现 live session。
- 如果 `chrome-devtools start --help` 支持 `--wsEndpoint`，而 `/json/version` 又不可用，允许直接复用 `DevToolsActivePort` 中的 WebSocket 端点。
- 优先复用已经运行中的 Chrome 会话。
- 如果无法直接复用，再回退到这个 skill 管理的固定回退 profile 副本。
- 如果 profile 同步失败，也要继续尝试使用固定回退 profile，而不是直接终止。
- 清理阶段不要关闭浏览器，只停止 CLI daemon。

## 参考资料

- [CLI 速查](references/cli-quick-reference.md)
- [Profile 策略](references/profile-strategy.md)
