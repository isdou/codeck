import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { loadConfig, getDevDeckDir } from './config.js';

export interface ProjectContext {
  timestamp: string;
  branch: string;
  recentCommit: string;
  gitStatus: string;
  gitDiff: string;
  readme: string;
  agentNotes: string;
}

function runGitCommand(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

export function buildContext(cwd: string = process.cwd()): ProjectContext {
  const config = loadConfig(cwd);
  const contextConfig = config.context;

  // 1. Get Git info
  const isGitRepo = fs.existsSync(path.join(cwd, '.git'));
  let branch = 'Not a git repository';
  let recentCommit = 'No commits';
  let gitStatus = '';
  let gitDiff = '';

  if (isGitRepo) {
    branch = runGitCommand('git rev-parse --abbrev-ref HEAD', cwd) || 'unknown';
    recentCommit = runGitCommand('git log -1 --oneline', cwd) || 'no commits';
    
    if (contextConfig.include_git_diff) {
      gitStatus = runGitCommand('git status --short', cwd);
      gitDiff = runGitCommand('git diff HEAD', cwd);
      
      // If gitDiff is empty, try comparing with default branch or just unstaged changes
      if (!gitDiff) {
        gitDiff = runGitCommand('git diff', cwd);
      }
    }
  }

  // 2. Read README
  let readme = '';
  if (contextConfig.include_readme) {
    const readmeFiles = ['README.md', 'readme.md', 'README', 'Readme.md'];
    for (const file of readmeFiles) {
      const filePath = path.join(cwd, file);
      if (fs.existsSync(filePath)) {
        readme = fs.readFileSync(filePath, 'utf8');
        break;
      }
    }
  }

  // 3. Read Agent notes (e.g. AGENTS.md, CLAUDE.md, GEMINI.md, etc.)
  let agentNotes = '';
  if (contextConfig.include_agent_files) {
    const files = fs.readdirSync(cwd);
    const agentFiles = files.filter(f => {
      const upper = f.toUpperCase();
      return (upper.endsWith('.MD') && 
             (upper.includes('AGENT') || upper.includes('CLAUDE') || upper.includes('GEMINI') || upper.includes('DEVDECK')));
    });

    const notesParts: string[] = [];
    // Read up to max_files to prevent bloating
    agentFiles.slice(0, contextConfig.max_files).forEach(file => {
      const filePath = path.join(cwd, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile() && stat.size < 50000) { // Limit file size to 50KB to prevent bloat
          const content = fs.readFileSync(filePath, 'utf8');
          notesParts.push(`### File: ${file}\n\n${content}`);
        }
      } catch {
        // Ignore errors reading file
      }
    });
    agentNotes = notesParts.join('\n\n');
  }

  return {
    timestamp: new Date().toISOString(),
    branch,
    recentCommit,
    gitStatus,
    gitDiff,
    readme,
    agentNotes
  };
}

export function formatContextToMarkdown(ctx: ProjectContext): string {
  const parts: string[] = [];

  parts.push(`# DevDeck Project Context`);
  parts.push(`Generated: ${ctx.timestamp}`);
  parts.push(`Branch: \`${ctx.branch}\``);
  parts.push(`Recent Commit: \`${ctx.recentCommit}\``);

  if (ctx.gitStatus) {
    parts.push(`\n## Git Status\n\`\`\`\n${ctx.gitStatus}\n\`\`\``);
  }

  if (ctx.readme) {
    parts.push(`\n## README\n\n${ctx.readme}`);
  }

  if (ctx.agentNotes) {
    parts.push(`\n## Agent Instruction Files\n\n${ctx.agentNotes}`);
  }

  if (ctx.gitDiff) {
    // Truncate git diff if it is too long (e.g. > 300 lines) to keep LLM context readable
    const lines = ctx.gitDiff.split('\n');
    let formattedDiff = ctx.gitDiff;
    if (lines.length > 300) {
      formattedDiff = lines.slice(0, 300).join('\n') + `\n\n... [Diff truncated, total lines: ${lines.length}]`;
    }
    parts.push(`\n## Git Diff\n\`\`\`diff\n${formattedDiff}\n\`\`\``);
  }

  return parts.join('\n');
}

export function writeContextCache(cwd: string = process.cwd()): string {
  const ctx = buildContext(cwd);
  const md = formatContextToMarkdown(ctx);
  const devDeckDir = getDevDeckDir(cwd);
  
  if (!fs.existsSync(devDeckDir)) {
    fs.mkdirSync(devDeckDir, { recursive: true });
  }

  const contextPath = path.join(devDeckDir, 'context.md');
  fs.writeFileSync(contextPath, md, 'utf8');
  return md;
}
