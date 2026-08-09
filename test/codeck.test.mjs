import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { extractGeminiImageParts, getAdapter } from '../dist/adapters.js';
import { DEFAULT_CONFIG, initCodeck } from '../dist/config.js';
import { deleteRun, getRun, listRuns, replayRun, resolveExecutor, routeTask, waitForRun } from '../dist/router.js';
import { VERSION } from '../dist/version.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('runtime version matches package.json', () => {
  const packageMetadata = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  assert.equal(VERSION, packageMetadata.version);
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
  assert.equal(DEFAULT_CONFIG.executors.gemini_frontend.agent, 'antigravity');
});

test('Antigravity adapter pins the configured agent instead of using the regional planner', async () => {
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
  const result = await getAdapter('antigravity').invoke({
    agentName: 'antigravity',
    agent: {
      command: `node ${path.join(projectRoot, 'test', 'argv-probe.mjs')}`,
      adapter: 'antigravity',
      model: 'gemini-3.6-flash-high',
      timeout_ms: 5000,
    },
    executorName: 'antigravity',
    profile,
    task: 'verify pinned agent',
    context,
  });

  assert.equal(result.exitCode, 0);
  const args = JSON.parse(result.output);
  assert.deepEqual(args.slice(0, 2), ['--agent', 'gemini-3.6-flash-high']);
  assert(args.includes('--print'));
  assert(!args.some((arg) => arg.includes('CODECK_ANTIGRAVITY_MARKER')));
  assert(args.some((arg) => arg.includes(path.join('.codeck', 'context.md'))));
  assert.match(
    fs.readFileSync(path.join(projectRoot, '.codeck', 'context.md'), 'utf8'),
    /CODECK_ANTIGRAVITY_MARKER/,
  );
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

test('MCP stdio server completes a handshake and serves tools', async () => {
  const client = new Client({ name: 'codeck-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(projectRoot, 'dist/index.js'), 'mcp', 'start'],
    cwd: projectRoot,
    stderr: 'pipe',
  });

  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.version, VERSION);
    const result = await client.listTools();
    assert(result.tools.some((tool) => tool.name === 'route_task'));
    assert(result.tools.some((tool) => tool.name === 'pick_executor'));
    for (const name of ['wait_run', 'list_runs', 'search_runs', 'curate_run', 'replay_run', 'export_archive']) {
      assert(result.tools.some((tool) => tool.name === name), `missing MCP tool: ${name}`);
    }
  } finally {
    await client.close();
  }
});

test('MCP long runs return a run id, persist partial output, and can be polled to completion', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codeck-async-'));
  try {
    const { configPath } = initCodeck(cwd);
    fs.appendFileSync(configPath, `
[agents.slow_probe]
command = "node ${path.join(projectRoot, 'test', 'slow-probe.mjs')}"
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
