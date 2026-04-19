# Chrome DevTools CLI Skill Design

Date: 2026-04-20
Topic: `chrome-devtools-cli`

## 1. Overview

This skill gives an agent browser read/control capability through the Chrome DevTools CLI workflow without requiring the user to manually configure MCP.

The skill targets tasks where the agent must use a real Chrome browser to satisfy the request, such as:

- Debugging a white screen or runtime failure on a page
- Opening a site, logging in, and inspecting console or network errors
- Capturing DOM, console, screenshot, or performance data from a page
- Executing browser actions on a live website
- Investigating why styles do not apply
- Evaluating page performance
- Any other task that requires reading browser state or interacting with a real browser instance

The skill does not define the business task itself. It provides a reliable browser session establishment and reuse workflow so the agent can decide what browser operations are needed.

## 2. Goals

- Remove the need for manual MCP configuration when an agent needs Chrome DevTools browser capabilities.
- Prefer reusing a real running Chrome session so cookies, login state, and user context are preserved when possible.
- Fall back to a stable, reusable profile copy when direct reuse is unavailable.
- Support Windows, macOS, and Linux from the first version.
- Teach the agent to learn the current CLI surface from `--help` instead of relying on stale assumptions.
- Stop the CLI daemon after the task, while keeping any browser instance alive for later reuse.

## 3. Non-goals

- Replace the upstream `chrome-devtools-mcp` package.
- Implement a generic browser automation framework beyond Chrome DevTools CLI.
- Force the user to confirm before using browser state. This skill defaults to automatic execution when the agent determines browser access is necessary.
- Close or clean up the browser at task completion.

## 4. Upstream Constraints and Facts

The design must follow the current behavior of `chrome-devtools-mcp` rather than README assumptions alone.

### 4.1 Node requirement

Current upstream package engines:

- `^20.19.0 || ^22.12.0 || >=23`

If the local Node version does not satisfy this requirement, the skill must stop before attempting browser work and explain the version mismatch.

### 4.2 CLI help discovery

The upstream package currently supports help discovery through commands such as:

- `npx -y chrome-devtools-mcp@latest --help`
- `npx -y -p chrome-devtools-mcp@latest chrome-devtools --help`
- `npx -y -p chrome-devtools-mcp@latest chrome-devtools start --help`

The skill must prefer live help output over baked-in command knowledge.

### 4.3 Current CLI limitation

The package-level MCP server supports `--autoConnect`, but the `chrome-devtools start` CLI command does not currently expose `--autoConnect`.

This matters because the skill wants a workflow equivalent to:

1. Reuse a running Chrome when possible
2. Fall back to a dedicated reusable browser profile when not possible

Therefore the skill must provide an orchestration layer rather than assuming `chrome-devtools start --autoConnect` exists.

### 4.4 Default CLI profile directory behavior

Upstream source currently computes the non-isolated CLI profile directory under:

- `os.homedir()/.cache/chrome-devtools-mcp-cli/chrome-profile`
- Non-stable channels: `os.homedir()/.cache/chrome-devtools-mcp-cli/chrome-profile-<channel>`

This source-level behavior is the canonical rule for this skill. The skill will align its fixed fallback profile copy with this rule.

### 4.5 CLI stop behavior requirement

This skill must stop the CLI daemon after finishing work, but must not close the browser. Therefore fallback browser launch cannot rely on the CLI launching and owning the browser process. The skill must launch the fallback browser separately and connect the CLI to it through `--browserUrl`.

## 5. Trigger Semantics

The skill should trigger when the user request requires a real browser in order to complete the task, even if the user never mentions Chrome DevTools CLI, CDP, or MCP.

### Positive triggers

- “帮我看看这个页面为什么白屏”
- “打开浏览器登录一下后台，然后检查报错”
- “抓一下这个页面的 DOM 和 console 信息”
- “打开某个网址进行某些操作”
- “查看这里的样式为什么出不来”
- “评估这个页面的性能”
- Any request that needs page state, actual rendering, live DOM, real cookies, console messages, network requests, screenshots, or browser-driven interaction

### Negative triggers

