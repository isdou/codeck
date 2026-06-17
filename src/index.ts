#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import { initDevDeck, runDoctor, getConfigPath, getDevDeckDir } from './config.js';
import { writeContextCache } from './context.js';
import { runAgent, getLastOutput } from './runner.js';
import { startMcpServer } from './mcp.js';

// Setup marked terminal renderer
marked.setOptions({
  renderer: new TerminalRenderer()
});

const program = new Command();

program
  .name('devdeck')
  .description('DevDeck: Context handoff bridge for Codex, Claude, and Gemini CLI')
  .version('0.1.0');

// 1. devdeck init
program
  .command('init')
  .description('Initialize DevDeck workspace (creates .devdeck directory and config.toml)')
  .action(() => {
    try {
      const res = initDevDeck();
      if (res.created) {
        console.log(chalk.green('✔ Initialized DevDeck successfully!'));
        console.log(chalk.gray(`Config created at: ${res.configPath}`));
        console.log(chalk.gray(`Edit config.toml to configure your local CLI commands.`));
      } else {
        console.log(chalk.yellow('ℹ DevDeck is already initialized in this directory.'));
        console.log(chalk.gray(`Config file path: ${res.configPath}`));
      }
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

// 2. devdeck doctor
program
  .command('doctor')
  .description('Verify configurations and check if local AI CLI commands are installed')
  .action(() => {
    try {
      const res = runDoctor();
      if (!res.configExists) {
        console.log(chalk.red('✗ DevDeck is not initialized. Run "devdeck init" first.'));
        process.exit(1);
      }

      console.log(chalk.bold('\n⚕ DevDeck Doctor Diagnosis Report:\n'));
      console.log(`${chalk.green('✔')} Config file found at: ${getConfigPath()}`);

      let allOk = true;
      for (const agent of res.agents) {
        if (agent.exists) {
          console.log(`${chalk.green('✔')} Agent [${chalk.cyan(agent.agentName)}]: \`${agent.command}\` is ${chalk.green('installed')}`);
        } else {
          console.log(`${chalk.red('✗')} Agent [${chalk.cyan(agent.agentName)}]: \`${agent.command}\` is ${chalk.red('NOT found')} in your PATH`);
          allOk = false;
        }
      }

      if (allOk) {
        console.log(chalk.green('\n✔ All configured AI CLI commands are available! You are ready to go. 🔌\n'));
      } else {
        console.log(chalk.yellow('\n⚠ Some agent CLI commands are missing. Please make sure they are installed and in your system PATH.\n'));
      }
    } catch (err: any) {
      console.error(chalk.red(`Doctor check failed: ${err.message}`));
      process.exit(1);
    }
  });

// 3. devdeck context
program
  .command('context')
  .description('Scan project workspace and refresh .devdeck/context.md')
  .action(() => {
    try {
      writeContextCache();
      const contextFilePath = path.join(getDevDeckDir(), 'context.md');
      console.log(chalk.green('✔ Project context updated!'));
      console.log(chalk.gray(`Context saved at: ${contextFilePath}`));
    } catch (err: any) {
      console.error(chalk.red(`Failed to build context: ${err.message}`));
      process.exit(1);
    }
  });

// 4. devdeck ask <agent> <prompt>
program
  .command('ask')
  .description('Delegate a task to a local subagent (codex, claude, gemini)')
  .argument('<agent>', 'Agent name (e.g. codex, claude, gemini)')
  .argument('<prompt>', 'Prompt or task description')
  .action(async (agent, prompt) => {
    try {
      // 1. Always refresh context before asking
      writeContextCache();
      
      // 2. Run the agent
      const result = await runAgent(agent, prompt);
      
      if (result.exitCode === 0) {
        console.log(chalk.green(`\n✔ Subagent ${agent} completed successfully.`));
        console.log(chalk.gray(`Log saved to: ${result.logPath}\n`));
      } else {
        console.log(chalk.red(`\n✗ Subagent ${agent} exited with code ${result.exitCode}`));
        process.exit(result.exitCode || 1);
      }
    } catch (err: any) {
      console.error(chalk.red(`\nExecution failed: ${err.message}`));
      process.exit(1);
    }
  });

// 5. devdeck last
program
  .command('last')
  .description('Print the markdown formatted output of the last agent execution')
  .action(() => {
    try {
      const last = getLastOutput();
      if (!last) {
        console.log(chalk.yellow('No execution logs found. Try running "devdeck ask" first.'));
        return;
      }
      
      console.log('\n' + chalk.bold('=== Last Subagent Output ===') + '\n');
      console.log(marked(last));
    } catch (err: any) {
      console.error(chalk.red(`Failed to read last output: ${err.message}`));
      process.exit(1);
    }
  });

// 6. devdeck mcp start
program
  .command('mcp')
  .description('Manage the DevDeck MCP Server')
  .command('start')
  .description('Start the DevDeck MCP server (stdio transport)')
  .action(async () => {
    try {
      await startMcpServer();
    } catch (err: any) {
      console.error(chalk.red(`MCP Server failed: ${err.message}`));
      process.exit(1);
    }
  });

program.parse(process.argv);
