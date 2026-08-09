import { getRun, createHandoff as createRouterHandoff, routeTask } from './router.js';
export function getLatestLogPath(cwd = process.cwd()) {
    return getRun(undefined, cwd)?.logPath || null;
}
export function getLastOutput(cwd = process.cwd()) {
    return getRun(undefined, cwd)?.output || '';
}
export function buildCombinedPrompt(agentName, userPrompt, role) {
    return [`Agent: ${agentName}`, role ? `Role: ${role}` : '', `Task: ${userPrompt}`].filter(Boolean).join('\n');
}
export async function runAgent(agentName, userPrompt, options = {}, cwd = process.cwd()) {
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
export function createHandoffPrompt(lastOutput) {
    if (!lastOutput.trim())
        return 'No previous Codeck run is available.';
    return [
        '=== DEVDECK RAW HANDOFF ===',
        '## Key Source Output',
        lastOutput.trim(),
        '',
        '## Host Next Step Prompt',
        'Continue from the executor result above. Preserve project constraints, avoid unrelated changes, and verify the final work.',
    ].join('\n');
}
export async function createLatestHandoff() {
    return createRouterHandoff({ mode: 'raw' });
}