Do not trigger when:

- Static code inspection is sufficient
- The request is only conceptual or documentation-oriented
- The user only mentions browsers abstractly, but no live browser interaction is needed

## 6. High-level Architecture

The skill will be implemented as a lightweight skill document plus a small Node-based orchestration layer.

Planned structure:

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

Responsibilities:

- `SKILL.md`: trigger language, execution order, decision rules, and command-learning guidance
- `ensure-browser-session.mjs`: environment preflight, help probing, reuse detection, fallback startup, and emission of a usable `browserUrl`
- `stop-cli-session.mjs`: stop `chrome-devtools` daemon only
- `detect-platform-paths.mjs`: resolve Chrome executable candidates, profile paths, and cache/fallback locations
- `sync-profile-copy.mjs`: update the fixed fallback profile copy from the real user data dir
- `probe-devtools-endpoint.mjs`: verify that a discovered port or endpoint is actually connectable
- `references/*`: short supporting docs used only when live help is unavailable or a platform detail needs explanation

## 7. Session Strategy

The skill establishes a browser session using a strict priority order.

### 7.1 Preflight

Before any browser action:

1. Check `node --version`
2. Validate it against the upstream requirement
3. Check that `npx` is available
4. Learn the current CLI surface from:
   - `npx -y chrome-devtools-mcp@latest --help`
   - `npx -y -p chrome-devtools-mcp@latest chrome-devtools --help`
   - `npx -y -p chrome-devtools-mcp@latest chrome-devtools start --help`

If preflight fails, stop and report the reason.

### 7.2 Preferred path: reuse a running Chrome

The skill prefers a running browser instance because it preserves real login state and current browsing context.

This path has two sub-modes:

1. Official auto-connect mode
   - If live help for the upstream entrypoint exposes a supported `--autoConnect` path that fits the current invocation flow, prefer it.
   - This is the preferred official route for Chrome versions and CLI shapes that support it directly.
2. Current manual reuse mode
   - If the active CLI entrypoint in use does not expose `--autoConnect`, resolve the target real Chrome user data directory.
   - Check whether `DevToolsActivePort` exists in that user data directory.
   - Parse the file if present.
   - Probe the resulting endpoint to verify that it is actually usable.
   - If valid, start the CLI using `--browserUrl=http://127.0.0.1:<port>`.

Important:

- `DevToolsActivePort` presence is only a candidate signal.
- The endpoint must still be probed before treating the running instance as reusable.
- The implementation must not assume that approval-style reuse and manual `--browserUrl` reuse are the same mechanism, even if both can lead to successful reuse of an existing browser session.

### 7.3 Fallback path: fixed profile copy

If the running browser cannot be reused:

1. Resolve the fixed fallback profile directory using the upstream CLI naming rule
2. Attempt to synchronize the real user data directory into that fixed fallback profile
3. If sync succeeds, use the updated fixed profile
4. If sync fails, continue anyway using the fixed profile directory as-is
5. Launch a separate Chrome process with:
   - `--remote-debugging-port=<chosen-port>`
   - `--user-data-dir=<fixed-fallback-profile>`
6. Start the CLI using `--browserUrl=http://127.0.0.1:<chosen-port>`

This keeps the fallback usable even when login-state preservation is incomplete.

### 7.4 End of task

When the browser task is complete:

1. Stop the CLI daemon
2. Do not close the browser
3. Keep the fixed fallback profile directory for later reuse

This allows later tasks to reconnect quickly and preserves as much state as possible.

## 8. DevToolsActivePort Semantics

`DevToolsActivePort` is a well-known file in the user data directory that Chromium writes when the remote debugging server is available. It contains the active debugging port and browser target information that tools can use to bootstrap a connection.

This file should be treated carefully:

- Its presence does not guarantee that the endpoint is currently reachable
- Its absence does not prove that Chrome is unusable for all connection modes
- It is useful as a discovery hint for reuse logic
- It must be followed by an actual connectivity probe

The skill should document two distinct connection modes:

- Approval or auto-connect style reuse of a running Chrome session
- Manual connection through a remote debugging port and `--browserUrl`

