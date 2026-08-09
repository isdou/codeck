import fs from 'fs';
import path from 'path';
import * as toml from 'smol-toml';
import { getAdapter } from './adapters.js';
const DEFAULT_AGENTS = {
    codex: { command: 'codex', adapter: 'codex', timeout_ms: 180000 },
    claude: { command: 'claude', adapter: 'claude', timeout_ms: 180000 },
    gemini: { command: 'gemini', adapter: 'gemini', timeout_ms: 90000 },
    kimi: { command: 'kimi', adapter: 'kimi', timeout_ms: 180000 },
    grok: { command: 'grok', adapter: 'grok', timeout_ms: 180000 },
    antigravity: {
        command: 'agy',
        adapter: 'antigravity',
        timeout_ms: 180000,
        model: 'gemini-3.6-flash-high',
    },
    mock: { command: 'mock', adapter: 'mock' },
    gemini_api: { command: 'api', adapter: 'gemini_api', timeout_ms: 90000 },
    gemini_image: { command: 'api', adapter: 'gemini_image', timeout_ms: 180000, model: 'gemini-3.1-flash-image' },
    claude_api: { command: 'api', adapter: 'claude_api', timeout_ms: 180000 },
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
        // Keep the historical executor name so existing project configs continue
        // to resolve, but use Antigravity as the maintained Google CLI path.
        agent: 'antigravity',
        role: 'frontend_builder',
        description: 'Frontend, screenshots, UI diff, and long-context design analysis through Antigravity CLI.',
        allowed_modes: ['ask', 'delegate', 'compare'],
        read_files: true,
        write_files: false,
        run_shell: false,
        context_include: ['screenshots/**', 'design/**', 'src/**', 'current_diff'],
    },
    kimi: {
        agent: 'kimi',
        role: 'code_analyst',
        description: 'Kimi Code CLI for repository exploration and long-context analysis.',
        allowed_modes: ['ask', 'subagent', 'compare'],
        read_files: true,
        write_files: false,
        run_shell: false,
        context_include: ['README.md', 'docs/**', 'src/**', 'current_diff'],
    },
    grok: {
        agent: 'grok',
        role: 'code_reviewer',
        description: 'Grok Build CLI in a read-only sandbox for code review and analysis.',
        allowed_modes: ['ask', 'subagent', 'compare'],
        read_files: true,
        write_files: false,
        run_shell: false,
        context_include: ['README.md', 'docs/**', 'src/**', 'current_diff'],
    },
    gemini_image: {
        agent: 'gemini_image',
        role: 'image_generator',
        description: 'Generate images through the Gemini API and save returned inline image data.',
        allowed_modes: ['ask', 'subagent', 'delegate', 'compare'],
        read_files: true,
        write_files: false,
        run_shell: false,
        context_include: ['README.md', 'src/**', 'current_diff'],
    },
    antigravity: {
        agent: 'antigravity',
        role: 'antigravity',
        description: 'Google Antigravity CLI executor for read-only analysis.',
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
            '.codeck/archive/**',
            '.codeck/archive.sqlite3*',
            '.codeck/archive.json',
        ],
    },
    budget: {
        max_context_chars: 60000,
        mcp_max_context_chars: 60000,
        ask_context_chars: 16000,
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
    archive: {
        enabled: true,
        redact: true,
        async_threshold_ms: 45000,
        progress_interval_ms: 5000,
        max_inline_chars: 120000,
        redaction_patterns: [],
    },
    routing: {
        default_executor: 'antigravity',
        rules: [
            {
                name: 'kimi',
                executor: 'kimi',
                keywords: ['kimi', 'moonshot', '月之暗面'],
            },
            {
                name: 'grok',
                executor: 'grok',
                keywords: ['grok', 'xai', 'x.ai'],
            },
            {
                name: 'antigravity',
                executor: 'antigravity',
                keywords: ['antigravity', 'agy'],
            },
            {
                name: 'image',
                executor: 'gemini_image',
                keywords: ['image generation', 'generate image', 'draw image', 'gemini image', 'turnaround sheet', '生图', '生成图片', '画图', '三视图'],
            },
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
    const agents = {};
    for (const [name, agent] of Object.entries({ ...DEFAULT_AGENTS, ...(parsed.agents || {}) })) {
        agents[name] = {
            ...(DEFAULT_AGENTS[name] || {}),
            ...agent,
            adapter: agent.adapter || DEFAULT_AGENTS[name]?.adapter || name,
        };
    }
    const executors = {};
    for (const [name, profile] of Object.entries(DEFAULT_EXECUTORS)) {
        executors[name] = mergeExecutor(name, (parsed.executors || {})[name], profile.agent);
    }
    for (const [name, agent] of Object.entries(agents)) {
        if (!executors[name]) {
            executors[name] = mergeExecutor(name, (parsed.executors || {})[name], name);
        }
    }
    for (const [name, profile] of Object.entries(parsed.executors || {})) {
        executors[name] = mergeExecutor(name, profile, profile.agent || name);
    }
    const rawArchive = { ...DEFAULT_CONFIG.archive, ...(parsed.archive || {}) };
    const archive = {
        enabled: rawArchive.enabled !== false,
        redact: rawArchive.redact !== false,
        // Keep MCP's first response below the SDK's default 60-second request
        // timeout. A later wait_run call can still wait in another 45-second slice.
        async_threshold_ms: Math.min(45000, Math.max(1000, Number(rawArchive.async_threshold_ms) || DEFAULT_CONFIG.archive.async_threshold_ms)),
        progress_interval_ms: Math.min(30000, Math.max(250, Number(rawArchive.progress_interval_ms) || DEFAULT_CONFIG.archive.progress_interval_ms)),
        max_inline_chars: Math.max(1000, Number(rawArchive.max_inline_chars) || DEFAULT_CONFIG.archive.max_inline_chars),
        redaction_patterns: Array.isArray(rawArchive.redaction_patterns)
            ? rawArchive.redaction_patterns.filter((pattern) => typeof pattern === 'string')
            : [],
    };
    return {
        agents,
        executors,
        context: { ...DEFAULT_CONFIG.context, ...(parsed.context || {}) },
        budget: { ...DEFAULT_CONFIG.budget, ...(parsed.budget || {}) },
        handoff: { ...DEFAULT_CONFIG.handoff, ...(parsed.handoff || {}) },
        compare: { ...DEFAULT_CONFIG.compare, ...(parsed.compare || {}) },
        archive,
        routing: { ...DEFAULT_CONFIG.routing, ...(parsed.routing || {}) },
    };
}
export function initCodeck(cwd = process.cwd()) {
    const dir = getCodeckDir(cwd);
    fs.mkdirSync(path.join(dir, 'runs'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'archive'), { recursive: true });
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
function loadDotenv(cwd = process.cwd()) {
    const paths = [
        path.join(cwd, '.env'),
        path.join(cwd, '.codeck', '.env'),
    ];
    for (const envPath of paths) {
        if (fs.existsSync(envPath)) {
            try {
                const content = fs.readFileSync(envPath, 'utf8');
                for (const line of content.split(/\r?\n/)) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('#'))
                        continue;
                    const eqIdx = trimmed.indexOf('=');
                    if (eqIdx > 0) {
                        const key = trimmed.slice(0, eqIdx).trim();
                        let val = trimmed.slice(eqIdx + 1).trim();
                        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                            val = val.slice(1, -1);
                        }
                        if (!(key in process.env)) {
                            process.env[key] = val;
                        }
                    }
                }
            }
            catch {
                // ignore errors reading env file
            }
        }
    }
}
export function loadConfig(cwd = process.cwd()) {
    loadDotenv(cwd);
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
