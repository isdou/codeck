# Codeck v0.3.0 launch copy

这份文案基于 Agy 的首发稿整理，并做了事实校准：Codeck 不提供模型、不绕过地区限制；它在本地组装上下文，再通过用户点名的外部 CLI 发送给对应模型服务。

## 一句话定位

Codeck 是 Codex 的本地上下文交接插件：在 Codex 里直接点名 Gemini、Claude、Kimi、Grok 或 Agy，不用重新复制项目背景和当前 diff，就能获得另一个模型的意见，并把交接结果留在项目内追溯。

## 首发标题

- 告别重复解释背景：在 Codex 里直接点名 Gemini、Claude 或 Agy
- 从“复制粘贴”到“一句话交接”：Codeck 让 Codex 调用本地 AI CLI
- 做了一个 Codex 插件：把当前项目上下文交给另一个模型看一下
- Codeck v0.3.0：Codex-first 的本地多模型上下文交接
- Codex 里想听第二个模型的意见，不必再切终端重喂上下文

## 中文开发者社区首发帖

在不同 AI 编程 CLI 之间切来切去时，最麻烦的往往不是运行命令，而是每次都要把项目架构、编码规范和写了一半的 diff 重新解释一遍。

我做了一个开源工具 **Codeck**：它是一个面向 Codex 的本地上下文交接插件。只有当你明确点名外部执行器时，它才会把当前 Git 状态、未提交 diff、项目说明和规则打包，交给对应的本地 AI CLI。

它目前主要解决三件事：

1. 自动打包项目上下文，并通过预算控制避免提示过长；
2. 在 Codex 对话里直接调用 Gemini、Claude、Kimi、Grok 或 Agy；
3. 把请求、上下文快照和结果保存到项目本地归档，默认掩码明显密钥；长任务返回 `runId` 后，还可以用 `wait_run` 取回完整结果。

需要说明的是：Codeck 不提供模型额度，也不替你创建账号。你需要在本机安装并登录自己的 CLI，例如 Gemini CLI、Claude Code、Kimi 或 Agy。明确发送的项目上下文也会经由该 CLI 发送给对应模型服务，请根据项目敏感程度自行确认。

安装插件后，可以在 Codex 里直接试：

> 用 Gemini 帮我 review 一下刚才的改动，重点看潜在的性能问题。

开源地址：https://github.com/isdou/codeck

欢迎完成第一次成功交接后，把安装问题或 CLI 兼容性问题发到 Issue。

## 中文短帖（X / 即刻）

习惯在 Codex 里写代码，但偶尔想让 Claude 看架构、Gemini 读大项目、Agy 做一次独立 Review？

Codeck 把“复制上下文、切终端、重新解释一遍”变成一句话：在 Codex 里明确点名外部 CLI，它会自动打包当前 Git 状态、diff 和项目规则，交给你自己的本地模型工具。

支持本地归档、默认密钥掩码，以及长任务 `runId` / `wait_run` 续接。

GitHub：https://github.com/isdou/codeck

## English launch post

### Title

Show HN: Codeck — a Codex plugin for handing project context to local AI CLIs

### Body

When you work across coding-agent CLIs, the painful part is often re-explaining the same repository: architecture notes, coding rules, and the current diff.

Codeck is a Codex-first local context handoff plugin. When you explicitly name an executor such as Gemini, Claude, Kimi, Grok, or Agy, Codeck packages the relevant Git state and project context and hands it to that executor's local CLI.

The design is intentionally explicit: Codeck does not silently switch models, does not bundle model access, and keeps Codex as the host and moderator. It also provides project-local SQLite archives with obvious-secret masking and resumable long runs through `runId` and `wait_run`.

You bring your own CLI and account. Selected project context is sent through that CLI to its model provider, so review the data boundary before using it on sensitive repositories.

Try a first handoff in Codex:

> Ask Gemini to review the current diff for performance risks.

Repository: https://github.com/isdou/codeck

## GitHub Release notes

### Codeck v0.3.0

Codeck v0.3.0 packages the Codex-first context handoff workflow as a sidebar plugin and MCP server.

Highlights:

- route explicit Codex requests to local Gemini, Claude, Kimi, Grok, or Antigravity/Agy CLIs;
- package Git status, current diff, project notes, constraints, and relevant files into a bounded handoff;
- preserve project-local, redacted request/context/output archives;
- keep long-running executor calls alive after a host timeout and recover them with `wait_run`;
- support `ask`, `delegate`, `compare`, `runs`, `curate`, `replay`, and export workflows;
- install as a Codex plugin from the repository's Git marketplace.

The first success criterion is simple: install Codeck, name one configured executor in Codex, and complete one handoff.

## Three copy-paste prompts

```text
用 Gemini review 当前 diff，重点检查潜在的性能回归，并给出最小修复建议。
```

```text
让 Claude 独立评估这个重构方案的架构风险，只读分析，不修改文件。
```

```text
让 Agy 读取当前项目上下文，分析这个问题；如果超过宿主等待时间，返回 runId，之后我会用 wait_run 取回完整结果。
```

## Short FAQ

**Codeck 提供模型吗？**

不提供。它调用你本机已有并已登录的 CLI 或 API executor。

**会不会自动替我换模型？**

不会。默认只有在请求中明确点名外部执行器时才路由；`delegate` 也需要显式授权。

**项目代码会不会离开电脑？**

Codeck 的组装、归档和掩码在本地完成，但明确发送的上下文会通过选定的 CLI 到达对应模型服务。敏感项目应先检查内容和提供方政策。

**Agy 超过一分钟怎么办？**

Codeck 会把长任务转为后台运行并返回 `runId`，随后使用 `wait_run` 取回终态结果。

**我应该先试什么？**

先在一个不含敏感信息的小项目里完成一次只读 `ask`，确认 `codeck doctor`、外部 CLI 登录状态和上下文范围都符合预期。