The implementation should avoid assuming that these two modes are identical, even though both may involve reading or reusing information associated with `DevToolsActivePort`.

## 9. Cross-platform Path Rules

The skill must support Windows, macOS, and Linux.

### 9.1 Real Chrome user data directory

The orchestration layer should:

1. Allow explicit override by environment variable or config
2. Otherwise resolve by platform defaults
3. Report a clear error when resolution fails

The real user data directory is only used as a source for reuse detection and best-effort profile synchronization.

### 9.2 Fixed fallback profile directory

The fixed fallback directory must follow upstream CLI behavior:

- Stable:
  - `~/.cache/chrome-devtools-mcp-cli/chrome-profile`
- Canary/Beta/Dev:
  - `~/.cache/chrome-devtools-mcp-cli/chrome-profile-<channel>`

On Windows this still follows `os.homedir()` semantics, which typically maps to `%USERPROFILE%`.

## 10. Profile Synchronization Rules

Profile synchronization is best-effort.

Required behavior:

- Reuse one fixed fallback profile directory instead of creating a new copy per run
- Update the existing fallback profile on later runs
- Exclude transient lock and debugging bootstrap files that should not be copied
- Treat sync failure as a warning, not a fatal error

The skill should continue with the fallback profile even if the latest sync attempt fails. The worst-case outcome is that login state is missing or stale, but browser automation remains available.

## 11. Agent-facing Usage Rules

The skill should instruct the agent to work in the following order:

1. Confirm that a real browser is needed
2. Run preflight checks
3. Learn the current CLI surface from `--help`
4. Prefer reuse of an existing Chrome session
5. Fall back to the fixed profile copy when reuse is unavailable
6. Use the CLI to perform the actual browser task
7. Stop only the CLI daemon at the end

The skill should explicitly tell the agent not to:

- Assume CLI flags from memory without checking `--help`
- Treat `DevToolsActivePort` as sufficient proof of connectivity
- Create a fresh fallback profile directory per run
- Close the browser during cleanup

## 12. Future-proofing Rule

Because upstream behavior may change, the skill should contain one compatibility rule:

- If future live `--help` output exposes a direct `chrome-devtools start --autoConnect` path that satisfies the reuse requirement, prefer that official path over the orchestration fallback.

This keeps the skill aligned with upstream evolution without forcing a different user experience.

## 13. Validation Plan

The first implementation should be validated against the following scenarios:

1. Node version too old
   - Expect a clear preflight failure
2. Help discovery works
   - Expect the scripts to learn current commands successfully
3. Existing reusable Chrome session available
   - Expect direct connection without launching a new browser
4. Existing session unavailable, sync succeeds
   - Expect fallback Chrome launch with fixed profile copy
5. Existing session unavailable, sync fails
   - Expect fallback Chrome launch to continue anyway
6. CLI stop after task
   - Expect daemon to stop while browser remains alive
7. Second run after fallback launch
   - Expect reuse of the same fixed fallback profile directory

Cross-platform validation should focus on:

- Path resolution
- Chrome executable resolution
- Port probing
- Fallback profile reuse
- Cleanup that leaves the browser process intact

## 14. Open Implementation Decisions That Are Already Resolved

The following design decisions are fixed for implementation:

- Use a script-backed skill, not a documentation-only skill
- Support Windows, macOS, and Linux from v1
- Default to automatic execution without extra confirmation
- Use `npx` to access upstream package behavior
- Use upstream CLI profile directory rules for the fixed fallback location
- Do not fail the whole session when profile sync fails
- Stop the CLI after work, but keep the browser alive

## 15. References

- Chrome DevTools MCP README:
  - https://github.com/ChromeDevTools/chrome-devtools-mcp
- Chrome DevTools MCP CLI docs:
  - https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/cli.md
- Upstream package manifest:
  - https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/package.json
- Chromium user data directory documentation:
  - https://chromium.googlesource.com/chromium/src/+/HEAD/docs/user_data_dir.md
- Chrome security note on remote debugging switches:
  - https://developer.chrome.com/blog/remote-debugging-port
