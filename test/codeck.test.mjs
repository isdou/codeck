import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { extractGeminiImageParts, getAdapter } from '../dist/adapters.js';
import { DEFAULT_CONFIG } from '../dist/config.js';
import { resolveExecutor } from '../dist/router.js';
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
  } finally {
    await client.close();
  }
});
