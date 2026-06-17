# Codeck

Codeck 是一个本地 AI CLI 路由器与上下文助手。它可以接入 Codex MCP，把当前项目上下文打包后交给 Gemini CLI、Claude Code、Codex CLI 等本地 executor 处理。

## 简介

不同 AI 工具适合不同任务：Codex 适合执行代码改动，Claude 常用于架构分析和代码评审，Gemini 适合长上下文、文档和视觉相关任务。

Codeck 解决的是切换工具时反复复制代码、解释项目背景、同步当前 diff 和限制条件的问题。你可以继续在 Codex 里工作，只把特定任务路由给更合适的 executor。

## 特性

- 自动打包项目上下文和配置说明，并记录运行日志。
- 通过 MCP 接入 Codex，减少手动复制粘贴。
- 支持 `ask`、`delegate`、`compare` 等路由模式。
- 支持 Gemini、Claude、Codex 以及本地调试用 `mock` executor。
- 提供 `gemini_web` 模式，复用网页版 Gemini 的登录态和额度。

## 安装

确保本地已安装 Node.js。拉取仓库后，在项目根目录执行：

```bash
npm install
npm run build
npm link
```

检查安装状态：

```bash
codeck doctor
```

如果本机没有 Gemini CLI，可以让 Codeck 尝试安装：

```bash
codeck install gemini
```

## 快速开始

初始化当前项目的 Codeck 配置：

```bash
codeck init
```

查看可用 executor：

```bash
codeck list
```

预览一个任务会分给哪个 executor：

```bash
codeck pick "review 当前架构风险"
```

按配置自动选择 executor 并运行：

```bash
codeck auto "这个页面 UI 样式不对"
```

向 Gemini 发起一次只读任务：

```bash
codeck ask gemini "简单回答：Codeck smoke test"
```

对比多个 executor 的建议：

```bash
codeck compare claude_architect,gemini_frontend "评审这个方案的主要风险"
```

## Codex MCP 接入

推荐用绝对路径接入 Codex，避免环境变量差异导致命令不可用：

```bash
codex mcp add codeck -- node /Users/suxiaohan/Desktop/codeck/dist/index.js mcp start
```

检查接入状态：

```bash
codex mcp get codeck
```

配置好 MCP 和项目指令后，日常可以直接描述任务：

```text
帮我分析当前实现有没有明显问题。
```

Codex 可以按 `AGENTS.md` 的规则自动调用 Codeck。需要手动指定时，也可以直接传 `auto`：

```text
调用 Codeck 的 route_task：
mode=ask
executor=auto
task=帮我分析当前实现有没有明显问题
```

## 常用命令

```bash
codeck init
codeck doctor
codeck list
codeck context
codeck pick "review 当前架构风险"
codeck auto "这个页面 UI 样式不对"
codeck ask gemini "简单回答：Codeck smoke test"
codeck ask auto "帮我分析这个需求"
codeck ask claude_architect "review 当前 diff 有什么架构风险"
codeck delegate auto "帮我实现测试" -y
codeck compare claude_architect,gemini_frontend "这个方案怎么做更稳"
codeck bringback
```

这些 CLI 命令主要用于安装、调试和 fallback。日常使用时，更推荐在 Codex 里通过 MCP 调用 Codeck。

## Executor

Codeck 通过 executor 表示不同 AI 工具或执行配置：

- `gemini`：调用本机 Gemini CLI。
- `gemini_web`：打开 Gemini Web，并把完整 prompt 复制到剪贴板。
- `claude_architect`：适合架构分析和代码评审。
- `gemini_frontend`：适合 UI、截图和长上下文分析。
- `codex_implementer`：适合基于 handoff 继续实现代码。
- `mock`：本地测试用，不消耗真实 AI 额度。

示例：

```bash
codeck ask gemini "给 Codeck 写一段小白能看懂的介绍"
codeck ask gemini_web "帮我分析这个页面"
codeck compare claude_architect,gemini_frontend "评审这个 PR"
```

## 配置

执行 `codeck init` 后，项目里会生成 `.codeck` 目录：

```text
.codeck/config.toml
.codeck/project.md
.codeck/constraints.md
.codeck/context.md
.codeck/runs/
```

常用文件：

- `.codeck/config.toml`：executor、权限和 handoff 配置。
- `.codeck/project.md`：项目背景、技术栈和架构说明。
- `.codeck/constraints.md`：项目规则、偏好和限制条件。
- `.codeck/context.md`：当前项目上下文快照。
- `.codeck/runs/`：历史运行记录。

## 自动路由

Codeck 可以根据任务文本自动选择 executor。规则写在 `.codeck/config.toml`：

```toml
[routing]
default_executor = "gemini"

[[routing.rules]]
name = "frontend"
executor = "gemini_frontend"
keywords = ["frontend", "ui", "css", "react", "页面", "界面", "样式", "截图"]

[[routing.rules]]
name = "architecture"
executor = "claude_architect"
keywords = ["architecture", "review", "risk", "架构", "评审", "风险", "重构"]

[[routing.rules]]
name = "implementation"
executor = "codex_implementer"
keywords = ["implement", "fix", "test", "实现", "修复", "测试"]
```

匹配规则会按顺序执行。命中的 executor 如果不支持当前 mode，会跳过并继续找下一条规则。

## Gemini Web

如果你想使用网页版 Gemini 的登录态和订阅额度，可以运行：

```bash
codeck ask gemini_web "帮我分析这个页面"
```

Codeck 会打开 Gemini Web，并把完整 prompt 复制到剪贴板。你只需要在网页里粘贴并发送。

## 注意事项

- MCP 里默认不会自动执行可写文件或跑 shell 的 executor。
- 如果某个 executor 配了 `write_files = true` 或 `run_shell = true`，需要在本地 CLI 里手动确认。
- Raw handoff 是默认模式，不会二次调用 AI。
- Smart handoff 需要显式开启，并配置 `handoff_executor`。
- 如果全局命令不可用，可以直接运行：

```bash
node /Users/suxiaohan/Desktop/codeck/dist/index.js doctor
```

## 许可证

MIT
