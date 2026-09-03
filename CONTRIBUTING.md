# Contributing to Codeck

Thanks for helping make Codeck a reliable context handoff tool for AI coding workflows.

## Start locally

You only need Node.js 20 or later. External model accounts are optional; the built-in `mock` executor is enough to run the checks.

```bash
git clone https://github.com/isdou/codeck.git
cd codeck
npm ci
npm test
```

To try the CLI against a temporary project:

```bash
tmp_dir="$(mktemp -d)"
cd "$tmp_dir"
node /path/to/codeck/dist/index.js init
node /path/to/codeck/dist/index.js ask mock "Return a short health check"
```

## Make a focused change

1. Create a branch for one bug or feature.
2. Add or update a test for behavior that can be checked locally.
3. Update the README when the user-facing command or workflow changes.
4. Run `npm test`, `npm run test:gemini-image`, and `git diff --check` before opening a pull request.

Keep pull requests small enough to review. Do not commit `.codeck/` archives, API keys, provider credentials, or private project content.

## Report a bug

Open a [bug report](https://github.com/isdou/codeck/issues/new?template=bug_report.md) with:

- the Codeck version (`codeck --version`);
- the operating system and Node.js version;
- the smallest command sequence that reproduces the problem;
- `codeck doctor` output and relevant session output after removing secrets and private source code.

If the issue involves a provider CLI, include its version and whether the same command works without Codeck. Screenshots are useful, but a redacted text error and reproduction steps make the issue much easier to fix.

## Pull requests

Please explain the user-visible problem, the root cause, and how you verified the change. Maintainers will review behavior, data boundaries, test coverage, and documentation together.
