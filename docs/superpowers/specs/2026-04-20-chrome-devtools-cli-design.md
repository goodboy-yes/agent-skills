# Chrome DevTools CLI Skill 设计方案

日期：2026-04-20
主题：`chrome-devtools-cli`

## 1. 概述

这个 skill 的目标是为 agent 提供基于 Chrome DevTools CLI 的浏览器读取与控制能力，并且不要求用户手动配置 MCP。

这个 skill 面向“必须使用真实 Chrome 浏览器才能完成任务”的场景，例如：

- 排查页面白屏或运行时错误
- 打开站点、登录后台，并检查 console 或 network 报错
- 抓取页面的 DOM、console、截图或性能数据
- 在真实网站上执行浏览器操作
- 调查样式为什么没有生效
- 评估页面性能
- 其他任何必须读取浏览器状态或操作真实浏览器实例的任务

这个 skill 不负责定义具体业务任务。它负责提供一个稳定的浏览器会话建立与复用流程，让 agent 可以根据任务决定需要执行哪些浏览器操作。

## 2. 目标

- 在 agent 需要 Chrome DevTools 浏览器能力时，免去用户手动配置 MCP 的步骤。
- 尽可能优先复用一个真实、正在运行的 Chrome 会话，以保留 cookie、登录态和当前用户上下文。
- 当无法直接复用真实会话时，回退到一个稳定、可复用的 profile 副本。
- 第一版即支持 Windows、macOS 和 Linux。
- 明确要求 agent 通过 `--help` 学习当前 CLI 能力，而不是依赖陈旧记忆。
- 在任务结束后停止 CLI daemon，但保留浏览器实例，便于后续复用。

## 3. 非目标

- 替代上游 `chrome-devtools-mcp` 包本身。
- 实现一个超出 Chrome DevTools CLI 范围的通用浏览器自动化框架。
- 在使用浏览器状态前强制向用户二次确认。这个 skill 默认在 agent 判断“确实需要浏览器能力”时自动执行。
- 在任务完成时关闭浏览器或清理浏览器状态。

## 4. 上游约束与已核实事实

这个设计必须以 `chrome-devtools-mcp` 当前真实行为为准，而不是只根据 README 的表述来推断。

### 4.1 Node 版本要求

当前上游包的 `engines` 要求为：

- `^20.19.0 || ^22.12.0 || >=23`

如果本机 Node 版本不满足要求，这个 skill 必须在任何浏览器操作之前停止，并明确说明版本不兼容。

### 4.2 CLI 帮助信息探测

当前上游支持通过以下命令查看帮助：

- `npx -y chrome-devtools-mcp@latest --help`
- `npx -y -p chrome-devtools-mcp@latest chrome-devtools --help`
- `npx -y -p chrome-devtools-mcp@latest chrome-devtools start --help`

这个 skill 必须优先依赖实时 help 输出，而不是把参数表写死在 skill 里。

### 4.3 当前 CLI 的限制

包级别的 MCP server 支持 `--autoConnect`，但 `chrome-devtools start` 这个 CLI 子命令目前并没有暴露 `--autoConnect`。

这会直接影响本 skill 想要实现的流程：

1. 优先复用正在运行的 Chrome
2. 复用失败时，再回退到一个可复用的专用 profile

因此，这个 skill 必须补一层编排逻辑，而不能假设 `chrome-devtools start --autoConnect` 当前可用。

### 4.4 CLI 默认 profile 目录规则

根据上游源码，CLI 在非 `isolated` 模式下使用的 profile 目录为：

- `os.homedir()/.cache/chrome-devtools-mcp-cli/chrome-profile`
- 非 stable 通道：`os.homedir()/.cache/chrome-devtools-mcp-cli/chrome-profile-<channel>`

这个源码级行为应作为本 skill 的固定副本目录规则。也就是说，本 skill 的 fallback profile 目录要与它保持一致，而不是另起一套命名方式。

### 4.5 CLI 停止后的行为要求

本 skill 的要求是：任务结束后停止 CLI daemon，但不关闭浏览器。

因此，fallback 路径里不能把浏览器交给 CLI 自己启动和管理。否则停止 CLI 时，浏览器可能会一并被关闭。更稳妥的做法是：

- 由 skill 自己启动 fallback Chrome
- 再通过 `--browserUrl` 让 CLI 连接过去

## 5. 触发语义

当用户请求本质上需要一个真实浏览器才能完成时，这个 skill 就应该触发，即使用户从未提到 Chrome DevTools CLI、CDP 或 MCP。

### 正向触发

- “帮我看看这个页面为什么白屏”
- “打开浏览器登录一下后台，然后检查报错”
- “抓一下这个页面的 DOM 和 console 信息”
- “打开某个网址进行某些操作”
- “查看这里的样式为什么出不来”
- “评估这个页面的性能”
- 任何需要真实页面状态、真实渲染、实时 DOM、真实 cookie、console 消息、network 请求、截图或浏览器交互的任务

