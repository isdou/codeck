# Executors and providers

## Keep the layers separate

An executor is the callable agent runtime or CLI. A provider supplies the model. One executor may support several providers, and a host product's model selector does not automatically make those models callable as child agents.

Use the executor name reported by `codeck list` and the health result reported by `codeck doctor`. Do not infer availability from brand recognition.

| Layer | Examples | Responsibility |
| --- | --- | --- |
| Host | Codex, Claude Code, Gemini CLI, WorkBuddy | Moderate the task and present the result |
| Executor | Claude Code CLI, Gemini CLI, Kimi Code, Qwen Code, Antigravity, OpenCode | Read the handoff, call tools, maintain an agent session |
| Provider | Anthropic, Google, Moonshot, Alibaba/Qwen, DeepSeek, Zhipu/GLM, MiniMax | Perform model inference |

## Select by capability

Check these capabilities before routing:

- supported Codeck mode: `ask`, `subagent`, `compare`, or `delegate`;
- read, write, and shell permissions;
- non-interactive prompt input and stdout output;
- file/context support;
- structured output and tool calling when required;
- authentication, endpoint reachability, quota, and regional availability;
- underlying provider identity when claiming multi-model diversity.

Prefer a capability-first fallback. For mainland-China environments, healthy domestic providers may include Kimi, DeepSeek, Qwen, GLM, and MiniMax, but their presence must still be verified locally.

## Configure a CLI executor

Codeck's `generic` adapter can call a CLI that accepts a non-interactive prompt and returns its answer on stdout. Confirm the CLI's real arguments instead of copying guessed flags.

```toml
[agents.qwen]
command = "qwen"
adapter = "generic"
prompt_args = ["-p", "{prompt}"]
timeout_ms = 180000

[executors.qwen]
agent = "qwen"
role = "code_analyst"
description = "Qwen CLI read-only analysis"
allowed_modes = ["ask", "subagent", "compare"]
read_files = true
write_files = false
run_shell = false
context_include = ["README.md", "src/**", "current_diff"]
```

Use the same pattern for a DeepSeek-, GLM-, or MiniMax-backed executor only when a locally installed runtime exposes a verified non-interactive command. The current Codeck release does not imply native direct-API support merely because a provider offers an OpenAI-compatible API.

## Report fallback honestly

Record a fallback as data, not as hidden behavior:

```text
Requested executor: claude_architect
Actual executor: qwen
Underlying provider: Alibaba Cloud / Qwen
Reason: requested CLI missing or endpoint unreachable
Mode: read-only ask
```

If the underlying provider cannot be established, report it as `unknown`; do not count it toward distinct-provider consensus.
