# DevDeck: Codex 的外部 AI 子代理交接层 (Codex-first Subagent Bridge)

> **DevDeck helps AI coding CLIs hand off context without making you explain the project again.**  
> 让 Claude Code、Gemini CLI 成为 Codex 工作流里的外部 Subagent，无痛交接上下文。

---

## 💡 1. 什么是 DevDeck？

**DevDeck** 是一个本地工具（MCP Server + CLI），专门用作 **Codex、Claude Code、Gemini CLI** 等 AI 命令行工具之间的**上下文交换与分派交接层**。

### 核心差异
它不是另一个“多模型聊天壳子”，也不是“重新做一个 AI IDE”，而是让您在 Codex 主开发工作流中，能够通过简短的指令，把特定子任务分派给最适合的外部 AI CLI（如让 Claude 做复杂架构 review，让 Gemini 做长上下文/截图分析），并在执行完毕后自动整理成 Codex 可直接消费执行的 **Handoff（交接任务书）** 返回。

---

## 🎯 2. 核心价值与痛点解决

* **解决上下文割裂**：避免在 Codex 解释过一遍背景后，切换到 Claude / Gemini 时还要重复复制粘贴项目说明、当前 Diff 和限制条件。
* **沉淀项目长期约束**：自动在项目根目录下沉淀 `.devdeck/constraints.md` 和 `.devdeck/project.md`。无论换哪个 AI Subagent，它都能被自动打包进上下文，避免 AI 破坏核心设计（如“不要把移动端 SwiftUI 改出网页感”）。
* **任务可执行回收 (Handoff & Bringback)**：外部 AI 的分析报告被 DevDeck 自动翻译并打包为 Codex 的下一步执行 Prompt，实现开发流程的无缝串联。
* **Local-first & 成本透明**：完全基于本地系统已登录的 CLI 运行，数据不上传第三方服务器，且能清晰知晓每次调用所消耗的上下文和额度账户。

---

## 🛠 3. 命令行工具使用 (CLI Companion)

DevDeck 已在本地完成了全局链接，您可以在项目目录下直接运行以下命令：

* **`devdeck init`**：初始化当前项目，创建 `.devdeck/` 文件夹并生成默认的 `config.toml`、项目大纲 `project.md` 及设计约束 `constraints.md` 模板。
* **`devdeck doctor`**：检测本地系统环境，自动扫描 `codex`、`claude`、`gemini` 等 CLI 二进制命令在系统 PATH 中的安装与登录状态。
* **`devdeck context`**：实时刷新并重新生成项目当前的上下文缓存文件 `.devdeck/context.md`（包含分支、git diff、README、项目约束等）。
* **`devdeck ask <agent> <prompt>`**：
  * 支持角色参数：`-r, --role <role>`（如 `reviewer`, `architect`, `ui_checker`）。
  * 自动装载上下文，调用本地对应的 AI CLI。支持流式控制台输出，并录制 Run 日志到 `runs/`，干净输出存入 `last.md`。
* **`devdeck bringback`**：从 `last.md` 中读取最近一次 Subagent 的产出，并自动“翻译”为 Codex 能够直接读取并继续修改代码的任务交接指令。
* **`devdeck last`**：在终端通过漂亮的 Markdown 渲染排版显示最近一次的运行结果。
* **`devdeck mcp start`**：启动标准 stdio 传输协议的 MCP Server。

---

## 🔌 4. 在 Codex App 中接入并使用

Codex App 原生支持基于 STDIO 协议的本地 MCP 服务。您可以非常简单地将 DevDeck 挂载为外部 Subagent 分派层。

### 接入步骤 (两种方式可选)

#### 选项 A：使用 Codex 命令行（推荐，最便捷）
在终端中执行以下指令，Codex 会自动完成服务注册：
```bash
codex mcp add devdeck -- devdeck mcp start
```

#### 选项 B：手动编辑 Codex 配置文件
1. 打开您的 Codex 全局配置文件 `~/.codex/config.toml`。
2. 在 `[mcp_servers]` 部分中追加以下段落：
   ```toml
   [mcp_servers.devdeck]
   command = "devdeck"
   args = ["mcp", "start"]
   enabled = true
   ```
3. 保存并刷新/重启 Codex App。

---

## 🚀 5. 极速上手工作流示例

绑定完成后，您就可以在 Codex App 中进行如下的“副驾驶分派”工作流：

### 场景 1：分派复杂 Review 给 Claude
当您在 Codex 中修改了一段复杂的 Provider 代码，您可以对 Codex 说：
> *“帮我用 DevDeck 把这段代码发给 Claude，让它扮演 reviewer 判断一下目前的改动是否存在隐式状态风险。”*

Codex 会自动通过 MCP 调用：
`ask_agent(agent="claude", role="reviewer", prompt="检查当前的改动是否存在隐式状态风险")`
DevDeck 将在后台默默打包您当前的 Git Diff、修改文件及设计约束，调起本地 `claude` 并收回结果。

### 场景 2：让 Codex 接着干活 (Handoff 回收)
Claude 给出建议后，您只需在 Codex 中打字：
> *“使用 devdeck create_handoff 把 Claude 刚才的意见带回来让我（Codex）执行。”*

Codex 会接收到由 DevDeck 翻译过后的结构化开发任务书（Next Steps），Codex 将自动针对这些细化后的任务继续编写代码。

---

## 🔒 6. 安全与权限边界

为了防范 MCP 带来的潜在安全攻击（如注入攻击或越权操作）：
* **防注入**：所有本地 CLI 进程均通过 `spawn(..., { shell: false })` 执行，彻底隔离 Prompt 中包含恶意拼接字符（如 `; rm -rf`）的命令执行风险。
* **默认只读**：外部子代理默认只拥有只读权限，不能直接执行 Shell 写入或修改您仓库的文件。全部的代码落地与修改职责仍由您主导的 Codex 核心流负责，确保安全可控。
