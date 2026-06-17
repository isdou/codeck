# DevDeck: Codex-first Local AI CLI Router

DevDeck is a local MCP toolset for Codex. It lets Codex route a task to the right local AI CLI executor, with context packing, run logging, and handoff back to the host workflow.

```text
Codex MCP call -> DevDeck Router -> Context Builder -> Budget Guard -> Executor Adapter -> Run Log -> Handoff
```

DevDeck is not a standalone app and not a CLI-first product. The main experience happens inside Codex through MCP tools. The CLI is for install, config, diagnosis, debugging, and fallback.

## Core Model

- **Host**: where the user is working, usually Codex.
- **Executor**: the AI CLI that actually handles the task, such as Claude Code, Gemini CLI, Codex CLI, Aider, or OpenCode.
- **Mode**:
  - `ask`: ask an executor for analysis or suggestions.
  - `subagent`: give an executor a subtask and bring the result back to Codex.
  - `delegate`: let an executor handle the whole task.
  - `compare`: run several executors sequentially and compare outputs.

## MCP Tools

Start the MCP server:

```bash
devdeck mcp start
```

Register it with Codex:

```bash
codex mcp add devdeck -- devdeck mcp start
```

Main tools:

- `route_task`: route one task to one executor profile.
- `compare_executors`: run the same task through multiple executor profiles.
- `build_context`: inspect the context payload and resource summary.
- `create_handoff`: create a raw or smart handoff from a run.
- `get_run`: retrieve a run by ID, or the latest run.
- `list_executors`: show configured executor profiles.
- `doctor`: probe local agent commands and adapters.

Compatibility wrappers are still exposed: `ask_agent`, `compare_agents`, and `get_last_output`.

## CLI Fallback

```bash
devdeck init
devdeck doctor
devdeck list
devdeck context
devdeck ask mock "review current diff"
devdeck route delegate mock "draft the implementation plan"
devdeck compare mock,mock "compare this approach"
devdeck bringback
```

Writable or shell-enabled executors require CLI confirmation. MCP calls do not auto-run writable or shell-enabled executors.

## Configuration

DevDeck uses `.devdeck/config.toml`. Existing `[agents]` configs continue to work; v1 also supports executor profiles.

```toml
[agents.claude]
command = "claude"
adapter = "claude"

[agents.gemini]
command = "gemini"
adapter = "gemini"

[executors.claude_architect]
agent = "claude"
role = "architect"
description = "Architecture design, code understanding, and risk review."
allowed_modes = ["ask", "subagent", "delegate", "compare"]
read_files = true
write_files = false
run_shell = false
context_include = ["README.md", "docs/**", "src/**", "current_diff"]

[executors.gemini_frontend]
agent = "gemini"
role = "frontend_builder"
description = "Frontend, screenshots, UI diff, and long-context design analysis."
allowed_modes = ["ask", "delegate", "compare"]
read_files = true
write_files = false
run_shell = false
context_include = ["screenshots/**", "design/**", "src/**", "current_diff"]

[budget]
max_context_chars = 60000
mcp_max_context_chars = 60000

[handoff]
default_mode = "raw"
smart_enabled = true
handoff_executor = "codex_implementer"

[compare]
default_execution = "sequential"
allow_parallel = false
```

## Safety

- DevDeck uses adapter-specific invocation instead of hardcoding one CLI prompt shape.
- Context excludes generated DevDeck files such as `.devdeck/context.md`, `.devdeck/last.md`, and `.devdeck/runs/**`.
- Raw handoff is the default and does not call another model.
- Smart handoff is explicit and uses the configured `handoff_executor`.
- Default executor profiles are read-only except `codex_implementer`, which is blocked from automatic MCP execution.
