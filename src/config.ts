import fs from 'fs';
import path from 'path';
import * as toml from 'smol-toml';
import { getAdapter } from './adapters.js';
import type { AgentConfig, Config, ExecutorProfile } from './models.js';

const DEFAULT_AGENTS: Record<string, AgentConfig> = {
  codex: { command: 'codex', adapter: 'codex' },
  claude: { command: 'claude', adapter: 'claude' },
  gemini: { command: 'gemini', adapter: 'gemini' },
  mock: { command: 'mock', adapter: 'mock' },
};

const DEFAULT_EXECUTORS: Record<string, ExecutorProfile> = {
  claude_architect: {
    agent: 'claude',
    role: 'architect',
    description: 'Architecture design, code understanding, and risk review.',
    allowed_modes: ['ask', 'subagent', 'delegate', 'compare'],
    read_files: true,
    write_files: false,
    run_shell: false,
    context_include: ['README.md', 'docs/**', 'src/**', 'current_diff'],
  },
  gemini_frontend: {
    agent: 'gemini',
    role: 'frontend_builder',
    description: 'Frontend, screenshots, UI diff, and long-context design analysis.',
    allowed_modes: ['ask', 'delegate', 'compare'],
    read_files: true,
    write_files: false,
    run_shell: false,
    context_include: ['screenshots/**', 'design/**', 'src/**', 'current_diff'],
  },
  codex_implementer: {
    agent: 'codex',
    role: 'implementer',
    description: 'Implement handoff, run tests, and produce patches.',
    allowed_modes: ['subagent', 'delegate'],
    read_files: true,
    write_files: true,
    run_shell: true,
    context_include: ['README.md', 'src/**', 'current_diff'],
  },
  mock: {
    agent: 'mock',
    role: 'mock',
    description: 'Deterministic local executor for DevDeck checks.',
    allowed_modes: ['ask', 'subagent', 'delegate', 'compare'],
    read_files: true,
    write_files: false,
    run_shell: false,
    context_include: ['README.md', 'src/**', 'current_diff'],
  },
};

const DEFAULT_CONFIG: Config = {
  agents: DEFAULT_AGENTS,
  executors: DEFAULT_EXECUTORS,
  context: {
    include_git_diff: true,
    include_readme: true,
    include_agent_files: true,
    max_files: 12,
    max_file_bytes: 50000,
    exclude: [
      '.git/**',
      'node_modules/**',
      'dist/**',
      '.devdeck/context.md',
      '.devdeck/last.md',
      '.devdeck/runs/**',
    ],
  },
  budget: {
    max_context_chars: 60000,
    mcp_max_context_chars: 60000,
  },
  handoff: {
    default_mode: 'raw',
    smart_enabled: true,
    handoff_executor: 'codex_implementer',
  },
  compare: {
    default_execution: 'sequential',
    allow_parallel: false,
  },
};

export function getDevDeckDir(cwd: string = process.cwd()): string {
  return path.join(cwd, '.devdeck');
}

export function getConfigPath(cwd: string = process.cwd()): string {
  return path.join(getDevDeckDir(cwd), 'config.toml');
}

function mergeExecutor(name: string, raw: Partial<ExecutorProfile> | undefined, fallbackAgent: string): ExecutorProfile {
  const base = DEFAULT_EXECUTORS[name] || {
    agent: fallbackAgent,
    role: name,
    description: `${name} executor`,
    allowed_modes: ['ask', 'subagent', 'delegate', 'compare'],
    read_files: true,
    write_files: false,
    run_shell: false,
    context_include: ['README.md', 'src/**', 'current_diff'],
  };

  return {
    ...base,
    ...(raw || {}),
    allowed_modes: (raw?.allowed_modes || base.allowed_modes) as ExecutorProfile['allowed_modes'],
    context_include: raw?.context_include || base.context_include,
  };
}

function normalizeConfig(parsed: Partial<Config>): Config {
  const agents = { ...DEFAULT_AGENTS, ...(parsed.agents || {}) };
  const executors: Record<string, ExecutorProfile> = {};

  for (const [name, profile] of Object.entries(DEFAULT_EXECUTORS)) {
    executors[name] = mergeExecutor(name, (parsed.executors || {})[name], profile.agent);
  }

  for (const [name, agent] of Object.entries(agents)) {
    if (!executors[name]) {
      executors[name] = mergeExecutor(name, (parsed.executors || {})[name], name);
    }
    agents[name] = {
      ...agent,
      adapter: agent.adapter || name,
    };
  }

  for (const [name, profile] of Object.entries(parsed.executors || {})) {
    executors[name] = mergeExecutor(name, profile, profile.agent || name);
  }

  return {
    agents,
    executors,
    context: { ...DEFAULT_CONFIG.context, ...(parsed.context || {}) },
    budget: { ...DEFAULT_CONFIG.budget, ...(parsed.budget || {}) },
    handoff: { ...DEFAULT_CONFIG.handoff, ...(parsed.handoff || {}) },
    compare: { ...DEFAULT_CONFIG.compare, ...(parsed.compare || {}) },
  };
}

export function initDevDeck(cwd: string = process.cwd()): { created: boolean; configPath: string } {
  const dir = getDevDeckDir(cwd);
  fs.mkdirSync(path.join(dir, 'runs'), { recursive: true });

  const configPath = getConfigPath(cwd);
  let created = false;
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, toml.stringify(DEFAULT_CONFIG as any), 'utf8');
    created = true;
  }

  const projectPath = path.join(dir, 'project.md');
  if (!fs.existsSync(projectPath)) {
    fs.writeFileSync(projectPath, `# Project Overview
Describe your project's technology stack, architecture, modules, and folder structure here.
This file is automatically generated by DevDeck. Edit it to help executors understand your project.
`, 'utf8');
  }

  const constraintsPath = path.join(dir, 'constraints.md');
  if (!fs.existsSync(constraintsPath)) {
    fs.writeFileSync(constraintsPath, `# Project Constraints & Rules
- Tech constraints
- Design preferences
- Code style
- Things to avoid
This file is automatically generated by DevDeck. Edit it to tell executors what they MUST NOT do.
`, 'utf8');
  }

  return { created, configPath };
}

export function loadConfig(cwd: string = process.cwd()): Config {
  const configPath = getConfigPath(cwd);
  if (!fs.existsSync(configPath)) {
    throw new Error('DevDeck is not initialized in this directory. Run "devdeck init" first.');
  }

  try {
    return normalizeConfig(toml.parse(fs.readFileSync(configPath, 'utf8')) as Partial<Config>);
  } catch (err: any) {
    throw new Error(`Failed to parse config.toml: ${err.message}`);
  }
}

export interface DoctorResult {
  agentName: string;
  command: string;
  adapter: string;
  exists: boolean;
  message: string;
}

export function runDoctor(cwd: string = process.cwd()): { configExists: boolean; agents: DoctorResult[]; executors: string[] } {
  const configPath = getConfigPath(cwd);
  if (!fs.existsSync(configPath)) {
    return { configExists: false, agents: [], executors: [] };
  }

  const config = loadConfig(cwd);
  return {
    configExists: true,
    agents: Object.entries(config.agents).map(([agentName, agent]) => {
      const adapter = getAdapter(agent.adapter);
      const probe = adapter.probe(agent);
      return {
        agentName,
        command: agent.command,
        adapter: adapter.name,
        exists: probe.ok,
        message: probe.message,
      };
    }),
    executors: Object.keys(config.executors),
  };
}

export { DEFAULT_CONFIG };
