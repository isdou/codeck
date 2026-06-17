#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { spawnSync } from 'child_process';
import { initCodeck, runDoctor, getConfigPath, loadConfig } from './config.js';
import { writeContextCache } from './context.js';
import { startMcpServer } from './mcp.js';
import { compareExecutors, createHandoff, getRun, listExecutors, pickExecutor, routeTask } from './router.js';
import type { RouteMode } from './models.js';

marked.setOptions({ renderer: new TerminalRenderer() });

const program = new Command();

program
  .name('codeck')
  .description('Codeck: Codex-first local AI CLI Router MCP server')
  .version('0.1.0');

async function confirmDangerousExecutor(executor: string, yes: boolean) {
  const profile = loadConfig().executors[executor];
  if (!profile || (!profile.write_files && !profile.run_shell) || yes) return;

  const rl = createInterface({ input, output });
  const answer = await rl.question(`Executor "${executor}" has write_files=${profile.write_files}, run_shell=${profile.run_shell}. Continue? [y/N] `);
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) {
    throw new Error('Cancelled by user.');
  }
}

function taskFrom(parts: string[]): string {
  return parts.join(' ').trim();
}

function commandExists(command: string): boolean {
  return spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], { stdio: 'ignore' }).status === 0;
}

function installGeminiCli() {
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

function printRunSummary(run: any) {
  console.log(chalk.gray(`\nExecutor: ${run.executor} | Agent: ${run.agent}`));
  console.log(chalk.gray(`Run: ${run.id}`));
  if (run.usage) {
    const typeLabel = run.usage.estimated ? 'Est.' : 'Exact';
    console.log(
      chalk.gray(
        `Usage: Prompt ${run.usage.promptTokens.toLocaleString()} | Completion ${run.usage.completionTokens.toLocaleString()} tokens | Cost: $${run.usage.estimatedCostUsd.toFixed(5)} (${typeLabel})`
      )
    );
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
    } catch (err: any) {
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
    } catch (err: any) {
      console.error(chalk.red(`Doctor failed: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('install')
  .description('Install supported executor CLIs')
  .argument('<agent>', 'Currently supported: gemini, antigravity')
  .action((agent: string) => {
    try {
      if (agent === 'gemini') {
        installGeminiCli();
        return;
      }
      if (agent === 'antigravity' || agent === 'agy') {
        installAntigravityCli();
        return;
      }
      throw new Error('Only "gemini" and "antigravity" auto-install are supported.');
    } catch (err: any) {
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
    } catch (err: any) {
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
    } catch (err: any) {
      console.error(chalk.red(err.message));
      process.exit(1);
    }
  });

program
  .command('pick')
  .description('Pick an executor from routing rules without invoking it')
  .argument('<task...>', 'Task text')
  .option('-m, --mode <mode>', 'ask, subagent, or delegate', 'ask')
  .action((taskParts: string[], options) => {
    try {
      console.log(pickExecutor(taskFrom(taskParts), options.mode as RouteMode, process.cwd(), 'cli'));
    } catch (err: any) {
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
  .action(async (taskParts: string[], options) => {
    try {
      const mode = options.mode as RouteMode;
      const task = taskFrom(taskParts);
      const executor = pickExecutor(task, mode, process.cwd(), 'cli');
      await confirmDangerousExecutor(executor, Boolean(options.yes));
      const run = await routeTask({ mode, executor, task, files: options.file }, { caller: 'cli', allowOverBudget: Boolean(options.fullContext) });
      console.log(run.output);
      printRunSummary(run);
    } catch (err: any) {
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
  .action(async (mode: RouteMode, executor: string, taskParts: string[], options) => {
    try {
      const task = taskFrom(taskParts);
      const selectedExecutor = executor === 'auto' ? pickExecutor(task, mode, process.cwd(), 'cli') : executor;
      await confirmDangerousExecutor(selectedExecutor, Boolean(options.yes));
      const run = await routeTask({ mode, executor: selectedExecutor, task, files: options.file }, { caller: 'cli', allowOverBudget: Boolean(options.fullContext) });
      console.log(run.output);
      printRunSummary(run);
    } catch (err: any) {
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
  .action(async (executor: string, taskParts: string[], options) => {
    try {
      const task = taskFrom(taskParts);
      const selectedExecutor = executor === 'auto' ? pickExecutor(task, 'ask', process.cwd(), 'cli') : executor;
      const run = await routeTask({ mode: 'ask', executor: selectedExecutor, task, files: options.file }, { caller: 'cli', allowOverBudget: Boolean(options.fullContext) });
      console.log(run.output);
      printRunSummary(run);
    } catch (err: any) {
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
  .action(async (executor: string, taskParts: string[], options) => {
    try {
      const task = taskFrom(taskParts);
      const selectedExecutor = executor === 'auto' ? pickExecutor(task, 'delegate', process.cwd(), 'cli') : executor;
      await confirmDangerousExecutor(selectedExecutor, Boolean(options.yes));
      const run = await routeTask({ mode: 'delegate', executor: selectedExecutor, task, files: options.file }, { caller: 'cli' });
      console.log(run.output);
      printRunSummary(run);
    } catch (err: any) {
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
  .action(async (executors: string, taskParts: string[], options) => {
    try {
      const result = await compareExecutors({ executors: executors.split(',').map((s) => s.trim()), task: taskFrom(taskParts), files: options.file }, { caller: 'cli' });
      console.log(result.output);
    } catch (err: any) {
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
  });

program
  .command('bringback')
  .description('Format latest run as a Host handoff')
  .option('-m, --mode <mode>', 'raw or smart')
  .action(async (options) => {
    try {
      console.log(await createHandoff({ mode: options.mode }, { caller: 'cli' }));
    } catch (err: any) {
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
    } catch (err: any) {
      console.error(chalk.red(`MCP Server failed: ${err.message}`));
      process.exit(1);
    }
  });

program.parse(process.argv);
