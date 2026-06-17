# DevDeck: Codex-first Local AI CLI Router

> 🚀 **DevDeck** 是一款面向开发者与 Codex / Claude Code 等 IDE AI 助手的 **本地 AI CLI 路由服务与上下文传递桥梁**。它能够将上游 AI 的复杂子任务路由分发给合适的本地 AI 命令行工具（如 Claude Code, Gemini CLI, Aider, Codex CLI 等），并提供智能上下文组装、执行日志记录以及工作流结果回传（Handoff）。

---

## 目录
1. [核心特性](#核心特性)
2. [工作流程与架构](#工作流程与架构)
3. [快速开始](#快速开始)
4. [配置文件说明 (.devdeck/config.toml)](#配置文件说明-devdeckconfigtoml)
5. [工作区目录结构 (.devdeck/)](#工作区目录结构-devdeck)
6. [命令行 CLI 使用指南](#命令行-cli-使用指南)
7. [MCP 服务与工具参考](#mcp-服务与工具参考)
8. [安全防护与隔离机制](#安全防护与隔离机制)

---

## 核心特性

- 🧩 **多 Agent 路由分发 (Routing)**：支持将任务智能路由到不同的本地 AI CLI（如 `claude`、`gemini` 等），使最合适的工具做最合适的事。
- 📦 **智能上下文组装 (Context Packing)**：自动扫描项目结构，整合指定文件、Git 差异、README 以及自定义的项目概述与约束规范，自动计算并打包为最契合目标工具的 prompt。
- 🛡️ **运行预算守卫 (Budget Guard)**：提供硬性的字符数/Token 限制（区分 CLI 模式和 MCP 模式），防止超出上下文窗口导致高额成本或调用失败。
- 📊 **多模型并行对比 (Executor Compare)**：支持让多个本地 AI 模型在完全一致的上下文环境下，顺序执行同一任务，直观输出对比结果。
- 🔄 **智能状态回传 (Handoff)**：支持 `raw` 原始回传或使用配置的 `handoff_executor` 进行 `smart` 智能格式化整理，保证宿主工作流无缝承接子任务的输出。
- 🔒 **严格的安全隔离**：MCP 模式下默认拦截所有涉及写文件 (`write_files`) 或运行 Shell 命令 (`run_shell`) 的危险执行器，必须在本地终端 (CLI) 进行手动二次确认。

---

## 工作流程与架构

```text
Host (Codex/Claude Code)
  │
  ├──► 发起 MCP 调用 (e.g. route_task)
  │      │
  │      ▼
  │   DevDeck Router (路由中心)
  │      │
  │      ├─► Context Builder (上下文构建器，合并 git diff / 配置文件)
  │      ├─► Budget Guard (上下文容量限额拦截)
  │      ▼
  │   Executor Adapter (适配器层，拼装 Prompt 并执行本地 CLI: claude/gemini)
  │      │
  │      ▼
  │   Run Log (生成本地 .json / .md 日志)
  │      │
  │      ▼
  └──◄ Handoff (将执行结果回传至宿主)
```

---

## 快速开始

### 1. 安装与构建

克隆仓库到本地，并在项目根目录下进行依赖安装与构建：

```bash
# 安装依赖
npm install

# 编译 TypeScript 源码为 JavaScript
npm run build

# 将 devdeck 命令链接到全局
npm link
```

安装完成后，你可以在终端直接运行 `devdeck` 命令。

### 2. 初始化工作区

在你要开发的软件项目根目录下运行：

```bash
devdeck init
```

此命令会在当前目录创建 `.devdeck/` 文件夹，包含初始配置文件 `config.toml`，以及项目描述 `project.md` 和开发约束 `constraints.md`。

### 3. 诊断与环境检查

执行 `doctor` 指令检查已配置的本地 AI 命令行工具是否就绪：

```bash
devdeck doctor
```

它会扫描你的 PATH 环境变量并检查 `claude`、`gemini`、`codex` 等 CLI 的可用性。

### 4. 开启 MCP 服务

DevDeck 提供了符合 Model Context Protocol 规范的 Stdio 服务。你可以将它配置到你的 Codex、Cursor 或 Claude Desktop 中。

#### 启动 MCP 服务命令：
```bash
devdeck mcp start
```

#### 在 Codex 中添加服务：
```bash
codex mcp add devdeck -- devdeck mcp start
```

---

## 配置文件说明 (`.devdeck/config.toml`)

项目初始化的配置文件包含了代理（`agents`）、执行器配置（`executors`）以及限制策略。你可以根据需求自由扩展：

```toml
# 1. 本地 AI 代理命令定义
[agents.claude]
command = "claude"      # 本地可执行文件名称或路径
adapter = "claude"      # 使用的适配器类型 (支持 claude, gemini, codex, mock, generic)

[agents.gemini]
command = "gemini"
adapter = "gemini"

# 2. 执行器角色 (Profiles)
[executors.claude_architect]
agent = "claude"
role = "architect"
description = "架构设计、代码理解与风险审查。"
allowed_modes = ["ask", "subagent", "delegate", "compare"] # 允许运行的模式
read_files = true       # 允许读取文件上下文
write_files = false     # 是否允许写文件（为 true 时在 MCP 下会触发安全拦截，需 CLI 确认）
run_shell = false       # 是否允许运行 Shell 命令
context_include = ["README.md", "docs/**", "src/**", "current_diff"] # 强制包含的上下文资源

[executors.gemini_frontend]
agent = "gemini"
role = "frontend_builder"
description = "前端构建、UI Diff 及长上下文设计分析。"
allowed_modes = ["ask", "delegate", "compare"]
read_files = true
write_files = false
run_shell = false
context_include = ["screenshots/**", "design/**", "src/**", "current_diff"]

# 3. 运行上下文大小限制 (以字符数为单位)
[budget]
max_context_chars = 60000        # 本地 CLI 执行最大上下文容量
mcp_max_context_chars = 60000    # MCP 调用执行最大上下文容量

# 4. 结果回传配置
[handoff]
default_mode = "raw"             # 默认回传模式: raw (原始文本) 或 smart (通过 AI 整理)
smart_enabled = true
handoff_executor = "codex_implementer" # smart 模式下用于格式化和处理输出的执行器

# 5. 对比运行配置
[compare]
default_execution = "sequential" # 并行度设置: sequential (顺序执行)
allow_parallel = false
```

---

## 工作区目录结构 (`.devdeck/`)

初始化后，项目根目录会生成 `.devdeck/` 文件夹。其内部结构如下：

- **`config.toml`**：DevDeck 核心配置文件，用于管理底层 agent CLI 以及各种角色的权限 and 预算。
- **`project.md`**：项目概览描述。可以在这里写明该项目的技术栈、模块职责、核心设计模式。这些内容会被作为基础上下文注入到每一次 AI 调用中。
- **`constraints.md`**：开发规范与约束。你可以在这里写入禁止使用的库、特定的代码规范或架构禁忌（例如：*不要使用 Tailwind，只使用原生 CSS*）。
- **`runs/`**：存放每次调用历史记录的目录。每次调用都会生成一个 `.json` (运行元数据与状态) 和一个 `.md` (完整的 Prompt 与 Output 日志)。
- **`last.md`**：存放最后一次执行成功后输出的原始内容，方便快速查看或命令行重定向。
- **`context.md`**：缓存的上下文文件。

---

## 命令行 CLI 使用指南

DevDeck 的 CLI 不仅可以作为宿主 AI 交互的兜底方案，也是进行调试、授权、手动运行的核心工具。

| 命令 | 描述 | 示例 |
| :--- | :--- | :--- |
| `devdeck init` | 初始化当前目录为 DevDeck 工作区 | `devdeck init` |
| `devdeck doctor` | 检查本地 Agents CLI 环境及适配器可用性 | `devdeck doctor` |
| `devdeck context` | 手动更新/刷新打包的上下文文件 | `devdeck context` |
| `devdeck list` | 列出所有已配置的执行器角色 (Executors) | `devdeck list` |
| `devdeck route <mode> <executor> <task>` | 路由任务到指定的执行器运行 | `devdeck route delegate mock "分析架构设计"` |
| `devdeck ask <executor> <task>` | 使用 `ask` 模式调用执行器（用于提问、咨询） | `devdeck ask claude_architect "解释下 index.ts"` |
| `devdeck delegate <executor> <task>` | 使用 `delegate` 模式委派一个任务（需要写权限） | `devdeck delegate codex_implementer "编写测试用例" -y` |
| `devdeck compare <executors> <task>` | 使用多个执行器顺序执行同一任务，并展示对比结果 | `devdeck compare claude_architect,gemini_frontend "评审此 PR"` |
| `devdeck last` | 打印并渲染最后一次调用的输出结果 (Markdown) | `devdeck last` |
| `devdeck bringback` | 将上一次执行结果按格式组装为 Handoff 载荷输出 | `devdeck bringback -m smart` |
| `devdeck mcp start` | 启动 stdio 通信的 DevDeck MCP 服务 | `devdeck mcp start` |

> 💡 **参数提示**：在 CLI 中运行带有写文件或运行脚本权限的 Executor 时，可以添加 `-y` 或 `--yes` 跳过终端的安全交互确认。

---

## MCP 服务与工具参考

当将 DevDeck 挂载到 Codex 等宿主 AI 助手后，宿主 AI 将能使用以下工具来协作：

### 1. `route_task`
将子任务分发给特定的本地 AI 工具执行。
- **入参**：
  - `mode` (`"ask" | "subagent" | "delegate"`): 运行模式。
  - `executor` (`string`): 配置文件中定义的执行器角色。
  - `task` (`string`): 具体任务提示词。
  - `files` (`string[]`, 可选): 本次任务需要额外包含的文件列表。
  - `handoffMode` (`"raw" | "smart"`, 可选): 返回结果的整理方式。

### 2. `compare_executors`
同时将某任务派发给多个 AI 执行器，方便宿主 AI 进行结果合并与优势互补。
- **入参**：
  - `executors` (`string[]`): 执行器列表。
  - `task` (`string`): 任务提示词。
  - `files` (`string[]`, 可选): 文件列表。

### 3. `build_context`
调试工具。检查如果在此环境下对当前任务打包，会生成怎样的上下文结构，以及它是否会超预算。
- **入参**：
  - `task` (`string`): 模拟的任务。
  - `files` (`string[]`): 模拟包含的文件。

### 4. `create_handoff`
根据历史 Run ID，组装格式化的 Handoff 数据。
- **入参**：
  - `runId` (`string`, 可选): 不传则默认使用最后一次运行。
  - `mode` (`"raw" | "smart"`): 回传模式。

### 5. `get_run`
获取某次历史调用的完整输入、输出与耗时元数据。
- **入参**：
  - `runId` (`string`, 可选): 不传则默认使用最后一次。

### 6. `list_executors`
列出当前项目支持的所有本地 AI 工具及角色，供宿主 AI 自由挑选分发。

### 7. `doctor`
检测本地 Agent 环境是否异常。

---

## 安全防护与隔离机制

由于 Codex 等 IDE 助手可能通过 MCP 服务自动调用本地终端，为了避免 AI 代理在无用户感知的情况下擅自更改本地 file 或运行恶意 Shell 指令，DevDeck 建立了以下安全屏障：

1. **写操作/脚本权限拦截**：
   如果 Executor 配置了 `write_files = true` 或 `run_shell = true`，且该次调用源自 **MCP 服务**，DevDeck 将抛出 `permission_requires_cli_confirmation` 错误并阻断执行。宿主 AI 会收到错误信息并提示用户在本地终端中运行对应的 `devdeck route` 命令手动确认执行。
2. **上下文隔离**：
   在自动打包项目上下文时，DevDeck 的核心控制文件（如 `.devdeck/context.md`、`.devdeck/last.md` 以及历史运行日志 `runs/`）均已默认加入排除名单（`exclude`），杜绝了“上下文无限自我嵌套”或本地历史执行敏感日志被发送给公有云模型的问题。
3. **适配器隔离**：
   DevDeck 对不同的 Agent 包装了适配器（如 `claude` 适配器使用 `-p {prompt}`，`gemini` 适配器使用 `--approval-mode plan` 等），避免使用通用的 `eval` 或是未转义的直接 Shell 拼接。

---

## 许可证
本项目基于 [MIT License](LICENSE) 许可协议开源。
