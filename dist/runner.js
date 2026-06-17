import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { loadConfig, getDevDeckDir } from './config.js';
import { buildContext } from './context.js';
export function getLatestLogPath(cwd = process.cwd()) {
    const runsDir = path.join(getDevDeckDir(cwd), 'runs');
    if (!fs.existsSync(runsDir))
        return null;
    const files = fs.readdirSync(runsDir);
    const logFiles = files.filter(f => f.endsWith('.md')).sort();
    if (logFiles.length === 0)
        return null;
    return path.join(runsDir, logFiles[logFiles.length - 1]);
}
export function getLastOutput(cwd = process.cwd()) {
    const lastPath = path.join(getDevDeckDir(cwd), 'last.md');
    if (fs.existsSync(lastPath)) {
        return fs.readFileSync(lastPath, 'utf8');
    }
    return '';
}
/**
 * Clean and combine prompt with context and last run outputs.
 */
export function buildCombinedPrompt(agentName, userPrompt, cwd) {
    const ctx = buildContext(cwd);
    const lastOutput = getLastOutput(cwd);
    const lines = [];
    lines.push(`=== DESTRUCTURING TASK FOR SUBAGENT: ${agentName.toUpperCase()} ===`);
    lines.push(`Task: ${userPrompt}`);
    lines.push(``);
    lines.push(`=== PROJECT CONTEXT ===`);
    lines.push(`Branch: ${ctx.branch}`);
    lines.push(`Recent Commit: ${ctx.recentCommit}`);
    if (ctx.gitStatus) {
        lines.push(`\nGit Status:\n${ctx.gitStatus}`);
    }
    if (ctx.agentNotes) {
        lines.push(`\nAgent Notes:\n${ctx.agentNotes}`);
    }
    if (lastOutput) {
        lines.push(``);
        lines.push(`=== PREVIOUS AGENT OUTPUT ===`);
        lines.push(lastOutput.trim());
    }
    if (ctx.gitDiff) {
        // Truncate git diff if extremely long
        const diffLines = ctx.gitDiff.split('\n');
        let truncatedDiff = ctx.gitDiff;
        if (diffLines.length > 200) {
            truncatedDiff = diffLines.slice(0, 200).join('\n') + `\n... [Diff truncated, total lines: ${diffLines.length}]`;
        }
        lines.push(``);
        lines.push(`=== GIT DIFF ===\n${truncatedDiff}`);
    }
    lines.push(``);
    lines.push(`=== INSTRUCTION ===`);
    lines.push(`Please review the context and address the task: "${userPrompt}".`);
    lines.push(`Do not output markdown codeblock ticks surrounding your final response if you are returning raw code, but do output standard markdown for reports.`);
    return lines.join('\n');
}
/**
 * Execute an agent command safely.
 */
export function runAgent(agentName, userPrompt, options = {}, cwd = process.cwd()) {
    return new Promise((resolve, reject) => {
        const config = loadConfig(cwd);
        const agent = config.agents[agentName];
        if (!agent) {
            return reject(new Error(`Agent "${agentName}" is not configured in config.toml.`));
        }
        const combinedPrompt = buildCombinedPrompt(agentName, userPrompt, cwd);
        // Parse command safely to avoid shell injection
        const commandParts = agent.command.trim().split(/\s+/);
        const binary = commandParts[0];
        const baseArgs = commandParts.slice(1);
        if (!binary) {
            return reject(new Error(`Command for agent "${agentName}" is empty.`));
        }
        // Append the combined prompt as the last argument
        const args = [...baseArgs, combinedPrompt];
        let output = '';
        let error = '';
        if (!options.silent) {
            console.log(`\n[DevDeck] Starting subagent: ${agentName} (${binary} ${baseArgs.join(' ')}) ...\n`);
        }
        const child = spawn(binary, args, {
            cwd,
            shell: false, // Prevents shell injection
            env: { ...process.env, FORCE_COLOR: '1' } // Force color output if supported
        });
        child.stdout.on('data', (data) => {
            const chunk = data.toString();
            output += chunk;
            if (!options.silent) {
                process.stdout.write(chunk);
            }
        });
        child.stderr.on('data', (data) => {
            const chunk = data.toString();
            error += chunk;
            if (!options.silent) {
                process.stderr.write(chunk);
            }
        });
        child.on('error', (err) => {
            reject(new Error(`Failed to start agent command "${binary}": ${err.message}`));
        });
        child.on('close', (code) => {
            // 1. Ensure directories exist
            const devDeckDir = getDevDeckDir(cwd);
            const runsDir = path.join(devDeckDir, 'runs');
            if (!fs.existsSync(runsDir)) {
                fs.mkdirSync(runsDir, { recursive: true });
            }
            // 2. Write log file
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const logFilename = `${timestamp}-${agentName}.md`;
            const logPath = path.join(runsDir, logFilename);
            const logContent = `# DevDeck Run Log
- Date: ${new Date().toLocaleString()}
- Agent: \`${agentName}\`
- Command: \`${agent.command}\`
- Exit Code: ${code}

## Prompt
\`\`\`text
${userPrompt}
\`\`\`

## Output
${output}

${error ? `## Errors\n\`\`\`text\n${error}\n\`\`\`` : ''}
`;
            fs.writeFileSync(logPath, logContent, 'utf8');
            // 3. Update last.md with only the clean output
            const lastPath = path.join(devDeckDir, 'last.md');
            fs.writeFileSync(lastPath, output, 'utf8');
            resolve({
                agentName,
                command: agent.command,
                prompt: userPrompt,
                output,
                error,
                exitCode: code,
                logPath
            });
        });
    });
}
