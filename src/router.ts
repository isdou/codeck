import fs from 'fs';
import path from 'path';
import { getAdapter, formatRunMarkdown } from './adapters.js';
import { getDevDeckDir, loadConfig } from './config.js';
import { buildContext } from './context.js';
import type { CompareExecutorsInput, HandoffMode, RouteTaskInput, RunRecord } from './models.js';

export class DevDeckError extends Error {
  constructor(public code: string, message: string, public details: Record<string, unknown> = {}) {
    super(message);
  }
}

function runId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-') + '-' + Math.random().toString(36).slice(2, 8);
}

function runsDir(cwd: string): string {
  return path.join(getDevDeckDir(cwd), 'runs');
}

function latestRunJson(cwd: string): string | null {
  const dir = runsDir(cwd);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.json')).sort();
  return files.length ? path.join(dir, files[files.length - 1]) : null;
}

function saveRun(cwd: string, run: Omit<RunRecord, 'logPath' | 'jsonPath'>): RunRecord {
  fs.mkdirSync(runsDir(cwd), { recursive: true });
  const jsonPath = path.join(runsDir(cwd), `${run.id}.json`);
  const logPath = path.join(runsDir(cwd), `${run.id}.md`);
  const fullRun: RunRecord = { ...run, jsonPath, logPath };
  fs.writeFileSync(jsonPath, JSON.stringify(fullRun, null, 2), 'utf8');
  fs.writeFileSync(logPath, formatRunMarkdown(fullRun), 'utf8');
  fs.writeFileSync(path.join(getDevDeckDir(cwd), 'last.md'), fullRun.output, 'utf8');
  return fullRun;
}

export function getRun(runIdValue?: string, cwd: string = process.cwd()): RunRecord | null {
  const jsonPath = runIdValue ? path.join(runsDir(cwd), `${runIdValue}.json`) : latestRunJson(cwd);
  if (!jsonPath || !fs.existsSync(jsonPath)) return null;
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as RunRecord;
}

function assertTask(task: string | undefined): asserts task is string {
  if (!task || !task.trim()) {
    throw new DevDeckError('current_task_required', 'DevDeck requires an explicit current task.');
  }
}

export async function routeTask(
  input: RouteTaskInput,
  options: { cwd?: string; caller?: 'cli' | 'mcp'; allowOverBudget?: boolean } = {},
): Promise<RunRecord> {
  const cwd = options.cwd || process.cwd();
  const config = loadConfig(cwd);
  assertTask(input.task);

  const profile = config.executors[input.executor];
  if (!profile) {
    throw new DevDeckError('executor_not_found', `Executor "${input.executor}" is not configured.`, {
      executors: Object.keys(config.executors),
    });
  }
  if (!profile.allowed_modes.includes(input.mode)) {
    throw new DevDeckError('mode_not_allowed', `Executor "${input.executor}" does not allow mode "${input.mode}".`, {
      allowed_modes: profile.allowed_modes,
    });
  }
  if ((profile.write_files || profile.run_shell) && options.caller === 'mcp') {
    throw new DevDeckError('permission_requires_cli_confirmation', 'MCP calls cannot auto-run writable or shell-enabled executors.');
  }

  const agent = config.agents[profile.agent];
  if (!agent) {
    throw new DevDeckError('agent_not_found', `Agent "${profile.agent}" for executor "${input.executor}" is not configured.`);
  }

  const maxContext = options.caller === 'mcp' ? config.budget.mcp_max_context_chars : config.budget.max_context_chars;
  const context = buildContext(cwd, { task: input.task, executor: profile, files: input.files, maxChars: maxContext });
  if (context.summary.chars > maxContext && !options.allowOverBudget) {
    throw new DevDeckError('budget_exceeded', 'Context exceeds configured budget.', {
      actual: context.summary.chars,
      max: maxContext,
      omitted: context.summary.omitted,
    });
  }

  const adapter = getAdapter(agent.adapter);
  const result = await adapter.invoke({
    agentName: profile.agent,
    agent,
    executorName: input.executor,
    profile,
    task: input.task,
    context,
  });

  const run = saveRun(cwd, {
    id: runId(),
    date: new Date().toISOString(),
    host: input.host || (options.caller === 'cli' ? 'cli' : 'codex'),
    mode: input.mode,
    executor: input.executor,
    agent: profile.agent,
    task: input.task,
    output: result.output,
    error: result.error,
    exitCode: result.exitCode,
    contextSummary: context.summary,
    budget: {
      max: maxContext,
      actual: context.summary.chars,
      exceeded: context.summary.chars > maxContext,
    },
  });

  if (run.exitCode !== 0) {
    throw new DevDeckError('executor_failed', `Executor "${input.executor}" exited with code ${run.exitCode}.`, {
      runId: run.id,
      exitCode: run.exitCode,
      error: run.error,
      logPath: run.logPath,
    });
  }

  return run;
}

