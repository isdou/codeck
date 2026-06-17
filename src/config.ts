import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import * as toml from 'smol-toml';

export interface AgentConfig {
  command: string;
}

export interface ContextConfig {
  include_git_diff: boolean;
  include_readme: boolean;
  include_agent_files: boolean;
  max_files: number;
}

export interface Config {
  agents: Record<string, AgentConfig>;
  context: ContextConfig;
}

const DEFAULT_CONFIG: Config = {
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

export function getDevDeckDir(cwd: string = process.cwd()): string {
  return path.join(cwd, '.devdeck');
}

export function getConfigPath(cwd: string = process.cwd()): string {
  return path.join(getDevDeckDir(cwd), 'config.toml');
}

export function initDevDeck(cwd: string = process.cwd()): { created: boolean; configPath: string } {
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
    const content = toml.stringify(DEFAULT_CONFIG as any);
    fs.writeFileSync(configPath, content, 'utf8');
    return { created: true, configPath };
  }

  return { created: false, configPath };
}

export function loadConfig(cwd: string = process.cwd()): Config {
  const configPath = getConfigPath(cwd);
  if (!fs.existsSync(configPath)) {
    throw new Error('DevDeck is not initialized in this directory. Run "devdeck init" first.');
  }

  const content = fs.readFileSync(configPath, 'utf8');
  try {
    const parsed = toml.parse(content) as unknown as Config;
    // Ensure nested fields exist
    return {
      agents: parsed.agents || {},
      context: {
        ...DEFAULT_CONFIG.context,
        ...(parsed.context || {})
      }
    };
  } catch (err: any) {
    throw new Error(`Failed to parse config.toml: ${err.message}`);
  }
}

export function checkCommandExists(command: string): boolean {
  // Extract binary name from command string (e.g. "claude code" -> "claude")
  const binary = command.trim().split(/\s+/)[0];
  if (!binary) return false;
  
  try {
    const isWindows = process.platform === 'win32';
    const checkCmd = isWindows ? `where ${binary}` : `which ${binary}`;
    execSync(checkCmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export interface DoctorResult {
  agentName: string;
  command: string;
  exists: boolean;
}

export function runDoctor(cwd: string = process.cwd()): { configExists: boolean; agents: DoctorResult[] } {
  const configPath = getConfigPath(cwd);
  if (!fs.existsSync(configPath)) {
    return { configExists: false, agents: [] };
  }

  const config = loadConfig(cwd);
  const agentsResult: DoctorResult[] = [];
  
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
