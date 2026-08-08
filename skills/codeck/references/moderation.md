# Moderation protocol

## First round

Give every expert the same task facts and acceptance criteria. Add one narrow role instruction without leaking other experts' conclusions.

```markdown
You are the <role> in an independent first-round review.

Answer the attached task brief. Return:
1. recommendation;
2. evidence from the supplied files;
3. assumptions;
4. major risks;
5. what evidence would change your conclusion.

Do not invent missing repository facts. Do not modify files.
```

Useful roles include architecture reviewer, implementation skeptic, security reviewer, product constraint reviewer, and regional/runtime compatibility reviewer. Choose roles that fit the task; do not add roles merely to increase the agent count.

## Normalize each response

Extract the following fields before comparing answers:

```text
executor
provider
recommendation
claims[]
evidence[]
assumptions[]
risks[]
unknowns[]
```

Separate factual disagreements from preference differences. Verify repository facts locally when possible instead of asking models to vote on them.

## Follow-up round

Ask a follow-up only for a disagreement that could change the decision:

```markdown
Review the attached disagreement and relevant first-round outputs.

For each disputed claim:
1. state whether you keep or revise your position;
2. cite the evidence that decides it;
3. identify any remaining uncertainty;
4. propose one verification step.

Do not repeat points that are already agreed.
```

The moderator writes follow-up prompts. Worker models do not choose their own assignments or decide when the council ends.

## Convergence

Stop when any condition is met:

- the acceptance criteria have a supported answer;
- remaining differences are preferences that the user can decide;
- a factual uncertainty requires a test or user input rather than more opinions;
- two consecutive rounds add no material evidence;
- the configured maximum number of rounds is reached.

Consensus is not required. Prefer a documented disagreement over a forced compromise.

## Decision rule

Weight evidence and task fit, not vote count. The moderator may choose a minority recommendation when it is better supported. State why.
