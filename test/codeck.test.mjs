import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { extractGeminiImageParts, getAdapter } from '../dist/adapters.js';
import { DEFAULT_CONFIG, initCodeck, loadConfig } from '../dist/config.js';
import { deleteRun, getRun, listRuns, replayRun, resolveExecutor, resolveExplicitExecutor, routeTask, waitForRun } from '../dist/router.js';
import { getUpdateNotice, isNewerVersion, VERSION } from '../dist/version.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('runtime version matches package.json', () => {
  const packageMetadata = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  assert.equal(VERSION, packageMetadata.version);
});

test('first project use initializes Codeck without a separate init command', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codeck-first-use-'));
  try {
    assert.equal(fs.existsSync(path.join(cwd, '.codeck')), false);
    const config = loadConfig(cwd);
    assert(config.executors.antigravity);
    for (const file of ['config.toml', 'project.md', 'constraints.md']) {
      assert.equal(fs.existsSync(path.join(cwd, '.codeck', file)), true, `missing auto-created ${file}`);
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('update notice compares stable versions and fails independently of routed work', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codeck-update-'));
  try {
    assert.equal(isNewerVersion('0.4.10', '0.4.2'), true);
    assert.equal(isNewerVersion('0.4.2', '0.4.2'), false);
    assert.equal(isNewerVersion('0.4.1', '0.4.2'), false);
    assert.equal(isNewerVersion('invalid', '0.4.2'), false);
    const notice = await getUpdateNotice(async () => new Response(JSON.stringify({ version: '99.0.0' }), { status: 200 }));
    assert.match(notice || '', /99\.0\.0/);

    initCodeck(cwd);
    const run = await routeTask({ mode: 'ask', executor: 'mock', task: 'verify update notice', includeRepository: false }, { cwd, caller: 'cli' });
    assert.match(run.updateNotice || '', /99\.0\.0/);
  } finally {
    process.env.CODECK_DISABLE_UPDATE_CHECK = '1';
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('Kimi and Grok adapters and routes are built in', () => {
  assert.equal(getAdapter('kimi').name, 'kimi');
  assert.equal(getAdapter('grok').name, 'grok');
  assert.equal(resolveExecutor(DEFAULT_CONFIG, 'Use Kimi to inspect this repository', 'ask'), 'kimi');
  assert.equal(resolveExecutor(DEFAULT_CONFIG, 'Ask Grok to review this diff', 'ask'), 'grok');
  assert.equal(DEFAULT_CONFIG.executors.grok.write_files, false);
  assert.equal(DEFAULT_CONFIG.executors.grok.run_shell, false);
});

test('Antigravity is the maintained default Google CLI path', () => {
  assert.equal(DEFAULT_CONFIG.routing.default_executor, 'antigravity');
  assert.equal(DEFAULT_CONFIG.agents.antigravity.model, 'gemini-3.8-flash-high');
  assert.equal(DEFAULT_CONFIG.executors.gemini.agent, 'antigravity');
  assert.equal(DEFAULT_CONFIG.executors.gemini_cli.agent, 'gemini');
  assert.equal(DEFAULT_CONFIG.executors.gemini_frontend.agent, 'antigravity');
});

test('explicit executor names accept provider casing and Agy aliases', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codeck-alias-'));
  try {
    initCodeck(cwd);
    const config = loadConfig(cwd);
    assert.equal(resolveExplicitExecutor(config, 'AGY'), 'antigravity');
    assert.equal(resolveExplicitExecutor(config, 'Gemini'), 'gemini');
    assert.equal(resolveExplicitExecutor(config, 'Gemini CLI'), 'gemini_cli');
    assert.equal(resolveExplicitExecutor(config, 'Gemini API'), 'gemini_api');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('unavailable executors fail before invocation with consent-aware setup guidance', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codeck-setup-'));
  try {
    loadConfig(cwd);
    fs.appendFileSync(path.join(cwd, '.codeck', 'config.toml'), `
[agents.missing_agy]
command = "definitely-not-installed-codeck-agy"
adapter = "antigravity"

[executors.missing_agy]
agent = "missing_agy"
role = "setup_probe"
description = "Missing CLI setup probe"
allowed_modes = ["ask"]
read_files = true
write_files = false
run_shell = false
context_include = []
`);

    await assert.rejects(
      routeTask({ mode: 'ask', executor: 'missing_agy', task: 'probe missing setup' }, { cwd, caller: 'mcp' }),
      (error) => {
        assert.equal(error?.code, 'executor_setup_required');
        assert.equal(error?.details?.requiresConsent, true);
        assert.equal(error?.details?.installCommand, 'codeck install antigravity');
        assert.match(error?.message || '', /not found in PATH/);
        return true;
      },
    );
    assert.equal(fs.readdirSync(path.join(cwd, '.codeck', 'runs')).some((file) => file.endsWith('.json')), false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('Antigravity adapter pins the configured model instead of using the regional planner', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codeck-agy-'));
  const probePath = path.join(cwd, 'argv-probe.mjs');
  fs.writeFileSync(probePath, 'console.log(JSON.stringify(process.argv.slice(2)));\n', 'utf8');
  const profile = {
    agent: 'antigravity',
    role: 'antigravity',
    description: 'Antigravity probe',
    allowed_modes: ['ask'],
    read_files: true,
    write_files: false,
    run_shell: false,
    context_include: [],
  };
  const context = {
    markdown: 'CODECK_ANTIGRAVITY_MARKER',
    resources: [],
    summary: { chars: 27, resourceCount: 0, truncated: false, omitted: [] },
  };
  try {
    const result = await getAdapter('antigravity').invoke({
      agentName: 'antigravity',
      agent: {
        command: `node ${probePath}`,
        adapter: 'antigravity',
        model: 'gemini-3.6-flash-high',
        timeout_ms: 5000,
      },
      executorName: 'antigravity',
      profile,
      task: 'verify pinned agent',
      context,
      cwd,
      runId: 'agy-probe',
    });

    assert.equal(result.exitCode, 0);
    const args = JSON.parse(result.output);
    assert.deepEqual(args.slice(0, 2), ['--model', 'gemini-3.6-flash-high']);
    assert(args.includes('plan'));
    assert(args.includes('--sandbox'));
    assert(!args.includes('--dangerously-skip-permissions'));
    assert(args.includes('--print'));
    assert(args.some((arg) => arg.includes('CODECK_ANTIGRAVITY_MARKER')));
    assert.equal(fs.existsSync(path.join(cwd, '.codeck', 'runs', 'agy-probe.context.md')), false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('generic adapter supports stdin prompts', async () => {
  const profile = {
    agent: 'stdin_probe',
    role: 'probe',
    description: 'stdin probe',
    allowed_modes: ['ask'],
    read_files: true,
    write_files: false,
    run_shell: false,
    context_include: [],
  };
  const context = {
    markdown: 'CODECK_STDIN_MARKER',
    resources: [],
    summary: { chars: 19, resourceCount: 0, truncated: false, omitted: [] },
  };
  const result = await getAdapter('generic').invoke({
    agentName: 'stdin_probe',
    agent: {
      command: 'node -e process.stdin.pipe(process.stdout)',
      adapter: 'generic',
      prompt_args: [],
      timeout_ms: 5000,
    },
    executorName: 'stdin_probe',
    profile,
    task: 'verify stdin',
    context,
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.output, /CODECK_STDIN_MARKER/);
});

test('CLI adapters reject an empty answer even when the process exits successfully', async () => {
  const result = await getAdapter('generic').invoke({
    agentName: 'empty_probe',
    agent: {
      command: process.execPath,
      adapter: 'generic',
      prompt_args: ['-e', 'process.stderr.write("permission denied")'],
    },
    executorName: 'empty_probe',
    profile: {
      agent: 'empty_probe',
      role: 'probe',
      description: 'empty output probe',
      allowed_modes: ['ask'],
      read_files: false,
      write_files: false,
      run_shell: false,
      context_include: [],
    },
    task: 'verify empty output handling',
    context: { markdown: '', resources: [], summary: { chars: 0, resourceCount: 0, truncated: false, omitted: [] } },
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.error, /permission denied/);
});

test('CLI adapters inherit only base and explicitly configured environment variables', async () => {
  const previous = process.env.CODECK_SECRET_CANARY;
  process.env.CODECK_SECRET_CANARY = 'must-not-leak';
  try {
    const profile = {
      agent: 'env_probe',
      role: 'probe',
      description: 'environment probe',
      allowed_modes: ['ask'],
      read_files: false,
      write_files: false,
      run_shell: false,
      context_include: [],
    };
    const context = {
      markdown: 'ENV_PROBE',
      resources: [],
      summary: { chars: 9, resourceCount: 0, truncated: false, omitted: [] },
    };
    const result = await getAdapter('generic').invoke({
      agentName: 'env_probe',
      agent: {
        command: process.execPath,
        adapter: 'generic',
        prompt_args: ['-p', 'JSON.stringify({ secret: process.env.CODECK_SECRET_CANARY, allowed: process.env.CODECK_ALLOWED })'],
        env: { CODECK_ALLOWED: 'yes' },
      },
      executorName: 'env_probe',
      profile,
      task: 'verify environment filtering',
      context,
      cwd: projectRoot,
    });

    assert.equal(result.exitCode, 0);
    assert.deepEqual(JSON.parse(result.output), { allowed: 'yes' });
  } finally {
    if (previous === undefined) delete process.env.CODECK_SECRET_CANARY;
    else process.env.CODECK_SECRET_CANARY = previous;
  }
});

test('Gemini image parts support both API field styles', () => {
  const parts = extractGeminiImageParts({
    candidates: [{
      content: {
        parts: [
          { inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } },
          { inline_data: { mime_type: 'image/jpeg', data: 'd29ybGQ=' } },
        ],
      },
    }],
  });

  assert.equal(parts.length, 2);
  assert.equal(parts[0].mimeType, 'image/png');
  assert.equal(parts[1].mimeType, 'image/jpeg');
});

test('bundled MCP runtime works without a node_modules directory', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeck-bundle-'));
  fs.mkdirSync(path.join(runtimeRoot, 'dist'));
  fs.copyFileSync(path.join(projectRoot, 'package.json'), path.join(runtimeRoot, 'package.json'));
  fs.copyFileSync(path.join(projectRoot, 'dist', 'codeck.bundle.js'), path.join(runtimeRoot, 'dist', 'codeck.bundle.js'));
  const client = new Client({ name: 'codeck-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(runtimeRoot, 'dist', 'codeck.bundle.js'), 'mcp', 'start'],
    cwd: runtimeRoot,
    stderr: 'pipe',
  });

  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.version, VERSION);
    const result = await client.listTools();
    const routeTool = result.tools.find((tool) => tool.name === 'route_task');
    assert(routeTool);
    assert(routeTool.inputSchema.required.includes('executor'));
    assert(routeTool.inputSchema.required.includes('projectPath'));
    assert(routeTool.inputSchema.required.includes('includeRepository'));
    assert(result.tools.some((tool) => tool.name === 'pick_executor'));
    for (const name of ['wait_run', 'list_runs', 'search_runs', 'curate_run', 'replay_run', 'export_archive']) {
      assert(result.tools.some((tool) => tool.name === name), `missing MCP tool: ${name}`);
    }
  } finally {
    await client.close().catch(() => undefined);
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('MCP completes a focused Codex-to-specialist-to-Codex task against the explicit project', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codeck-specialist-'));
  const client = new Client({ name: 'codeck-specialist-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(projectRoot, 'dist/codeck.bundle.js'), 'mcp', 'start'],
    cwd: projectRoot,
    stderr: 'pipe',
  });

  try {
    initCodeck(cwd);
    fs.writeFileSync(path.join(cwd, '.codeck', 'project.md'), '# Product\nPROJECT_BACKGROUND_MARKER\n', 'utf8');
    fs.writeFileSync(path.join(cwd, 'README.md'), 'REPOSITORY_CONTEXT_MUST_STAY_OUT', 'utf8');
    await client.connect(transport);

    const result = await client.callTool({
      name: 'route_task',
      arguments: {
        mode: 'ask',
        executor: 'mock',
        projectPath: cwd,
        task: 'Write an App Store subtitle.',
        brief: 'HOST_PRODUCT_BRIEF_MARKER',
        includeRepository: false,
        files: [],
      },
    });
    assert.equal(result.isError, undefined);
    const body = result.content.find((item) => item.type === 'text');
    assert(body);
    const run = JSON.parse(body.text);
    assert.equal(run.status, 'succeeded');
    assert.equal(run.executor, 'mock');
    assert.equal(run.projectPath, fs.realpathSync(cwd));
    assert.match(run.output, /Mock executor: mock/);

    const archived = getRun(run.id, cwd);
    assert.match(archived?.contextSnapshot || '', /HOST_PRODUCT_BRIEF_MARKER/);
    assert.match(archived?.contextSnapshot || '', /PROJECT_BACKGROUND_MARKER/);
    assert.doesNotMatch(archived?.contextSnapshot || '', /REPOSITORY_CONTEXT_MUST_STAY_OUT/);
  } finally {
    await client.close().catch(() => undefined);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('MCP routing requires a named executor and rejects files outside the project', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codeck-boundary-'));
  const outside = path.join(os.tmpdir(), `codeck-outside-${Date.now()}.md`);
  try {
    initCodeck(cwd);
    fs.writeFileSync(outside, 'outside', 'utf8');

    await assert.rejects(
      routeTask({ mode: 'ask', task: 'unnamed specialist' }, { cwd, caller: 'mcp' }),
      (error) => error?.code === 'explicit_executor_required',
    );
    await assert.rejects(
      routeTask({ mode: 'ask', executor: 'mock', task: 'read outside', files: [outside] }, { cwd, caller: 'mcp' }),
      (error) => error?.code === 'file_outside_project',
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  }
});

test('MCP long runs return a run id, persist partial output, and can be polled to completion', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codeck-async-'));
  try {
    const { configPath } = initCodeck(cwd);
    const slowProbePath = path.join(cwd, 'slow-probe.mjs');
    fs.writeFileSync(slowProbePath, `let prompt = '';
process.stdin.on('data', (chunk) => { prompt += chunk.toString(); });
process.stdin.on('end', () => {
  process.stdout.write('SLOW_PARTIAL\\n');
  setTimeout(() => {
    const secret = prompt.includes('sk-test') ? 'sk-test1234567890123456' : 'no-secret';
    process.stdout.write(\`SLOW_DONE \${secret}\\n\`);
  }, 800);
});
`, 'utf8');
    fs.appendFileSync(configPath, `
[agents.slow_probe]
command = "node ${slowProbePath}"
adapter = "generic"
timeout_ms = 5000
prompt_args = []

[executors.slow_probe]
agent = "slow_probe"
role = "probe"
description = "Slow test probe"
allowed_modes = ["ask"]
read_files = true
write_files = false
run_shell = false
context_include = []
`);

    const run = await routeTask({
      mode: 'ask',
      executor: 'slow_probe',
      task: 'long task with api_key=sk-test1234567890123456',
    }, { cwd, caller: 'mcp', waitMs: 100 });

    assert.equal(run.status, 'running');
    assert(run.id);

    const pending = getRun(run.id, cwd);
    assert.equal(pending?.status, 'running');
    assert.match(pending?.partialOutput || '', /SLOW_PARTIAL/);

    const completed = await waitForRun(run.id, cwd, 5000);
    assert.equal(completed?.status, 'succeeded');
    assert.match(completed?.output || '', /SLOW_DONE/);

    const archived = listRuns({ query: 'long task', limit: 10 }, cwd).find((item) => item.id === run.id);
    assert.equal(archived?.status, 'succeeded');
    assert.match(archived?.output || '', /\[REDACTED:api-key\]/);
    assert.doesNotMatch(archived?.output || '', /sk-test1234567890123456/);
    assert.doesNotMatch(archived?.task || '', /sk-test1234567890123456/);
    assert.doesNotMatch(fs.readFileSync(path.join(cwd, '.codeck', 'runs', `${run.id}.json`), 'utf8'), /sk-test1234567890123456/);
    assert.doesNotMatch(fs.readFileSync(path.join(cwd, '.codeck', 'last.md'), 'utf8'), /sk-test1234567890123456/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('replay links a new run and deleting an archive does not resurrect the legacy record', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codeck-replay-'));
  try {
    initCodeck(cwd);
    const source = await routeTask({ mode: 'ask', executor: 'mock', task: 'replay source' }, { cwd, caller: 'cli' });
    const replay = await replayRun(source.id, { cwd, caller: 'cli' });

    assert.notEqual(replay.id, source.id);
    assert.equal(replay.parentRunId, source.id);
    assert.equal(replay.status, 'succeeded');
    assert.equal(deleteRun(source.id, cwd), true);
    assert.equal(getRun(source.id, cwd), null);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
