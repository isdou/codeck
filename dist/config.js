import fs from 'fs';
import path from 'path';
import * as toml from 'smol-toml';
import { getAdapter } from './adapters.js';
const DEFAULT_AGENTS = {
    codex: { command: 'codex', adapter: 'codex' },
    claude: { command: 'claude', adapter: 'claude' },
    gemini: { command: 'gemini', adapter: 'gemini' },
    gemini_web: { command: 'open', adapter: 'gemini_web' },
    mock: { command: 'mock', adapter: 'mock' },
};
const DEFAULT_EXECUTORS = {
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
    gemini_web: {
        agent: 'gemini_web',
        role: 'web_executor',
        description: 'Open Gemini Web with the routed prompt copied to clipboard.',
        allowed_modes: ['ask', 'subagent', 'delegate', 'compare'],
        read_files: true,
        write_files: false,
        run_shell: false,
        context_include: ['README.md', 'src/**', 'current_diff'],
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
        description: 'Deterministic local executor for Codeck checks.',
        allowed_modes: ['ask', 'subagent', 'delegate', 'compare'],
        read_files: true,
        write_files: false,
        run_shell: false,
        context_include: ['README.md', 'src/**', 'current_diff'],
    },
};
const DEFAULT_CONFIG = {
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
            '.codeck/context.md',
            '.codeck/last.md',
            '.codeck/runs/**',
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
    routing: {
        default_executor: 'gemini',
        rules: [
            {
                name: 'frontend',
                executor: 'gemini_frontend',
                keywords: ['frontend', 'ui', 'css', 'react', 'vue', '页面', '界面', '样式', '截图'],
            },
            {
                name: 'architecture',
                executor: 'claude_architect',
                keywords: ['architecture', 'architect', 'review', 'risk', '架构', '评审', '风险', '重构'],
            },
            {
                name: 'implementation',
                executor: 'codex_implementer',
                keywords: ['implement', 'fix', 'test', 'build', '实现', '修复', '测试', '构建'],
            },
        ],
    },
};
export function getCodeckDir(cwd = process.cwd()) {
    return path.join(cwd, '.codeck');
}
export function getConfigPath(cwd = process.cwd()) {
    return path.join(getCodeckDir(cwd), 'config.toml');
}
function mergeExecutor(name, raw, fallbackAgent) {
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
        allowed_modes: (raw?.allowed_modes || base.allowed_modes),
        context_include: raw?.context_include || base.context_include,
    };
}
function normalizeConfig(parsed) {
    const agents = { ...DEFAULT_AGENTS, ...(parsed.agents || {}) };
    const executors = {};
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
        routing: { ...DEFAULT_CONFIG.routing, ...(parsed.routing || {}) },
    };
}
export function initCodeck(cwd = process.cwd()) {
    const dir = getCodeckDir(cwd);
    fs.mkdirSync(path.join(dir, 'runs'), { recursive: true });
    const configPath = getConfigPath(cwd);
    let created = false;
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, toml.stringify(DEFAULT_CONFIG), 'utf8');
        created = true;
    }
    const projectPath = path.join(dir, 'project.md');
    if (!fs.existsSync(projectPath)) {
        fs.writeFileSync(projectPath, `# Project Overview
Describe your project's technology stack, architecture, modules, and folder structure here.
This file is automatically generated by Codeck. Edit it to help executors understand your project.
`, 'utf8');
    }
    const constraintsPath = path.join(dir, 'constraints.md');
    if (!fs.existsSync(constraintsPath)) {
        fs.writeFileSync(constraintsPath, `# Project Constraints & Rules
- Tech constraints
- Design preferences
- Code style
- Things to avoid
This file is automatically generated by Codeck. Edit it to tell executors what they MUST NOT do.
`, 'utf8');
    }
    return { created, configPath };
}
export function loadConfig(cwd = process.cwd()) {
    const configPath = getConfigPath(cwd);
    if (!fs.existsSync(configPath)) {
        throw new Error('Codeck is not initialized in this directory. Run "codeck init" first.');
    }
    try {
        return normalizeConfig(toml.parse(fs.readFileSync(configPath, 'utf8')));
    }
    catch (err) {
        throw new Error(`Failed to parse config.toml: ${err.message}`);
    }
}
export function runDoctor(cwd = process.cwd()) {
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
