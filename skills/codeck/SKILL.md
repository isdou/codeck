---
name: codeck
license: MIT
description: Keep Codex as the host. Use Codeck when the user explicitly asks to call Agy/AGY, Antigravity, Gemini, Claude, Kimi, Grok, Codeck, or another configured external executor. These names mean external Codeck executors, never internal Codex subagents. Build a compact task-specific brief, call that specialist, and return the result to Codex. Never invoke or choose an external provider merely because a task is difficult.
metadata:
  slug: codeck
  version: "1.0.3"
  displayName: Codeck 外部模型技能
  summary: 留在 Codex，按需调用用户点名的外部模型完成其擅长的局部任务，再把结果带回 Codex。
  tags: [codex, specialist, agy, antigravity, gemini, claude, kimi, handoff]
  homepage: https://github.com/isdou/codeck
---

# Codeck

**Keep building in Codex. Call the right model only when you need it.**

Codex remains the host, keeps the full product conversation, and makes the final decision. External models are temporary specialists for one explicitly requested task.

## Critical dispatch rule

When the user says "use/ask/call Agy", `AGY`, Antigravity, Gemini, or another external model, invoke Codeck. Never create or spawn an internal Codex subagent named after that model.

Use these canonical executor names:

- `Agy`, `AGY`, or `Antigravity` -> `antigravity`
- `Gemini` -> `gemini` (maintained Agy/Antigravity runtime)
- `Gemini CLI` -> `gemini_cli` (legacy CLI, only when explicitly requested)
- `Gemini API` -> `gemini_api`
- `Gemini Image` -> `gemini_image`

Executor names are case-insensitive. If the requested canonical executor is unavailable, report that exact failure; do not replace it with an internal subagent or a different provider.

## When to use Codeck

Use Codeck only when the user explicitly names an external model or Codeck, for example:

- “让 Gemini 根据当前产品背景写 App Store 文案。”
- “用 Claude 复核这个架构，不要修改代码。”
- “让 Kimi 阅读这几份长文档并提炼差异。”

Do not call Codeck because a task is complex. Do not automatically select a provider. Do not turn one request into a council unless the user explicitly asks for comparison.

## Run the specialist task

1. Determine the absolute path of the project attached to the current Codex task. Never use the Codeck package directory or an assumed MCP server working directory.
2. Do not require the user to run `codeck init`. The first project-scoped Codeck call safely creates missing `.codeck/config.toml`, `.codeck/project.md`, and `.codeck/constraints.md` files without overwriting existing files.
3. Resolve the model the user named to its configured executor without substituting another provider.
4. Write one clear `task` describing the requested output.
5. Synthesize a compact `brief` from facts already present in the current Codex conversation. Include only relevant product purpose, target user, decisions, constraints, source material, and output format. Do not make the user repeat context that Codex already has, and do not copy the full conversation.
6. Set `includeRepository=false` for copywriting, naming, marketing, visual direction, and other non-code work. Set it to `true` only when Git state, diff, repository rules, or executor default source files are relevant.
7. Attach only files needed for this task. Codeck always includes `.codeck/project.md` and `.codeck/constraints.md` when present.
8. Call `route_task` directly with `mode="ask"`, the explicit executor, `projectPath`, `task`, `brief`, `includeRepository`, and any required files. Use `doctor` only for troubleshooting or when the user asks for a health report.
9. If Codeck returns `executor_setup_required`, follow the setup boundary below and retry only after the executor is ready.
10. If the run is pending or running, call `wait_run` with the same `projectPath` and `runId` in bounded intervals until terminal.
11. Return the specialist result in the current Codex conversation. Codex remains responsible for editing, adopting, or rejecting it.
12. If the result contains `updateNotice`, show it once after the specialist result. Never hide it inside the answer or interrupt the task for an update check.

## First-use setup boundary

- Installing the Codex plugin provides both this Skill and a bundled Codeck MCP runtime. It does not require a repository clone, `npm install`, `npm link`, or manual project initialization. Node.js 20 or newer must still be available to start the local MCP runtime.
- Installing this Skill alone provides routing instructions but cannot register the Codeck MCP server. If `route_task` is unavailable, tell the user to install the Codeck plugin; do not pretend that an external model was called.
- A missing provider CLI, browser login, OAuth flow, or API key is provider-specific. Never silently install software, open a login flow, or replace the requested provider.
- When `executor_setup_required` includes `installCommand`, show the reason and ask for explicit user approval before running that command. Installation changes the user's machine. Authentication and secrets always remain user actions; tell users to enter keys in `.env` or `.codeck/.env`, never in chat.
- If the CLI is already installed but absent from the MCP process PATH, prefer restarting Codex or fixing the configured command/PATH over reinstalling it.

Example task payload:

```json
{
  "mode": "ask",
  "executor": "gemini_api",
  "projectPath": "/absolute/path/to/project",
  "task": "Write an App Store subtitle, promotional text, and full description in Simplified Chinese.",
  "brief": "The product is ... Target users are ... Confirmed positioning is ... Tone should be ... Avoid ...",
  "includeRepository": false,
  "files": []
}
```

## Safety and scope

- Default to `ask`. Use `delegate` only when the user explicitly asks the external executor to modify files or run commands.
- Treat permission fields as declarations unless the underlying CLI enforces them. Report the actual executor/provider and any limitation.
- Tell the user when project content will leave Codex and be sent through another provider.
- Never include credentials, unrelated files, private data, or the entire conversation.
- Preserve the run ID for recovery and traceability, but do not make audit features the center of the user experience.

## Return format

Lead with the requested artifact or expert conclusion. Then briefly identify the executor that actually ran and any important limitation. Keep the handoff concise so Codex can continue the product work immediately.

When present, place `updateNotice` last as a separate maintenance note.
