# Codeck launch-copy brief for Agy

## Product

Codeck is a Codex-first local context handoff bridge and Codex plugin. When a user explicitly asks Codex to consult Gemini, Claude, Kimi, Grok, or Antigravity/Agy, Codeck packages the current repository context and routes the request to the named local CLI. The user does not need to leave the Codex workflow or copy project context into another terminal.

The current release also provides:

- `pick`, `ask`, `delegate`, and `compare` workflows;
- project-local SQLite archive of requests, context snapshots, outputs, and status;
- default masking of obvious secrets;
- long-running background handoff with `wait_run` so a host timeout does not lose a response;
- CLI usage as well as Codex plugin/MCP installation.

## Primary audience

Power users of Codex who already have at least one external coding CLI installed, especially developers who use a second model for architecture review, UI review, long-context exploration, or independent code review.

Do not position this as a general-purpose AI platform or as a replacement for the model providers. Codeck requires the user's own local CLI/account and keeps Codex as the host and moderator.

## Core promise

In Codex, say “ask Gemini/Claude/Agy to review this” and get a second opinion without rebuilding the project context. The handoff is explicit, traceable, and recoverable for long tasks.

## Proof points

- context handoff from Git status, diff, AGENTS rules, project notes, and relevant files;
- explicit executor naming rather than silent model switching;
- read-only consultation by default, with implementation delegation requiring explicit authorization;
- project-local archive with redaction by default;
- bilingual README and a short terminal demo GIF already exist.

## Constraints and honesty requirements

- Do not claim Codeck provides or bundles Gemini, Claude, Agy, Kimi, or Grok.
- Do not claim that all external CLIs or model accounts work in every region.
- Say clearly that selected project context is sent to the named external provider's local CLI.
- Mention Node.js 20+ and local CLI/account setup where relevant.
- Avoid hype such as “best model” or “fully autonomous.”

## Requested output

Write launch-ready copy in Simplified Chinese first, followed by concise English versions:

1. one-sentence positioning and five headline options;
2. GitHub Release announcement;
3. X/Twitter launch post and a longer thread outline;
4. Chinese developer-community post suitable for V2EX/Juejin/Xiaohongshu without sounding like spam;
5. English developer-community post suitable for Hacker News/Reddit;
6. a 30-second demo voiceover/script;
7. three copy-paste prompts users can try in Codex;
8. a short FAQ covering installation, external data/privacy, supported CLIs, and the one-minute timeout/`wait_run` behavior.

Use a concrete before/after story: “copy context, switch terminals, explain everything again” versus “name the executor in Codex and continue.” Keep the call to action focused on trying the plugin and opening an issue with the first successful handoff, not on vanity metrics.
