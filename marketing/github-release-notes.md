# Codeck v0.3.0

Codeck v0.3.0 packages the Codex-first context handoff workflow as a sidebar plugin and MCP server.

## Highlights

- Route explicit Codex requests to local Gemini, Claude, Kimi, Grok, or Antigravity/Agy CLIs.
- Package Git status, current diff, project notes, constraints, and relevant files into a bounded handoff.
- Keep project-local SQLite archives with obvious-secret masking by default.
- Recover long-running executor calls through `runId` and `wait_run` after a host timeout.
- Support `ask`, `delegate`, `compare`, archive search, curation, replay, and export workflows.
- Install from the repository's Git marketplace and use Codeck in the Codex plugin sidebar.

## Try it

```bash
codex plugin marketplace add isdou/codeck --ref main
codex plugin add codeck@codeck
```

Then configure one local executor and try this in Codex:

> Ask Gemini to review the current diff for performance risks.

Codeck does not bundle model access. Bring your own local CLI and account; selected project context is sent through that CLI to its model provider. Please review the data boundary before using it on sensitive repositories.
