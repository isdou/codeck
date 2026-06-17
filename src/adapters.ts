import { spawn } from 'child_process';
import { spawnSync } from 'child_process';
import type { AdapterCapabilities, AgentConfig, BuiltContext, ExecutorProfile, RunRecord } from './models.js';

export interface AdapterInvokeInput {
  agentName: string;
  agent: AgentConfig;
  executorName: string;
  profile: ExecutorProfile;
  task: string;
  context: BuiltContext;
}

export interface AdapterInvokeResult {
  output: string;
  error: string;
  exitCode: number | null;
}

export interface AgentAdapter {
  name: string;
  capabilities: AdapterCapabilities;
  probe(agent: AgentConfig): { ok: boolean; message: string };
  invoke(input: AdapterInvokeInput): Promise<AdapterInvokeResult>;
}

function splitCommand(command: string): { binary: string; args: string[] } {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  return { binary: parts[0] || '', args: parts.slice(1) };
}

function commandExists(command: string): boolean {
  const { binary } = splitCommand(command);
  if (!binary) return false;
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [binary], { stdio: 'ignore' });
  return probe.status === 0;
}

function buildPrompt(input: AdapterInvokeInput): string {
  return [
    `=== DEVDECK ROUTED TASK ===`,
    `Executor: ${input.executorName}`,
    `Role: ${input.profile.role}`,
    `Task: ${input.task}`,
    ``,
    `=== CONTEXT ===`,
    input.context.markdown,
    ``,
    `=== INSTRUCTION ===`,
    `Answer the routed task. Respect the executor permissions: write_files=${input.profile.write_files}, run_shell=${input.profile.run_shell}.`,
  ].join('\n');
}

function applyPromptArgs(agent: AgentConfig, defaults: string[], prompt: string): string[] {
  const template = agent.prompt_args?.length ? agent.prompt_args : defaults;
  return template.map((arg) => arg === '{prompt}' ? prompt : arg);
}

function spawnPrompt(agent: AgentConfig, promptArgs: string[], prompt: string, cwd: string, env: Record<string, string> = {}): Promise<AdapterInvokeResult> {
  return new Promise((resolve, reject) => {
    const { binary, args } = splitCommand(agent.command);
    if (!binary) {
      reject(new Error('Agent command is empty.'));
      return;
    }

    const child = spawn(binary, [...args, ...promptArgs], {
      cwd,
      shell: false,
      env: { ...process.env, ...env, ...(agent.env || {}) },
    });

    let output = '';
    let error = '';
    let settled = false;
    const timeout = agent.timeout_ms && agent.timeout_ms > 0
      ? setTimeout(() => {
        settled = true;
        child.kill('SIGTERM');
        resolve({
          output,
          error: `${error}${error ? '\n' : ''}Timed out after ${agent.timeout_ms}ms.`,
          exitCode: 124,
        });
      }, agent.timeout_ms)
      : null;
    child.stdout.on('data', (data) => output += data.toString());
    child.stderr.on('data', (data) => error += data.toString());
    child.on('error', (err) => {
      if (timeout) clearTimeout(timeout);
      if (!settled) reject(new Error(`Failed to start "${binary}": ${err.message}`));
    });
    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      if (!settled) resolve({ output, error, exitCode: code });
    });

    if (promptArgs.length === 0) {
      child.stdin.write(prompt);
      child.stdin.end();
    }
  });
}

function makeCliAdapter(name: string, defaults: string[], capabilities: AdapterCapabilities, env: Record<string, string> = {}): AgentAdapter {
  return {
    name,
    capabilities,
    probe(agent) {
      return commandExists(agent.command)
        ? { ok: true, message: `${agent.command} found` }
        : { ok: false, message: `${agent.command} not found in PATH` };
    },
    invoke(input) {
      const prompt = buildPrompt(input);
      const promptArgs = applyPromptArgs(input.agent, defaults, prompt);
      return spawnPrompt(input.agent, promptArgs, prompt, process.cwd(), env);
    },
  };
}

export const mockAdapter: AgentAdapter = {
  name: 'mock',
  capabilities: { text: true, file: true, image: false, document: true, writeFiles: false, runShell: false },
  probe() {
    return { ok: true, message: 'mock adapter ready' };
  },
  async invoke(input) {
    return {
      output: [
        `Mock executor: ${input.executorName}`,
        `Mode-compatible role: ${input.profile.role}`,
        `Task: ${input.task}`,
        `Context chars: ${input.context.summary.chars}`,
      ].join('\n'),
      error: '',
      exitCode: 0,
    };
  },
};

export const geminiWebAdapter: AgentAdapter = {
  name: 'gemini_web',
  capabilities: { text: true, file: true, image: false, document: true, writeFiles: false, runShell: false },
  probe() {
    if (process.platform !== 'darwin') return { ok: false, message: 'gemini_web currently supports macOS open/pbcopy only' };
    return commandExists('open') && commandExists('pbcopy')
      ? { ok: true, message: 'Gemini web bridge ready' }
      : { ok: false, message: 'open or pbcopy not found' };
  },
  async invoke(input) {
    const prompt = buildPrompt(input);
    const copy = spawnSync('pbcopy', { input: prompt });
    if (copy.status !== 0) {
      return { output: '', error: 'Failed to copy prompt to clipboard with pbcopy.', exitCode: copy.status };
    }
    spawn('open', ['https://gemini.google.com/app'], { detached: true, stdio: 'ignore' }).unref();
    return {
      output: [
        'Gemini Web opened.',
        'The full Codeck prompt has been copied to your clipboard.',
        'Paste it into Gemini Web, send it, then bring the answer back to Codex.',
      ].join('\n'),
      error: '',
      exitCode: 0,
    };
  },
};

