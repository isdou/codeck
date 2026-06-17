import { getRun, createHandoff as createRouterHandoff, routeTask } from './router.js';

export interface RunResult {
  agentName: string;
  command: string;
  prompt: string;
  output: string;
  error: string;
  exitCode: number | null;
  logPath: string;
}

export function getLatestLogPath(cwd: string = process.cwd()): string | null {
  return getRun(undefined, cwd)?.logPath || null;
}

export function getLastOutput(cwd: string = process.cwd()): string {
  return getRun(undefined, cwd)?.output || '';
}

export function buildCombinedPrompt(agentName: string, userPrompt: string, role: string | undefined): string {
  return [`Agent: ${agentName}`, role ? `Role: ${role}` : '', `Task: ${userPrompt}`].filter(Boolean).join('\n');
}

export async function runAgent(
  agentName: string,
  userPrompt: string,
  options: { silent?: boolean; role?: string } = {},
  cwd: string = process.cwd(),
): Promise<RunResult> {
  const run = await routeTask({
    mode: 'ask',
    executor: agentName,
    task: userPrompt,
  }, { cwd, caller: options.silent ? 'mcp' : 'cli' });

  return {
    agentName,
    command: run.agent,
    prompt: userPrompt,
    output: run.output,
    error: run.error,
    exitCode: run.exitCode,
    logPath: run.logPath,
  };
}

export function createHandoffPrompt(lastOutput: string): string {
  if (!lastOutput.trim()) return 'No previous Codeck run is available.';
  return [
    '=== DEVDECK RAW HANDOFF ===',
    '## Key Source Output',
    lastOutput.trim(),
    '',
    '## Host Next Step Prompt',
    'Continue from the executor result above. Preserve project constraints, avoid unrelated changes, and verify the final work.',
  ].join('\n');
}

export async function createLatestHandoff(): Promise<string> {
  return createRouterHandoff({ mode: 'raw' });
}
