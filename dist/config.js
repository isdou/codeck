import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import * as toml from 'smol-toml';
const DEFAULT_CONFIG = {
    agents: {
        codex: { command: 'codex' },
        claude: { command: 'claude' },
        gemini: { command: 'gemini' }
    },
    context: {
        include_git_diff: true,
        include_readme: true,
        include_agent_files: true,
        max_files: 12
    }
};
export function getDevDeckDir(cwd = process.cwd()) {
    return path.join(cwd, '.devdeck');
}
export function getConfigPath(cwd = process.cwd()) {
    return path.join(getDevDeckDir(cwd), 'config.toml');
}
export function initDevDeck(cwd = process.cwd()) {
    const dir = getDevDeckDir(cwd);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const runsDir = path.join(dir, 'runs');
    if (!fs.existsSync(runsDir)) {
        fs.mkdirSync(runsDir, { recursive: true });
    }
    const configPath = getConfigPath(cwd);
    if (!fs.existsSync(configPath)) {
        const content = toml.stringify(DEFAULT_CONFIG);
        fs.writeFileSync(configPath, content, 'utf8');
        return { created: true, configPath };
    }
    return { created: false, configPath };
}
export function loadConfig(cwd = process.cwd()) {
    const configPath = getConfigPath(cwd);
    if (!fs.existsSync(configPath)) {
        throw new Error('DevDeck is not initialized in this directory. Run "devdeck init" first.');
    }
    const content = fs.readFileSync(configPath, 'utf8');
    try {
        const parsed = toml.parse(content);
        // Ensure nested fields exist
        return {
            agents: parsed.agents || {},
            context: {
                ...DEFAULT_CONFIG.context,
                ...(parsed.context || {})
            }
        };
    }
    catch (err) {
        throw new Error(`Failed to parse config.toml: ${err.message}`);
    }
}
export function checkCommandExists(command) {
    // Extract binary name from command string (e.g. "claude code" -> "claude")
    const binary = command.trim().split(/\s+/)[0];
    if (!binary)
        return false;
    try {
        const isWindows = process.platform === 'win32';
        const checkCmd = isWindows ? `where ${binary}` : `which ${binary}`;
        execSync(checkCmd, { stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
}
export function runDoctor(cwd = process.cwd()) {
    const configPath = getConfigPath(cwd);
    if (!fs.existsSync(configPath)) {
        return { configExists: false, agents: [] };
    }
    const config = loadConfig(cwd);
    const agentsResult = [];
    for (const [name, agent] of Object.entries(config.agents)) {
        const exists = checkCommandExists(agent.command);
        agentsResult.push({
            agentName: name,
            command: agent.command,
            exists
        });
    }
    return {
        configExists: true,
        agents: agentsResult
    };
}
