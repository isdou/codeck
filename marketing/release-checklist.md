# Codeck v0.3.0 release and launch checklist

## Release gate

- [x] Add a repository-backed `.agents/plugins/marketplace.json`.
- [x] Add Codex sidebar installation instructions to Chinese and English README files.
- [x] Generate launch copy with Agy through Codeck.
- [x] Remove the occupied npm package name from launch instructions.
- [ ] Run the full build and test suite.
- [ ] Verify plugin installation from a clean checkout.
- [ ] Review the final diff and exclude local probes/archives.
- [ ] Commit the release changes and tag `v0.3.0`.
- [ ] Push the branch/tag to GitHub.
- [ ] Create the GitHub Release with `marketing/launch-copy.md` release notes.

## First-week operating loop

1. Invite 5–10 Codex power users to install the plugin.
2. Ask each person to complete one read-only handoff and report the first friction point.
3. Fix onboarding blockers before adding integrations.
4. Publish one real, redacted handoff example per day during launch week.
5. Track installs, first successful handoffs, second handoffs within seven days, and issue resolution time.

## Privacy-respecting measurement

Do not collect prompts, project files, context, model responses, keys, or the local archive by default. Use GitHub release traffic, issue labels, voluntary feedback, and opt-in anonymous lifecycle events only if a central usage dashboard becomes necessary.
