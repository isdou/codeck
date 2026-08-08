# Artifact formats

## Task brief

Use `task.md` for a substantial consultation:

```markdown
# Objective

# Current state

# Constraints

# Questions

# Acceptance criteria

# Included files

# Required response format
```

Keep the task prompt short and attach `task.md` with `-f`. Add other Markdown or source files only when they are needed to answer the questions.

## Full report

Use this structure for `report.md`:

```markdown
# Decision

# Participants

# Evidence

# Agreements

# Disagreements

# Moderator assessment

# Risks and unknowns

# Verification steps

# Run trace
```

Under participants, record the executor, underlying provider, role, success/failure, and Codeck run ID when available.

## Short summary

Keep `summary.md` brief:

```markdown
# Summary

Decision:
Why:
Main disagreement:
Next action:
```

## Structured decisions

Use valid JSON for `decisions.json`:

```json
{
  "mode": "multi-model",
  "decision": "",
  "confidence": "low|medium|high",
  "participants": [
    {
      "executor": "",
      "provider": "",
      "role": "",
      "run_id": "",
      "status": "success|failed|skipped"
    }
  ],
  "agreements": [],
  "disagreements": [],
  "fallbacks": [],
  "open_questions": [],
  "verification": []
}
```

Set `mode` to `multi-model` only when at least two successful participants use distinct known providers. Otherwise use `single-model` or `single-model-multi-role`.
