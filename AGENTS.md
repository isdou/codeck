# Codeck Usage

Use Codeck only when the user explicitly mentions `codeck`, `Gemini`, `Claude`, `Antigravity`, `agy`, or another configured external executor.

Do not use Codeck just because a task looks like analysis, review, comparison, long-context reading, or UI feedback. Codex should not choose another model on the user's behalf.

Default flow:

- Use `codeck pick "<task>"` to preview the executor when unsure.
- Use `codeck ask auto "<task>"` for read-only questions.
- Use `codeck delegate auto "<task>" -y` only when the user explicitly wants implementation by another executor.
- Use `codeck compare claude_architect,gemini_frontend "<task>"` when the user asks for comparison or tradeoffs.

Do not route trivial local shell checks, direct file edits, or tasks Codex can complete faster itself.
