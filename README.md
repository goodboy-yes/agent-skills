# agent-skills

一些agent skills 集合

> [!IMPORTANT]
> skills通过Vibe Coding生成，还没有完全测试这些技能在实践中的表现，欢迎反馈和贡献。

## 安装

```bash
pnpx skills add goodboy-yes/agent-skills
```

全部安装：

```bash
pnpx skills add goodboy-yes/agent-skills --skill='*'
```

全部安装到全局：

```bash
pnpx skills add goodboy-yes/agent-skills --skill='*' -g
```

Learn more about the CLI usage at [skills](https://github.com/vercel-labs/skills).

## skills 说明

### reverse-modeling

通过逆向建模构建软件需求的结构化方法。将现有代码逆向工程为三部分模型（实体、流程、规则），分析需求变更与模型的差异，并生成有序的实施计划。
适用场景：
（1）在现有代码库中开发新功能，
（2）迭代需求，
（3）用户提及需求分析、设计或建模，
（4）需了解现有情况在修改代码结构前，
（5）用户要求分析需求变更的影响。

### chrome-devtools-cli

为 agent 提供 Chrome DevTools CLI 浏览器能力，无需手动配置 MCP。
适用场景：
（1）排查页面白屏、样式异常或运行时报错，
（2）打开网页并执行交互操作，
（3）抓取 DOM、console、network、截图等浏览器信息，
（4）评估页面性能，
（5）需要复用现有 Chrome 登录态或使用固定 fallback profile 的浏览器任务。

## 设计方案

plan目录存放各skills设计方案
