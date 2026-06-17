#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { initDevDeck, runDoctor, getConfigPath, loadConfig } from './config.js';
import { writeContextCache } from './context.js';
import { startMcpServer } from './mcp.js';
import { compareExecutors, createHandoff, getRun, listExecutors, routeTask } from './router.js';
import type { RouteMode } from './models.js';

marked.setOptions({ renderer: new TerminalRenderer() });

const program = new Command();

program
  .name('devdeck')
  .description('DevDeck: Codex-first local AI CLI Router MCP server')
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

program
  .command('init')
  .description('Initialize DevDeck workspace')
  .action(() => {
    try {
      const res = initDevDeck();
      console.log(res.created ? chalk.green('Initialized DevDeck.') : chalk.yellow('DevDeck is already initialized.'));
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
        console.log(chalk.red('DevDeck is not initialized. Run "devdeck init" first.'));
        process.exit(1);
      }
      console.log(chalk.bold('\nDevDeck Doctor\n'));
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
  .command('context')
  .description('Refresh .devdeck/context.md')
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
  .command('route')
  .description('Fallback route command: devdeck route <mode> <executor> <task...>')
  .argument('<mode>', 'ask, subagent, or delegate')
  .argument('<executor>', 'Executor profile')
  .argument('<task...>', 'Task text')
  .option('-f, --file <file...>', 'Files to include')
  .option('-y, --yes', 'Confirm writable/shell-enabled executor')
  .action(async (mode: RouteMode, executor: string, taskParts: string[], options) => {
    try {
      await confirmDangerousExecutor(executor, Boolean(options.yes));
      const run = await routeTask({ mode, executor, task: taskFrom(taskParts), files: options.file }, { caller: 'cli' });
      console.log(run.output);
      console.log(chalk.gray(`\nRun: ${run.id}`));
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
  .action(async (executor: string, taskParts: string[], options) => {
    try {
      const run = await routeTask({ mode: 'ask', executor, task: taskFrom(taskParts), files: options.file }, { caller: 'cli' });
      console.log(run.output);
      console.log(chalk.gray(`\nRun: ${run.id}`));
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
      await confirmDangerousExecutor(executor, Boolean(options.yes));
      const run = await routeTask({ mode: 'delegate', executor, task: taskFrom(taskParts), files: options.file }, { caller: 'cli' });
      console.log(run.output);
      console.log(chalk.gray(`\nRun: ${run.id}`));
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
      console.log(chalk.yellow('No DevDeck runs found.'));
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
  .description('Manage DevDeck MCP Server')
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
