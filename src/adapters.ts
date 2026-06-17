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
      env: { ...process.env, ...env },
    });

    let output = '';
    let error = '';
    child.stdout.on('data', (data) => output += data.toString());
    child.stderr.on('data', (data) => error += data.toString());
    child.on('error', (err) => reject(new Error(`Failed to start "${binary}": ${err.message}`)));
    child.on('close', (code) => resolve({ output, error, exitCode: code }));

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

export function getAdapter(name: string | undefined): AgentAdapter {
  switch ((name || 'generic').toLowerCase()) {
    case 'mock':
      return mockAdapter;
    case 'claude':
      return makeCliAdapter('claude', ['-p', '{prompt}'], { text: true, file: true, image: false, document: true, writeFiles: false, runShell: false });
    case 'gemini':
      return makeCliAdapter('gemini', ['--skip-trust', '--approval-mode', 'plan', '--output-format', 'text', '-p', '{prompt}'], { text: true, file: true, image: true, document: true, writeFiles: false, runShell: false }, {
        GEMINI_CLI_TRUST_WORKSPACE: 'true',
      });
    case 'codex':
      return makeCliAdapter('codex', ['exec', '{prompt}'], { text: true, file: true, image: false, document: true, writeFiles: true, runShell: true });
    default:
      return makeCliAdapter('generic', ['{prompt}'], { text: true, file: true, image: false, document: true, writeFiles: false, runShell: false });
  }
}

export function formatRunMarkdown(run: RunRecord): string {
  return [
    `# DevDeck Run ${run.id}`,
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