### 反向边界

以下情况不应触发：

- 仅靠静态代码分析就足够
- 请求只是概念解释、文档问答或工具介绍
- 用户只是在抽象地提到“浏览器”，但任务不需要真实浏览器参与

## 6. 总体架构

这个 skill 将采用“轻量 SKILL 文档 + 小型 Node 编排脚本”的结构。

计划目录如下：

```text
skills/chrome-devtools-cli/
├── SKILL.md
├── scripts/
│   ├── ensure-browser-session.mjs
│   ├── stop-cli-session.mjs
│   ├── detect-platform-paths.mjs
│   ├── sync-profile-copy.mjs
│   └── probe-devtools-endpoint.mjs
└── references/
    ├── cli-quick-reference.md
    └── profile-strategy.md
```

职责分工如下：

- `SKILL.md`：负责触发条件、执行顺序、决策规则，以及“先看 help 再操作”的使用原则
- `ensure-browser-session.mjs`：负责环境预检、help 探测、复用正在运行的浏览器、fallback 启动，并输出可用的 `browserUrl`
- `stop-cli-session.mjs`：只停止 `chrome-devtools` daemon
- `detect-platform-paths.mjs`：解析 Chrome 可执行文件候选路径、真实 profile 路径以及 fallback 目录
- `sync-profile-copy.mjs`：把真实 user data dir 的内容更新到固定 fallback profile
- `probe-devtools-endpoint.mjs`：验证某个发现到的端口或 endpoint 是否真的可连接
- `references/*`：只在实时 help 不可用或需要解释平台差异时按需加载

## 7. 会话策略

这个 skill 需要按照固定优先级建立浏览器会话。

### 7.1 预检

在执行任何浏览器操作之前，先做以下检查：

1. 检查 `node --version`
2. 按上游要求校验 Node 版本
3. 检查 `npx` 是否可用
4. 通过以下命令学习当前 CLI 能力：
   - `npx -y chrome-devtools-mcp@latest --help`
   - `npx -y -p chrome-devtools-mcp@latest chrome-devtools --help`
   - `npx -y -p chrome-devtools-mcp@latest chrome-devtools start --help`

如果预检失败，则立即停止，并向用户说明具体原因。

### 7.2 优先路径：复用正在运行的 Chrome

本 skill 优先复用已经运行中的浏览器实例，因为这样最有机会保留真实登录态和当前上下文。

这一条路径分为两种子模式：

1. 官方 `autoConnect` 模式
   - 如果实时 help 显示当前调用入口支持一个满足要求的 `--autoConnect` 流程，优先使用官方方式。
   - 这是未来最优的官方路径，尤其适用于上游 CLI 在后续版本中直接暴露该能力的情况。
2. 当前版本下的手动复用模式
   - 如果当前实际使用的 CLI 入口没有暴露 `--autoConnect`，则先解析真实 Chrome 的 user data dir。
   - 检查该目录下是否存在 `DevToolsActivePort`
   - 如果存在则尝试解析
   - 对解析出来的 endpoint 做实际连通性探测
   - 如果探测成功，则使用 `--browserUrl=http://127.0.0.1:<port>` 启动 CLI 并连接该浏览器

重要说明：

- `DevToolsActivePort` 的存在只能视为“候选信号”，不能直接当成“已可用”
- 必须额外做一次连通性验证
- 实现上不能把“approval/auto-connect 风格的复用”和“手动 `--browserUrl` 复用”当成完全相同的机制，尽管它们都可能达成“复用现有浏览器”的目标

### 7.3 fallback 路径：固定 profile 副本

如果无法复用正在运行的浏览器，则进入 fallback：

1. 根据上游 CLI 的目录规则解析固定 fallback profile 目录
2. 尝试把真实 user data dir 同步到这个固定 fallback profile
3. 如果同步成功，则使用更新后的 fallback profile
4. 如果同步失败，仍然继续使用这个 fallback profile 目录
5. 独立启动一个新的 Chrome 进程，并附带：
   - `--remote-debugging-port=<chosen-port>`
   - `--user-data-dir=<fixed-fallback-profile>`
6. 再用 `--browserUrl=http://127.0.0.1:<chosen-port>` 启动 CLI 并连接这个浏览器

这样即使 profile 同步失败，fallback 仍然可用，最坏情况只是登录态不完整，而不是整个 skill 失效。

### 7.4 任务结束后的处理

当浏览器任务完成后：

1. 停止 CLI daemon
2. 不关闭浏览器
3. 保留固定 fallback profile 目录，供下次继续使用

这样下一次任务可以更快建立连接，并保留尽可能多的状态。

## 8. `DevToolsActivePort` 的语义

`DevToolsActivePort` 是 Chromium 在某些远程调试场景下写入 user data dir 的一个约定文件，其中包含当前远程调试服务的端口以及浏览器 target 信息，供 ChromeDriver、Telemetry、`chrome-devtools-mcp` 等工具用于连接引导。

