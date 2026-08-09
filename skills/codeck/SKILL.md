---
name: codeck
slug: codeck
version: 1.0.0
displayName: Codeck 多模型协作
summary: 在一个 Coding Agent 中，通过 Codeck 咨询、比较和协调多个外部模型，并由当前 Agent 主持收敛。
tags: [coding-agent, multi-model, orchestration, code-review, china-models]
license: MIT
homepage: https://github.com/isdou/codeck
description: Route explicit requests from a host coding agent to one or more locally configured AI executors through Codeck, attach Markdown or other project files, moderate cross-model consultation, expose disagreements, and synthesize traceable results. Use when the user explicitly names Codeck or asks to consult, compare, or delegate to Claude, Gemini, Kimi, DeepSeek, Qwen, GLM, MiniMax, Grok, Antigravity, or another configured executor. Do not invoke an external model merely because a task is complex.
---

# Codeck

Use Codeck as the execution bridge while the current coding agent remains the host and moderator. Treat a host product's model selector as unrelated: switching the active chat model is not the same as consulting external models through Codeck.

## Choose the workflow

- Use a single `ask` for a read-only second opinion from a named executor.
- Use a council for independent opinions from two or more genuinely different underlying model providers.
- Use `delegate` only when the user explicitly asks an external executor to implement changes.
- Use `pick` before `auto` when routing is uncertain.

When a routed tool result has `status: "running"` or `status: "pending"`, treat it as an
in-progress job rather than a model answer. Call `wait_run` in bounded intervals (no more than
45 seconds per call) until the run is terminal, then use its `output`. A short MCP call can be
cut off by the host while Agy or another executor continues in the background; use the returned
`runId` to recover the final answer.

Never describe one model playing several roles as multi-model consensus. Label it `single-model-multi-role`.

## Preflight

1. Run `command -v codeck`.
2. If unavailable, stop and explain that the Codeck CLI is required. Do not install it without user authorization.
3. Run `codeck doctor` and `codeck list` in the target project.
4. Use only healthy, configured executors whose declared mode and permissions fit the task.
5. If the project is not initialized, ask before running `codeck init` because it creates `.codeck/` files.

Read [references/providers.md](references/providers.md) when configuring executors, choosing providers for a regional network, or explaining why a requested model is unavailable.

## Prepare the handoff

Write a compact Markdown brief for non-trivial work. Include the objective, constraints, questions, acceptance criteria, and only the files needed by the external model. Prefer a file attachment over embedding a long brief in the command:

```bash
codeck ask <executor> "Read the attached task brief and return an evidence-backed review." -f task.md
```

Do not include secrets, credentials, unrelated source files, or private user data. Tell the user when task content will leave the host product and be sent to another provider.

Read [references/artifacts.md](references/artifacts.md) for the input brief and final artifact schemas.

## Run a multi-model council

1. Keep the current coding agent as moderator.
2. Select at least two healthy executors backed by distinct providers. Prefer capability fit and availability over brand order.
3. Give every first-round expert the same facts and core question, plus a distinct review role.
4. Collect first-round answers independently before exposing one expert's answer to another.
5. Extract claims, evidence, assumptions, risks, and disagreements.
6. Ask targeted follow-ups only about material disagreements. Attach the relevant prior outputs as Markdown files.
7. Stop when the acceptance criteria are met, remaining disagreements are explicitly documented, or the configured round limit is reached.
8. Produce `report.md`, `summary.md`, and `decisions.json` when writing artifacts is in scope; otherwise return the same structure in the response.

Use `codeck compare <executor-a>,<executor-b> "<task>" -f task.md` when all experts should receive the same prompt. Use separate `codeck ask` calls when roles or follow-up questions differ. Do not claim parallel execution unless the observed run actually ran concurrently.

Read [references/moderation.md](references/moderation.md) for role prompts, disagreement handling, and convergence rules.

## Route safely

- Default to `ask`, which is intended for read-only consultation.
- Do not add `-y` or call `delegate` unless the user authorized external implementation.
- Treat permission fields as declarations unless the underlying CLI also enforces a sandbox.
- Do not silently substitute a provider. Report the requested executor, actual executor/provider, and fallback reason.
- Do not hardcode current model IDs. Discover or read them from local configuration because provider model names change.
- If fewer than two distinct providers are available, continue only as a single-model consultation and state the limitation.
- Preserve raw external outputs or Codeck run IDs so the synthesis remains auditable.
- Codeck archives each routed request inside the project. Use `list_runs` or `search_runs` to
  find prior work, and `get_run(includeContent=true)` only when the redacted prompt/context is
  actually needed. Do not inject archive history automatically into a new handoff.
- When a run is genuinely reusable knowledge, call `curate_run` with focused tags and a note.
  Curation is explicit; do not mark every historical run as knowledge.
- Use `replay_run` only when the user wants a new model call. Historical-snapshot replay is the
  default; `currentContext=true` is an explicit alternative. Every replay creates a new linked
  run.

## Return the result

Lead with the moderator's conclusion. Then state:

- which executors and underlying providers actually ran;
- where they agreed and disagreed;
- what evidence supports the decision;
- unresolved risks and recommended verification;
- any fallback, failure, estimated usage, or regional limitation.

Keep the short summary decision-oriented. Keep detailed reasoning and source attribution in the full report.
