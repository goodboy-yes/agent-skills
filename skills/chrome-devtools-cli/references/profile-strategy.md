# Profile 策略

## Profile 类型

- 真实 user data dir：用于发现并复用用户当前正在使用的 Chrome 会话。
- 固定回退 profile：当真实会话无法直接复用时，用它来启动和复用备用浏览器会话。

## 固定回退目录

- `stable`: `~/.cache/chrome-devtools-mcp-cli/chrome-profile`
- `beta`: `~/.cache/chrome-devtools-mcp-cli/chrome-profile-beta`
- `dev`: `~/.cache/chrome-devtools-mcp-cli/chrome-profile-dev`
- `canary`: `~/.cache/chrome-devtools-mcp-cli/chrome-profile-canary`

## 同步策略

- 同步采用尽力而为的策略，尽量把真实 profile 的状态更新到固定回退 profile。
- 需要跳过 `DevToolsActivePort`、`Singleton*`、`Cache`、`Code Cache` 这类瞬时文件。
- 同步失败只记为警告，不应成为致命错误。

## 清理策略

- 任务结束后停止 Chrome DevTools CLI daemon。
- 不要关闭浏览器。
- 保留固定回退 profile，供后续任务继续复用。