使用这个文件时应遵循以下原则：

- 文件存在，并不等于 endpoint 一定可用
- 文件不存在，也不等于当前 Chrome 在所有连接模式下都不可用
- 它适合被当作“复用现有浏览器”的发现信号
- 但必须在此基础上再做实际探测

本 skill 应明确区分两类连接模式：

- approval / auto-connect 风格的复用路径
- 基于 remote debugging port 和 `--browserUrl` 的手动连接路径

实现上不应把这两种模式直接混为一谈，即便它们在某些情况下都可能涉及 `DevToolsActivePort`。

## 9. 跨平台路径规则

这个 skill 必须支持 Windows、macOS 和 Linux。

### 9.1 真实 Chrome user data dir

编排层应按以下顺序解析：

1. 允许通过环境变量或配置显式覆盖
2. 无覆盖时，按平台默认规则查找
3. 查找失败时，给出明确错误提示

真实 user data dir 只用于：

- 判断是否可以复用正在运行的 Chrome
- 尽力同步到 fallback profile

### 9.2 固定 fallback profile 目录

固定 fallback 目录必须遵循上游 CLI 规则：

- stable：
  - `~/.cache/chrome-devtools-mcp-cli/chrome-profile`
- canary / beta / dev：
  - `~/.cache/chrome-devtools-mcp-cli/chrome-profile-<channel>`

在 Windows 上也应遵循 `os.homedir()` 语义，通常会映射到 `%USERPROFILE%`。

## 10. Profile 同步规则

profile 同步属于 best-effort 行为。

必须满足以下约束：

- 使用一个固定 fallback profile 目录，而不是每次新建一个目录
- 后续运行时更新这个固定目录，而不是重新生成多个副本
- 同步时排除锁文件、调试引导文件等不适合复制的瞬时文件
- 同步失败只作为 warning，不作为致命错误

也就是说，即使本次同步失败，skill 仍应继续使用这个 fallback profile。最坏情况只是登录态缺失或过期，而浏览器能力仍应可用。

## 11. 面向 agent 的使用规则

`SKILL.md` 需要明确告诉 agent 按以下顺序工作：

1. 先判断当前任务是否真的需要真实浏览器
2. 运行预检
3. 通过 `--help` 学习当前 CLI 能力边界
4. 优先复用现有 Chrome 会话
5. 复用失败时，回退到固定 profile 副本
6. 使用 CLI 完成实际浏览器任务
7. 在结束时只停止 CLI daemon

同时，skill 还应明确禁止 agent：

- 不看 `--help` 就凭记忆假设 CLI 参数
- 把 `DevToolsActivePort` 当作“已可用”的充分证据
- 每次运行都新建一个 fallback profile 目录
- 在清理阶段关闭浏览器

## 12. 面向未来的兼容规则

因为上游行为未来可能变化，这个 skill 需要保留一条兼容规则：

- 如果未来实时 help 输出显示 `chrome-devtools start --autoConnect` 已经可直接满足复用要求，则优先改走这个官方路径，而不是继续使用 skill 自己的编排 fallback。

这样可以在不改变用户使用体验的前提下，持续跟随上游演进。

## 13. 验证计划

第一版实现至少需要验证以下场景：

1. Node 版本过低
   - 预期：明确报错并终止
2. help 探测正常
   - 预期：脚本能正确学习当前命令和参数
3. 现有 Chrome 可复用
   - 预期：直接连接，不新开浏览器
4. 现有会话不可复用，但同步成功
   - 预期：使用固定 profile 副本启动 fallback Chrome
5. 现有会话不可复用，且同步失败
   - 预期：仍然继续 fallback 启动
6. CLI 停止
   - 预期：daemon 停止，但浏览器仍保留
7. 第二次运行
   - 预期：复用同一个固定 fallback profile 目录

跨平台验证重点包括：

- 路径解析
- Chrome 可执行文件解析
- 端口探测
- fallback profile 复用
- 清理时保证浏览器不被关闭

## 14. 已确认的实现决策

以下设计决策已经确定，不再在实现阶段重复讨论：

- 使用“脚本驱动型 skill”，而不是纯文档型 skill
- 第一版即支持 Windows、macOS 和 Linux
- 默认自动执行，不要求额外确认
- 使用 `npx` 调用上游包
- 固定 fallback 目录遵循上游 CLI 规则
- profile 同步失败不导致整个会话失败
- 任务结束时停止 CLI，但保留浏览器

## 15. 参考资料

- Chrome DevTools MCP README：
  - https://github.com/ChromeDevTools/chrome-devtools-mcp
- Chrome DevTools MCP CLI 文档：
  - https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/cli.md
- 上游包清单：
  - https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/package.json
- Chromium user data directory 文档：
  - https://chromium.googlesource.com/chromium/src/+/HEAD/docs/user_data_dir.md
- Chrome 关于 remote debugging 开关的安全说明：
  - https://developer.chrome.com/blog/remote-debugging-port
