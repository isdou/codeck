#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { spawnSync } from 'child_process';
import { initCodeck, runDoctor, getConfigPath, loadConfig } from './config.js';
import { writeContextCache } from './context.js';
import { startMcpServer } from './mcp.js';
import { cancelRouteTask, compareExecutors, createHandoff, curateRun, deleteRun, exportRuns, getRun, importRuns, listExecutors, listRuns, pickExecutor, publicRun, replayRun, routeTask, waitForRun, } from './router.js';
import { VERSION } from './version.js';
marked.setOptions({ renderer: new TerminalRenderer() });
const program = new Command();
program
    .name('codeck')
    .description('Codeck: Codex-first local AI CLI Router MCP server')
    .version(VERSION);
async function confirmDangerousExecutor(executor, yes) {
    const profile = loadConfig().executors[executor];
    if (!profile || (!profile.write_files && !profile.run_shell) || yes)
        return;
    const rl = createInterface({ input, output });
    const answer = await rl.question(`Executor "${executor}" has write_files=${profile.write_files}, run_shell=${profile.run_shell}. Continue? [y/N] `);
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) {
        throw new Error('Cancelled by user.');
    }
}
function taskFrom(parts) {
    return parts.join(' ').trim();
}
function commandExists(command) {
    return spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], { stdio: 'ignore' }).status === 0;
}
function installGeminiCli() {
    console.log(chalk.yellow('Gemini CLI is now a legacy path for individual accounts. Prefer "codeck install antigravity" for Google CLI access through Agy.'));
    console.log(chalk.gray('Enterprise Gemini Code Assist licenses and paid Gemini API-key access remain supported by Google.'));
    if (commandExists('gemini')) {
        console.log(chalk.green('gemini is already installed.'));
        return;
    }
    if (!commandExists('npm')) {
        throw new Error('npm is required to install Gemini CLI.');
    }
    const result = spawnSync('npm', ['install', '-g', '@google/gemini-cli'], { stdio: 'inherit' });
    if (result.status !== 0) {
        throw new Error(`npm install failed with code ${result.status}.`);
    }
    console.log(chalk.green('Installed Gemini CLI.'));
}
function installKimiCli() {
    if (commandExists('kimi')) {
        console.log(chalk.green('kimi is already installed.'));
        return;
    }
    if (!commandExists('curl') || !commandExists('bash')) {
        throw new Error('curl and bash are required to install Kimi Code CLI.');
    }
    const result = spawnSync('bash', ['-lc', 'curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash'], { stdio: 'inherit' });
    if (result.status !== 0) {
        throw new Error(`Kimi Code installer failed with code ${result.status}.`);
    }
    console.log(chalk.green('Installed Kimi Code CLI.'));
    console.log(chalk.gray('Run "kimi login" once if authentication is not configured yet.'));
}
function installGrokCli() {
    if (commandExists('grok')) {
        console.log(chalk.green('grok is already installed.'));
        return;
    }
    if (!commandExists('curl') || !commandExists('bash')) {
        throw new Error('curl and bash are required to install Grok Build CLI.');
    }
    const result = spawnSync('bash', ['-lc', 'curl -fsSL https://x.ai/cli/install.sh | bash'], { stdio: 'inherit' });
    if (result.status !== 0) {
        throw new Error(`Grok Build installer failed with code ${result.status}.`);
    }
    console.log(chalk.green('Installed Grok Build CLI.'));
    console.log(chalk.gray('Run "grok login" once if authentication is not configured yet.'));
}
function installAntigravityCli() {
    if (commandExists('agy')) {
        console.log(chalk.green('agy is already installed.'));
        console.log(chalk.gray('If first use requires auth, run "agy --print \\"hello\\"" once and complete the browser login.'));
        return;
    }
    if (!commandExists('curl') || !commandExists('bash')) {
        throw new Error('curl and bash are required to install Antigravity CLI.');
    }
    const result = spawnSync('bash', ['-lc', 'curl -fsSL https://antigravity.google/cli/install.sh | bash'], { stdio: 'inherit' });
    if (result.status !== 0) {
        throw new Error(`Antigravity installer failed with code ${result.status}.`);
    }
    console.log(chalk.green('Installed Antigravity CLI.'));
    console.log(chalk.gray('If first use requires auth, run "agy --print \\"hello\\"" once and complete the browser login.'));
}
function printRunSummary(run) {
    console.log(chalk.gray(`\nExecutor: ${run.executor} | Agent: ${run.agent}`));
    console.log(chalk.gray(`Run: ${run.id}`));
    console.log(chalk.gray(`Context: ${run.budget.actual.toLocaleString()} / ${run.budget.max.toLocaleString()} chars`));
    if (run.usage) {
        const typeLabel = run.usage.estimated ? 'Est.' : 'Exact';
        console.log(chalk.gray(`Usage: Prompt ${run.usage.promptTokens.toLocaleString()} | Completion ${run.usage.completionTokens.toLocaleString()} tokens | Cost: $${run.usage.estimatedCostUsd.toFixed(5)} (${typeLabel})`));
    }
}
program
    .command('init')
    .description('Initialize Codeck workspace')
    .action(() => {
    try {
        const res = initCodeck();
        console.log(res.created ? chalk.green('Initialized Codeck.') : chalk.yellow('Codeck is already initialized.'));
        console.log(chalk.gray(`Config: ${res.configPath}`));
    }
    catch (err) {
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
    }
});
program
    .command('doctor')
    .description('Probe configured agents and executor profiles')
    .action(() => {
    try {
        const res = runDoctor();
        if (!res.configExists) {
            console.log(chalk.red('Codeck is not initialized. Run "codeck init" first.'));
            process.exit(1);
        }
        console.log(chalk.bold('\nCodeck Doctor\n'));
        console.log(`${chalk.green('config')} ${getConfigPath()}`);
        for (const agent of res.agents) {
            console.log(`${agent.exists ? chalk.green('ok') : chalk.red('missing')} ${agent.agentName} adapter=${agent.adapter} command=${agent.command} - ${agent.message}`);
        }
        console.log(`\nExecutors:\n${res.executors.map((name) => `- ${name}`).join('\n')}`);
    }
    catch (err) {
        console.error(chalk.red(`Doctor failed: ${err.message}`));
        process.exit(1);
    }
});
program
    .command('install')
    .description('Install supported executor CLIs')
    .argument('<agent>', 'Currently supported: antigravity, gemini (legacy), kimi, grok')
    .action((agent) => {
    try {
        if (agent === 'gemini') {
            installGeminiCli();
            return;
        }
        if (agent === 'kimi') {
            installKimiCli();
            return;
        }
        if (agent === 'grok') {
            installGrokCli();
            return;
        }
        if (agent === 'antigravity' || agent === 'agy') {
            installAntigravityCli();
            return;
        }
        throw new Error('Only "antigravity", "gemini", "kimi", and "grok" auto-install are supported.');
    }
    catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
    }
});
program
    .command('context')
    .description('Refresh .codeck/context.md')
    .action(() => {
    try {
        writeContextCache();
        console.log(chalk.green('Project context updated.'));
    }
    catch (err) {
        console.error(chalk.red(`Failed to build context: ${err.message}`));
        process.exit(1);
    }
});
program
    .command('list')
    .description('List executor profiles')
    .action(() => {
    try {
        console.log(listExecutors());
    }
    catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
    }
});
program
    .command('pick')
    .description('Pick an executor from routing rules without invoking it')
    .argument('<task...>', 'Task text')
    .option('-m, --mode <mode>', 'ask, subagent, or delegate', 'ask')
    .action((taskParts, options) => {
    try {
        console.log(pickExecutor(taskFrom(taskParts), options.mode, process.cwd(), 'cli'));
    }
    catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
    }
});
program
    .command('auto')
    .description('Pick an executor from routing rules and run the task')
    .argument('<task...>', 'Task text')
    .option('-m, --mode <mode>', 'ask, subagent, or delegate', 'ask')
    .option('-f, --file <file...>', 'Files to include')
    .option('--full-context', 'Use the full context budget for ask mode')
    .option('-y, --yes', 'Confirm writable/shell-enabled executor')
    .action(async (taskParts, options) => {
    try {
        const mode = options.mode;
        const task = taskFrom(taskParts);
        const executor = pickExecutor(task, mode, process.cwd(), 'cli');
        await confirmDangerousExecutor(executor, Boolean(options.yes));
        const run = await routeTask({ mode, executor, task, files: options.file }, { caller: 'cli', allowOverBudget: Boolean(options.fullContext) });
        console.log(run.output);
        printRunSummary(run);
    }
    catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
    }
});
program
    .command('route')
    .description('Fallback route command: codeck route <mode> <executor> <task...>')
    .argument('<mode>', 'ask, subagent, or delegate')
    .argument('<executor>', 'Executor profile')
    .argument('<task...>', 'Task text')
    .option('-f, --file <file...>', 'Files to include')
    .option('--full-context', 'Use the full context budget for ask mode')
    .option('-y, --yes', 'Confirm writable/shell-enabled executor')
    .action(async (mode, executor, taskParts, options) => {
    try {
        const task = taskFrom(taskParts);
        const selectedExecutor = executor === 'auto' ? pickExecutor(task, mode, process.cwd(), 'cli') : executor;
        await confirmDangerousExecutor(selectedExecutor, Boolean(options.yes));
        const run = await routeTask({ mode, executor: selectedExecutor, task, files: options.file }, { caller: 'cli', allowOverBudget: Boolean(options.fullContext) });
        console.log(run.output);
        printRunSummary(run);
    }
    catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
    }
});
program
    .command('ask')
    .description('Fallback ask command')
    .argument('<executor>', 'Executor profile')
    .argument('<task...>', 'Task text')
    .option('-f, --file <file...>', 'Files to include')
    .option('--full-context', 'Use the full context budget')
    .action(async (executor, taskParts, options) => {
    try {
        const task = taskFrom(taskParts);
        const selectedExecutor = executor === 'auto' ? pickExecutor(task, 'ask', process.cwd(), 'cli') : executor;
        const run = await routeTask({ mode: 'ask', executor: selectedExecutor, task, files: options.file }, { caller: 'cli', allowOverBudget: Boolean(options.fullContext) });
        console.log(run.output);
        printRunSummary(run);
    }
    catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
    }
});
program
    .command('delegate')
    .description('Fallback delegate command')
    .argument('<executor>', 'Executor profile')
    .argument('<task...>', 'Task text')
    .option('-f, --file <file...>', 'Files to include')
    .option('-y, --yes', 'Confirm writable/shell-enabled executor')
    .action(async (executor, taskParts, options) => {
    try {
        const task = taskFrom(taskParts);
        const selectedExecutor = executor === 'auto' ? pickExecutor(task, 'delegate', process.cwd(), 'cli') : executor;
        await confirmDangerousExecutor(selectedExecutor, Boolean(options.yes));
        const run = await routeTask({ mode: 'delegate', executor: selectedExecutor, task, files: options.file }, { caller: 'cli' });
        console.log(run.output);
        printRunSummary(run);
    }
    catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
    }
});
program
    .command('compare')
    .description('Fallback compare command')
    .argument('<executors>', 'Comma-separated executor profiles')
    .argument('<task...>', 'Task text')
    .option('-f, --file <file...>', 'Files to include')
    .action(async (executors, taskParts, options) => {
    try {
        const result = await compareExecutors({ executors: executors.split(',').map((s) => s.trim()), task: taskFrom(taskParts), files: options.file }, { caller: 'cli' });
        console.log(result.output);
        printRunSummary(result.run);
    }
    catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
    }
});
program
    .command('last')
    .description('Print latest run output')
    .action(() => {
    const run = getRun();
    if (!run) {
        console.log(chalk.yellow('No Codeck runs found.'));
        return;
    }
    console.log(marked(run.output));
    printRunSummary(run);
});
program
    .command('bringback')
    .description('Format latest run as a Host handoff')
    .option('-m, --mode <mode>', 'raw or smart')
    .action(async (options) => {
    try {
        console.log(await createHandoff({ mode: options.mode }, { caller: 'cli' }));
    }
    catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
    }
});
program
    .command('runs')
    .description('List archived Codeck runs')
    .argument('[query]', 'Optional search text')
    .option('-s, --status <status>', 'Filter by run status')
    .option('-e, --executor <executor>', 'Filter by executor')
    .option('-c, --curated', 'Only curated knowledge runs')
    .option('-n, --limit <limit>', 'Maximum number of runs', '20')
    .action((query, options) => {
    try {
        const records = listRuns({
            query,
            status: options.status,
            executor: options.executor,
            curated: options.curated ? true : undefined,
            limit: Number(options.limit),
        });
        if (!records.length) {
            console.log(chalk.yellow('No archived Codeck runs found.'));
            return;
        }
        for (const run of records) {
            console.log(`${run.id}  ${run.status || 'unknown'}  ${run.executor}  ${run.task.slice(0, 100)}`);
        }
    }
    catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
    }
});
program
    .command('run')
    .description('Show one archived Codeck run')
    .argument('<runId>', 'Run id')
    .option('--content', 'Include the redacted prompt and context snapshot')
    .action((runIdValue, options) => {
    const run = getRun(runIdValue);
    if (!run) {
        console.log(chalk.yellow('No Codeck run found.'));
        return;
    }
    console.log(JSON.stringify(options.content ? run : publicRun(run), null, 2));
});
program
    .command('wait')
    .description('Wait for a pending Codeck run')
    .argument('<runId>', 'Run id')
    .option('-t, --timeout <ms>', 'Maximum wait in milliseconds', '40000')
    .action(async (runIdValue, options) => {
    const requestedTimeout = Number(options.timeout);
    const timeout = Number.isFinite(requestedTimeout) ? Math.min(Math.max(requestedTimeout, 0), 45000) : 40000;
    const run = await waitForRun(runIdValue, process.cwd(), timeout);
    console.log(run ? JSON.stringify(publicRun(run), null, 2) : 'No Codeck run found.');
});
program
    .command('cancel')
    .description('Cancel a pending Codeck run')
    .argument('<runId>', 'Run id')
    .action((runIdValue) => {
    const run = cancelRouteTask(runIdValue);
    console.log(run ? JSON.stringify(publicRun(run), null, 2) : 'No active Codeck run found.');
});
program
    .command('curate')
    .description('Mark an archived run as reusable knowledge')
    .argument('<runId>', 'Run id')
    .option('--tag <tag...>', 'Knowledge tags')
    .option('--note <note>', 'Curator note')
    .action((runIdValue, options) => {
    const run = curateRun(runIdValue, { tags: options.tag, note: options.note });
    console.log(run ? JSON.stringify(publicRun(run), null, 2) : 'No archived Codeck run found.');
});
program
    .command('delete-run')
    .description('Delete one archived Codeck run')
    .argument('<runId>', 'Run id')
    .option('-y, --yes', 'Confirm permanent deletion')
    .action((runIdValue, options) => {
    try {
        if (!options.yes)
            throw new Error('Pass --yes after verifying the run id to permanently delete it.');
        console.log(deleteRun(runIdValue) ? 'Archived Codeck run deleted.' : 'No archived Codeck run found.');
    }
    catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
    }
});
program
    .command('export')
    .description('Export the project-local Codeck archive')
    .option('-f, --format <format>', 'json or markdown', 'json')
    .option('-o, --output <path>', 'Write to a file instead of stdout')
    .action((options) => {
    const format = options.format === 'markdown' ? 'markdown' : 'json';
    const content = exportRuns(format);
    if (options.output) {
        fs.writeFileSync(options.output, content, { encoding: 'utf8', mode: 0o600 });
        console.log(chalk.green(`Archive exported to ${options.output}`));
    }
    else {
        console.log(content);
    }
});
program
    .command('import-runs')
    .description('Import legacy .codeck/runs JSON records into the archive')
    .action(() => console.log(`Imported ${importRuns()} legacy run(s).`));
program
    .command('replay')
    .description('Replay an archived run')
    .argument('<runId>', 'Run id')
    .option('--current-context', 'Rebuild context from the current project instead of the historical snapshot')
    .option('-y, --yes', 'Confirm writable/shell-enabled executor')
    .action(async (runIdValue, options) => {
    try {
        const source = getRun(runIdValue);
        if (!source)
            throw new Error(`Run "${runIdValue}" was not found.`);
        await confirmDangerousExecutor(source.executor, Boolean(options.yes));
        const run = await replayRun(runIdValue, { caller: 'cli', currentContext: Boolean(options.currentContext) });
        console.log(run.output || JSON.stringify(publicRun(run), null, 2));
        printRunSummary(run);
    }
    catch (err) {
        console.error(chalk.red(err.message));
        process.exit(1);
    }
});
program
    .command('mcp')
    .description('Manage Codeck MCP Server')
    .command('start')
    .description('Start stdio MCP server')
    .action(async () => {
    try {
        await startMcpServer();
    }
    catch (err) {
        console.error(chalk.red(`MCP Server failed: ${err.message}`));
        process.exit(1);
    }
});
program.parse(process.argv);