export const geminiApiAdapter: AgentAdapter = {
  name: 'gemini_api',
  capabilities: { text: true, file: true, image: false, document: true, writeFiles: false, runShell: false },
  probe(agent) {
    const key = agent.api_key || process.env.GEMINI_API_KEY;
    return key
      ? { ok: true, message: 'Gemini API key is configured.' }
      : { ok: false, message: 'Gemini API key not found. Set GEMINI_API_KEY in .env or config.toml.' };
  },
  async invoke(input) {
    const key = input.agent.api_key || process.env.GEMINI_API_KEY;
    if (!key) {
      return { output: '', error: 'Gemini API Key is missing. Please set GEMINI_API_KEY.', exitCode: 1 };
    }
    const model = input.agent.model || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const prompt = buildPrompt(input);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        return { output: '', error: `Gemini API request failed (${response.status}): ${errText}`, exitCode: 1 };
      }

      const data = (await response.json()) as any;
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        return { output: '', error: `Invalid Gemini API response: ${JSON.stringify(data)}`, exitCode: 1 };
      }
      return { output: text, error: '', exitCode: 0 };
    } catch (err: any) {
      return { output: '', error: `Gemini API execution error: ${err.message}`, exitCode: 1 };
    }
  },
};

export const claudeApiAdapter: AgentAdapter = {
  name: 'claude_api',
  capabilities: { text: true, file: true, image: false, document: true, writeFiles: false, runShell: false },
  probe(agent) {
    const key = agent.api_key || process.env.ANTHROPIC_API_KEY;
    return key
      ? { ok: true, message: 'Anthropic API key is configured.' }
      : { ok: false, message: 'Anthropic API key not found. Set ANTHROPIC_API_KEY in .env or config.toml.' };
  },
  async invoke(input) {
    const key = input.agent.api_key || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return { output: '', error: 'Anthropic API Key is missing. Please set ANTHROPIC_API_KEY.', exitCode: 1 };
    }
    const model = input.agent.model || 'claude-3-5-sonnet-latest';
    const url = 'https://api.anthropic.com/v1/messages';
    const prompt = buildPrompt(input);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        return { output: '', error: `Anthropic API request failed (${response.status}): ${errText}`, exitCode: 1 };
      }

      const data = (await response.json()) as any;
      const text = data.content?.[0]?.text;
      if (!text) {
        return { output: '', error: `Invalid Anthropic API response: ${JSON.stringify(data)}`, exitCode: 1 };
      }
      return { output: text, error: '', exitCode: 0 };
    } catch (err: any) {
      return { output: '', error: `Anthropic API execution error: ${err.message}`, exitCode: 1 };
    }
  },
};

export function getAdapter(name: string | undefined): AgentAdapter {
  switch ((name || 'generic').toLowerCase()) {
    case 'mock':
      return mockAdapter;
    case 'gemini_web':
      return geminiWebAdapter;
    case 'gemini_api':
      return geminiApiAdapter;
    case 'claude_api':
      return claudeApiAdapter;
    case 'claude':
      return makeCliAdapter('claude', ['-p', '{prompt}'], { text: true, file: true, image: false, document: true, writeFiles: false, runShell: false });
    case 'gemini':
      return makeCliAdapter('gemini', ['--skip-trust', '--approval-mode', 'plan', '--output-format', 'text', '-p', '{prompt}'], { text: true, file: true, image: true, document: true, writeFiles: false, runShell: false }, {
        GEMINI_CLI_TRUST_WORKSPACE: 'true',
      });
    case 'antigravity':
      return makeCliAdapter('antigravity', ['--sandbox', '--print-timeout', '45s', '--print', '{prompt}'], { text: true, file: true, image: false, document: true, writeFiles: false, runShell: false });
    case 'codex':
      return makeCliAdapter('codex', ['exec', '{prompt}'], { text: true, file: true, image: false, document: true, writeFiles: true, runShell: true });
    default:
      return makeCliAdapter('generic', ['{prompt}'], { text: true, file: true, image: false, document: true, writeFiles: false, runShell: false });
  }
}

export function formatRunMarkdown(run: RunRecord): string {
  return [
    `# Codeck Run ${run.id}`,
    `- Date: ${run.date}`,
    `- Host: \`${run.host}\``,
    `- Mode: \`${run.mode}\``,
    `- Executor: \`${run.executor}\``,
    `- Agent: \`${run.agent}\``,
    `- Exit Code: ${run.exitCode}`,
    `- Context Chars: ${run.contextSummary.chars}`,
    ``,
    `## Task`,
    '```text',
    run.task,
    '```',
    ``,
    `## Output`,
    run.output || '(no output)',
    run.error ? `\n## Errors\n\`\`\`text\n${run.error}\n\`\`\`` : '',
  ].join('\n');
}
