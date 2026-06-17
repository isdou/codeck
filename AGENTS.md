# Codeck Usage

When the user asks for analysis, review, comparison, long-context reading, UI feedback, or another model's opinion, use Codeck automatically instead of asking the user to say "use Codeck".

Default flow:

- Use `codeck pick "<task>"` to preview the executor when unsure.
- Use `codeck ask auto "<task>"` for read-only questions.
- Use `codeck delegate auto "<task>" -y` only when the user explicitly wants implementation by another executor.
- Use `codeck compare claude_architect,gemini_frontend "<task>"` when the user asks for comparison or tradeoffs.

Do not route trivial local shell checks, direct file edits, or tasks Codex can complete faster itself.