export async function compareExecutors(
  input: CompareExecutorsInput,
  options: { cwd?: string; caller?: 'cli' | 'mcp' } = {},
): Promise<{ runs: RunRecord[]; output: string; run: RunRecord }> {
  assertTask(input.task);
  const cwd = options.cwd || process.cwd();
  const config = loadConfig(cwd);
  const runs: RunRecord[] = [];
  const errors: string[] = [];

  for (const executor of input.executors) {
    try {
      runs.push(await routeTask({
        host: input.host,
        mode: 'compare',
        executor,
        task: input.task,
        files: input.files,
      }, { ...options, cwd }));
    } catch (err: any) {
      errors.push(`## ${executor}\nError: ${err.message}`);
    }
  }

  const output = [
    '# DevDeck Compare Result',
    ...runs.map((run) => `## ${run.executor}\n\n${run.output.trim() || '(no output)'}`),
    ...errors,
    '',
    '## Handoff Notes',
    'Review agreement, conflicts, and choose the next Codex action.',
  ].join('\n\n');

  const aggregateRun = saveRun(cwd, {
    id: runId(),
    date: new Date().toISOString(),
    host: input.host || (options.caller === 'cli' ? 'cli' : 'codex'),
    mode: 'compare',
    executor: input.executors.join(','),
    agent: 'devdeck',
    task: input.task,
    output,
    error: errors.join('\n'),
    exitCode: errors.length ? 1 : 0,
    contextSummary: {
      chars: output.length,
      resourceCount: runs.length,
      truncated: false,
      omitted: [],
    },
    budget: {
      max: config.budget.max_context_chars,
      actual: output.length,
      exceeded: output.length > config.budget.max_context_chars,
    },
  });

  return { runs, output, run: aggregateRun };
}

export function createRawHandoff(run: RunRecord): string {
  return [
    '=== DEVDECK RAW HANDOFF ===',
    `Run: ${run.id}`,
    `Mode: ${run.mode}`,
    `Executor: ${run.executor}`,
    '',
    '## Key Source Output',
    run.output.trim() || '(no output)',
    '',
    '## Host Next Step Prompt',
    'Continue from the executor result above. Preserve project constraints, avoid unrelated changes, and verify the final work.',
  ].join('\n');
}

export async function createHandoff(
  input: { runId?: string; mode?: HandoffMode } = {},
  options: { cwd?: string; caller?: 'cli' | 'mcp' } = {},
): Promise<string> {
  const cwd = options.cwd || process.cwd();
  const config = loadConfig(cwd);
  const run = getRun(input.runId, cwd);
  if (!run) return 'No previous DevDeck run is available.';

  const mode = input.mode || config.handoff.default_mode;
  if (mode === 'raw') return createRawHandoff(run);
  if (!config.handoff.smart_enabled) {
    throw new DevDeckError('smart_handoff_disabled', 'Smart handoff is disabled in config.');
  }

  const smartRun = await routeTask({
    host: options.caller === 'cli' ? 'cli' : 'codex',
    mode: 'ask',
    executor: config.handoff.handoff_executor,
    task: [
      'Convert this DevDeck executor output into a Host-ready handoff.',
      'Include: key judgment, executable next steps, do-not-change scope, project constraint conflicts, and a continuation prompt.',
      '',
      run.output,
    ].join('\n'),
  }, options);
  return smartRun.output;
}

export function listExecutors(cwd: string = process.cwd()): string {
  const config = loadConfig(cwd);
  return Object.entries(config.executors)
    .map(([name, profile]) => `- **${name}**: agent=\`${profile.agent}\`, role=\`${profile.role}\`, modes=${profile.allowed_modes.join(', ')}, write_files=${profile.write_files}, run_shell=${profile.run_shell}`)
    .join('\n');
}
