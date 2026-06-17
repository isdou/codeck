# Codeck

Codeck 是一个本地 AI 命令行路由与上下文助手。通过接入 Codex 的 MCP (Model Context Protocol)，你可以在不离开当前工作流的情况下，将特定任务路由给更合适的本地 AI 工具（如 Gemini CLI、Claude Code 等），Codeck 会自动打包并传递当前项目上下文。

## 简介

在使用 AI 辅助编程时，不同的模型往往各有所长：Claude 适合架构分析与代码评审，Gemini 擅长处理长文档与视觉任务，而 Codex 则更专注于代码执行。

Codeck 致力于解决在不同 AI 工具间切换时，需要重复拷贝代码、解释项目背景与约束条件的痛点。只需简单调用，Codeck 即可自动读取项目结构、规则及 Diff，并将其发送给最匹配的 AI 执行器。

## 特性

*   **上下文自动注入**：自动收集并附加项目状态、Git Diff、以及自定义的项目背景与约束条件。
*   **Codex MCP 无缝集成**：无需切换窗口，直接在 Codex 对话中完成任务路由。
*   **灵活的 Executor 机制**：支持任意本地命令行 AI 工具及 Web 端工具的接入。
*   **对比评审模式**：支持同时调用多个模型（如 `compare claude_architect,gemini_frontend`）以获取多维度的建议。

## 安装

确保本地环境已安装 Node.js。克隆本仓库后，在项目根目录执行：

```bash
npm install
npm run build
npm link
```

安装完成后，验证环境与依赖：

```bash
codeck doctor
```

如果需要安装 Gemini CLI，可使用自带命令：

```bash
codeck install gemini
```

## 快速开始

Codeck 提供了直观的命令行交互。以下是基础使用流程：

1.  初始化项目配置：
    ```bash
    codeck init
    ```
2.  向指定的 Executor 提问：
    ```bash
    codeck ask gemini "简单回答：Codeck smoke test"
    ```

## Codex MCP 接入

Codeck 推荐作为 MCP 插件与 Codex 配合使用。为避免环境变量异常，建议通过绝对路径添加：

```bash
codex mcp add codeck -- node /Users/suxiaohan/Desktop/codeck/dist/index.js mcp start
```

检查 MCP 接入状态：

```bash
codex mcp get codeck
```

**在 Codex 中的调用话术示例：**
*   *“用 Codeck 调用 gemini，ask 模式，让它给这个方案提建议。”*
*   *“调用 Codeck 的 route_task：mode=ask，executor=claude_architect，task=帮我分析当前实现有没有明显问题”*

## 常用命令

```bash
codeck init                                    # 初始化工作区上下文配置
codeck doctor                                  # 检查运行环境
codeck list                                    # 列出可用 Executor
codeck ask <executor> "<task>"                 # 单一路由：将任务交由指定 AI 处理
codeck compare <executor1,executor2> "<task>"  # 对比路由：让多个 AI 提供方案
codeck bringback                               # 恢复上下文记录
```

> **提示**：若全局 `codeck` 命令在特定环境下无法识别，可直接使用 node 执行：
> `node /Users/suxiaohan/Desktop/codeck/dist/index.js <command>`

## Executor

Executor 是 Codeck 路由的目标执行器。你可以根据任务类型选择最合适的工具：

*   `gemini`：调用本地 Gemini CLI，适合常规问答与代码分析。
*   `claude_architect`：专门配置的 Claude 实例，适合深度架构评审。
*   `gemini_frontend`：配置了前端上下文的 Gemini，适合 UI 分析与长文本处理。
*   `codex_implementer`：用于接收 Handoff 并继续实现代码。
*   `mock`：本地开发与调试专用，不产生真实的 API 消耗。
*   `gemini_web`：用于调用浏览器版 Gemini。Codeck 会自动在浏览器中打开对应页面，并将完整的 Prompt 复制到剪贴板中供用户粘贴，该模式具备更高的稳定性，并能复用网页版的登录态和高级模型额度。

## 配置

执行 `codeck init` 后，Codeck 会在当前项目生成 `.codeck` 目录。你可以在此补充项目专属的上下文，Codeck 会在路由任务时自动读取这些信息：

*   `.codeck/config.toml`：核心配置文件。
*   `.codeck/project.md`：记录项目背景、技术栈与架构设计。
*   `.codeck/constraints.md`：记录代码规范、设计偏好与禁止事项。
*   `.codeck/runs/`：历史运行记录与日志存放目录。

## 注意事项

*   **安全限制**：在 MCP 模式下，Codeck 默认不会自动执行涉及文件写入 (`write_files = true`) 或 Shell 脚本运行 (`run_shell = true`) 的 Executor。如需执行相关操作，需在本地 CLI 中进行手动确认。
*   **Handoff 策略**：系统默认采用 Raw handoff 模式，不执行额外的 AI 二次处理。若需开启 Smart handoff，必须在配置中显式启用，并指定对应的 `handoff_executor`。
