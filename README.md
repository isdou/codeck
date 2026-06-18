# Codeck

**Codex-first context handoff for Gemini, Claude Code, and Antigravity CLI.**

在 Codex 里明确说“用 Gemini / Claude / Antigravity 看一下”时，Codeck 才会把当前仓库的 Git 状态、diff、AGENTS 规则和项目说明打包交给对应的本地 AI CLI。  
不用重新解释项目，也不替用户擅自选择模型。

---

[简体中文](./README.md) | [English](./README_EN.md)

---

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D%2018.0.0-blue.svg)](https://nodejs.org/)
[![MCP Ready](https://img.shields.io/badge/MCP-Compatible-green.svg)](https://modelcontextprotocol.org)

![Codeck terminal demo](./assets/demo.gif)

## 🎯 为什么需要 Codeck？

作为一个 AI 辅助编程的开发者，你可能：
1. **超级喜欢 Codex** 的日常流畅体验；
2. 但偶尔觉得 **Claude Code** 读复杂代码、梳理架构和跑 Review 时更胜一筹；
3. 又或者在面对大项目、写前端 UI、生成文档文案时，觉得拥有超长上下文的 **Gemini CLI** 或者 **Antigravity CLI** 才是神器。

但每次在不同 CLI 工具之间切换，都面临一个巨大痛点：**不得不把项目背景、框架技术栈、甚至当前写了一半的 Diff 代码重新复制一遍，再唠叨地向新 AI 解释一次。**

**Codeck 就是为了解决这个问题而生的。**  
它可以被看作是 **Codex 的本地上下文交接器**：只有当你明确点名外部模型时，它才把当前项目上下文打包给你订阅的本地 AI CLI。

---

## ✨ 核心特性

- 📦 **零配置上下文打包**：自动提取 Git 状态、Current Diff、项目背景、全局约束规则、相关源文件，融合成标准上下文。
- 🧭 **显式模型触发**：只有任务里明确提到 Gemini、Claude、Antigravity 等执行器时，才交给对应工具。
- 🔎 **可预览路由 (`pick`)**：不确定会交给谁时，先预览，不直接执行。
- 📊 **多模型同台竞技 (`compare`)**：输入一条任务，让 Claude 和 Gemini 针对同一上下文分别给出方案，方便对比。
- 🌐 **网页版额度复用 (`gemini_web`)**：如果不想消耗 API 额度，可以使用网页版桥接模式，一键打开网页并自动把上下文和 Prompt 拷入剪贴板。
- 🔌 **Codex MCP 无缝集成**：一次性把 Codeck 注册为 Codex 的 MCP 服务，以后你在 Codex 聊天时输入 `“用 Gemini 帮我分析当前实现”`，Codex 就会在后台自动调用 Codeck，不需要手动切出命令行！

---

## 🚀 3步极速上手

### 第一步：安装 Codeck
确保本地已安装 Node.js（推荐 v18+）。克隆仓库后，在 Codeck 项目根目录执行：

```bash
npm install
npm run build
npm link
```

运行健康检查，确认是否安装成功，以及本地有哪些可用的 AI 命令行工具：
```bash
codeck doctor
```

> 💡 **小贴士**：如果本地没有 Gemini CLI 或 Antigravity CLI，Codeck 可以帮你一键安装：
> ```bash
> codeck install gemini        # 安装 @google/gemini-cli
> codeck install antigravity   # 安装 Google agy CLI
> ```

### 第二步：在你的代码项目中初始化
切换到你需要开发的项目目录下（例如你的 Web 项目或 Python 项目），执行：
```bash
codeck init
```
这会在当前项目下创建 `.codeck/` 目录，里面包含：
- `config.toml`：路由规则、Executor（执行器）权限、上下文预算设置。
- `project.md`：**在此填写你的项目技术栈与架构设计**，方便 AI 快速融入。
- `constraints.md`：**在此填写开发规范与避坑指南**，AI 绝不敢违背。

### 第三步：路由你的第一个任务
先预览任务会交给哪个 Executor：
```bash
codeck pick "用 Gemini 分析当前 diff 有没有明显问题"
```
或者显式指定你要使用的工具：
```bash
codeck ask gemini "分析当前仓库有什么潜在的安全风险"
```

---

## 🛠 常用命令指南

Codeck 的 CLI 命令设计得非常直观，适合日常开发、调试或在其他终端环境作为 Fallback 工具使用。

| 命令 | 示例 | 作用说明 |
| :--- | :--- | :--- |
| **`codeck init`** | `codeck init` | 在当前目录下初始化 `.codeck` 配置与上下文描述文件 |
| **`codeck doctor`** | `codeck doctor` | 检查本机环境中的各 AI CLI 状态与连接可行性 |
| **`codeck list`** | `codeck list` | 查看当前项目下可用的 Executor 列表和它们的权限 |
| **`codeck context`** | `codeck context` | 手动刷新并生成当前项目的上下文快照 `.codeck/context.md` |
| **`codeck pick`** | `codeck pick "架构重构建议"` | 预览任务，查看 Codeck 的路由算法会把该任务分配给谁 |
| **`codeck auto`** | `codeck auto "用 Gemini 看这个样式问题"` | **配置路由**：按显式模型名或本地规则选择 Executor 运行 |
| **`codeck ask`** | `codeck ask gemini "测试这部分逻辑"` | **只读提问**：发送任务给指定 Executor，默认控制在较小上下文，防止超时卡顿 |
| **`codeck delegate`**| `codeck delegate codex_implementer "编写测试用例" -y` | **执行授权**：允许 Executor 回写代码或执行 Shell（配合 `-y` 自动确认危险操作） |
| **`codeck compare`** | `codeck compare claude_architect,gemini_frontend "架构重构方案"` | **对比模式**：让多个 AI 工具针对同一上下文各做一次回答 |
| **`codeck last`** | `codeck last` | 打印上一次 Codeck 运行的 AI 完整回答 |
| **`codeck bringback`**| `codeck bringback` | 把上一步的外部 AI 回答格式化为 Hand-off 信息，供 Codex 读回 |

---

## 🧠 核心工作原理

### 1. 上下文是怎样组装的？
当你在项目下调用 Codeck 时，它会根据以下规则组装一份 Markdown 上下文，并自动控制大小以防撑爆 AI 窗口：

```mermaid
graph TD
    A[当前任务 Task] --> F[标准打包上下文 Markdown]
    B[.codeck/project.md 技术栈说明] --> F
    C[.codeck/constraints.md 项目规范] --> F
    D[Git 状态与当前未提交的 Diff] --> F
    E[被引用的项目源文件] --> F
```

### 2. 预算控制 (Budget)
有些 CLI 工具如果一次喂太多上下文会非常慢。因此，Codeck 在 `config.toml` 里内置了两个阶段的预算限制：
- **`ask_context_chars`** (默认 `16,000` 字符)：适用于只读式的小提问，保证速度。
- **`max_context_chars`** (默认 `60,000` 字符)：适用于 `delegate`（具体实现）或使用 `--full-context` 参数时的完整回答。

每次运行后，CLI 会打印本次上下文占用、prompt/completion token 和成本估算；同样的信息也会写入 `.codeck/runs/*.json` 与 `.codeck/runs/*.md`。API executor 会尽量使用 provider 返回的真实 token；普通 CLI executor 拿不到真实账单时会按字符数估算，并标记为 `Est.`。

---

## ⚙️ 路由规则与配置

初始化后，你可以在 `.codeck/config.toml` 中精细化定制你的路由策略。

### 1. 自定义路由关键字
你可以修改 `[routing]` 部分的规则，当任务中出现特定词汇时自动派发给相应的 AI：

```toml
[routing]
default_executor = "gemini"

[[routing.rules]]
name = "frontend"
executor = "gemini_frontend"
keywords = ["frontend", "ui", "css", "html", "样式", "界面", "页面"]

[[routing.rules]]
name = "architecture"
executor = "claude_architect"
keywords = ["architecture", "review", "risk", "架构", "评审", "重构"]
```

### 2. 认识内置的 Executor 角色
Codeck 预设了以下 Executor 配置文件：
- 🧑‍🎨 **`gemini_frontend`**：调用 Gemini，专注前端 UI 优化与大上下文分析。
- 🏗 **`claude_architect`**：调用 Claude，最适合做深度的架构分析和重构 Review。
- 💻 **`codex_implementer`**：允许写文件和跑 Shell，通常用于将分析好的方案带回 Codex 进行落地编码。
- 🌐 **`gemini_web`**（仅支持 macOS）：**白嫖额度神器**。它会直接打开 Gemini 网页版，并将完美打包好的 Context 和 Prompt 直接复制进你的系统剪贴板，你只需要在浏览器里 `Cmd+V` 并回车即可！

### 3. 配置 API Key 与直连 API 模式 (New!)
如果你想为 CLI 注入自定义 API Key，或者不想在本地安装重度 CLI 工具，直接利用 API 秘钥调用大模型，可以使用以下两种方式：

#### 方式 A：自动加载 `.env` / 配置环境变量
在你的项目根目录或 `.codeck/` 目录下创建一个 `.env` 文件（建议将 `.env` 添加至你的 `.gitignore` 中）：
```env
GEMINI_API_KEY=你的谷歌GeminiAPI秘钥
ANTHROPIC_API_KEY=你的AnthropicClaudeAPI秘钥
```
Codeck 运行任何指令时会自动读取该文件，并在调用本地 CLI 时自动注入环境变量。你也可以在 `.codeck/config.toml` 里为指定 agent 配置 `env` 字段：
```toml
[agents.claude]
command = "claude"
[agents.claude.env]
ANTHROPIC_API_KEY = "你的SK秘钥"
```

#### 方式 B：使用直连 API Executor（无需安装 CLI）
本工具内置了 `gemini_api` 与 `claude_api` 两个直连适配器，利用 Node 原生 `fetch` 发送请求。你只需要在配置或 `.env` 中提供 API 秘钥，即可直接向大模型发起 `ask`：
```bash
# 直接调接口向 Gemini 提问，无需安装 @google/gemini-cli
codeck ask gemini_api "Explain recursion in 1 sentence"

# 直接调接口向 Claude 提问，无需安装 claude-code
codeck ask claude_api "Explain recursion in 1 sentence"
```
你还可以在 `.codeck/config.toml` 中自定义模型：
```toml
[agents.gemini_api]
api_key = "AIzaSy..."
model = "gemini-2.5-pro" # 默认是 gemini-2.5-flash
```

---

## 🔌 接入 Codex MCP (推荐玩法)

把 Codeck 配置进 Codex 之后，你甚至不需要手动打开终端输入 `codeck` 命令。

### 1. 添加 MCP 服务
使用绝对路径（将下面的 `/Users/yourname/codeck` 换成你本机的实际安装路径）向 Codex 注册 MCP：
```bash
codex mcp add codeck -- node /Users/yourname/codeck/dist/index.js mcp start
```

### 2. 在 Codex 里自然对话
配置完成后，只要你在与 Codex 对话时**提到了外部模型的名字**，Codex 就会把任务 delegate 给 Codeck。

**例如，你可以对 Codex 说：**
> *“帮我 review 一下刚才的改动，用 Gemini 分析一下这里有没有潜在的性能瓶颈。”*

Codex 将在后台调用 Codeck 唤起本地 Gemini CLI，并在对话流中直接呈现 Gemini 给出的专业分析，整个过程上下文丝滑衔接！

---

## 🤝 参与贡献

如果你在使用中发现了 Bug，或者希望适配更多本地 AI CLI 工具（如 DeepSeek CLI 等），非常欢迎提交 Issue 或 Pull Request！

1. Fork 本仓库
2. 创建你的特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交你的改动 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 新建 Pull Request

---

## 📄 许可证

本项目基于 [MIT](LICENSE) 许可证开源。
