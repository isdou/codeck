import fs from 'fs';
import path from 'path';
import { getAdapter, formatRunMarkdown, prepareAdapterRequest } from './adapters.js';
import { archiveRun, curateArchivedRun, deleteArchivedRun, exportArchive, getArchivedRun, importLegacyRuns, listArchivedRuns, redactRunForStorage, } from './archive.js';
import { getCodeckDir, loadConfig } from './config.js';
import { buildContext } from './context.js';
export class CodeckError extends Error {
    code;
    details;
    constructor(code, message, details = {}) {
        super(message);
        this.code = code;
        this.details = details;
    }
}
function runId() {
    return new Date().toISOString().replace(/[:.]/g, '-') + '-' + Math.random().toString(36).slice(2, 8);
}
function runsDir(cwd) {
    return path.join(getCodeckDir(cwd), 'runs');
}
function legacyRunPath(cwd, id, extension) {
    if (!id || path.basename(id) !== id)
        return null;
    const root = path.resolve(runsDir(cwd));
    const filePath = path.resolve(root, `${id}.${extension}`);
    return filePath.startsWith(`${root}${path.sep}`) ? filePath : null;
}
function latestRunJson(cwd) {
    const dir = runsDir(cwd);
    if (!fs.existsSync(dir))
        return null;
    const files = fs.readdirSync(dir)
        .filter((file) => file.endsWith('.json'))
        .map((file) => path.join(dir, file))
        .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
    return files[files.length - 1] || null;
}
function terminalStatus(run) {
    if (run.status)
        return run.status;
    if (run.exitCode === null || run.exitCode === undefined)
        return 'running';
    if (run.exitCode === 0)
        return 'succeeded';
    if (run.exitCode === 124)
        return 'timeout';
    return 'failed';
}
function legacyRun(run) {
    const copy = JSON.parse(JSON.stringify(run));
    // Keep the pre-archive run format useful without adding a second unredacted
    // copy of the full prompt/context to the legacy JSON/Markdown files.
    delete copy.prompt;
    delete copy.invocationPrompt;
    delete copy.contextSnapshot;
    delete copy.partialOutput;
    delete copy.stderr;
    delete copy.payloadRefs;
    return copy;
}
function saveRun(cwd, run, config) {
    fs.mkdirSync(runsDir(cwd), { recursive: true });
    const jsonPath = path.join(runsDir(cwd), `${run.id}.json`);
    const logPath = path.join(runsDir(cwd), `${run.id}.md`);
    const fullRun = { ...run, jsonPath, logPath };
    const persisted = config ? redactRunForStorage(fullRun, config.archive) : fullRun;
    const persistedLegacy = legacyRun(persisted);
    fs.writeFileSync(jsonPath, JSON.stringify(persistedLegacy, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.writeFileSync(logPath, formatRunMarkdown(persistedLegacy), { encoding: 'utf8', mode: 0o600 });
    fs.writeFileSync(path.join(getCodeckDir(cwd), 'last.md'), persisted.output || persisted.partialOutput || '', { encoding: 'utf8', mode: 0o600 });
    if (config) {
        try {
            archiveRun(cwd, fullRun, config.archive);
        }
        catch (error) {
            // Archiving is best-effort and must never prevent the external model
            // from returning its result. The failure remains visible in stderr.
            console.error(`[Codeck archive] ${error?.message || error}`);
        }
    }
    return fullRun;
}
export function getRun(runIdValue, cwd = process.cwd()) {
    if (runIdValue) {
        const archived = getArchivedRun(cwd, runIdValue);
        if (archived)
            return archived;
    }
    const jsonPath = runIdValue ? legacyRunPath(cwd, runIdValue, 'json') : latestRunJson(cwd);
    if (!jsonPath || !fs.existsSync(jsonPath))
        return null;
    const record = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    return { ...record, status: terminalStatus(record) };
}
export function publicRun(run) {
    const copy = JSON.parse(JSON.stringify(run));
    delete copy.prompt;
    delete copy.invocationPrompt;
    delete copy.contextSnapshot;
    delete copy.stderr;
    delete copy.redactions;
    delete copy.payloadRefs;
    return copy;
}
function assertTask(task) {
    if (!task || !task.trim()) {
        throw new CodeckError('current_task_required', 'Codeck requires an explicit current task.');
    }
}
function matchesRule(rule, task) {
    const normalized = task.toLowerCase();
    return rule.keywords.some((keyword) => keyword && normalized.includes(keyword.toLowerCase()));
}
function canUseExecutor(config, executor, mode, caller) {
    const profile = config.executors[executor];
    if (!profile || !profile.allowed_modes.includes(mode))
        return false;
    return !(caller === 'mcp' && (profile.write_files || profile.run_shell));
}
export function resolveExecutor(config, task, mode, caller) {
    for (const rule of config.routing.rules) {
        if (matchesRule(rule, task) && canUseExecutor(config, rule.executor, mode, caller)) {
            return rule.executor;
        }
    }
    if (canUseExecutor(config, config.routing.default_executor, mode, caller)) {
        return config.routing.default_executor;
    }
    const fallback = Object.keys(config.executors).find((executor) => canUseExecutor(config, executor, mode, caller));
    if (fallback)
        return fallback;
    throw new CodeckError('executor_not_found', `No executor is available for mode "${mode}".`, {
        mode,
        caller,
    });
}
export function pickExecutor(task, mode = 'ask', cwd = process.cwd(), caller) {
    assertTask(task);
    return resolveExecutor(loadConfig(cwd), task, mode, caller);
}
function sumUsage(runs) {
    const usageRuns = runs.filter((run) => run.usage);
    if (!usageRuns.length)
        return undefined;
    return {
        promptTokens: usageRuns.reduce((sum, run) => sum + run.usage.promptTokens, 0),
        completionTokens: usageRuns.reduce((sum, run) => sum + run.usage.completionTokens, 0),
        totalTokens: usageRuns.reduce((sum, run) => sum + run.usage.totalTokens, 0),
        estimatedCostUsd: usageRuns.reduce((sum, run) => sum + run.usage.estimatedCostUsd, 0),
        estimated: usageRuns.some((run) => run.usage.estimated),
    };
}
const activeJobs = new Map();
const completedJobs = new Map();
function validateRoute(input, options) {
    const cwd = options.cwd || process.cwd();
    const config = loadConfig(cwd);
    assertTask(input.task);
    const executor = input.executor && input.executor !== 'auto'
        ? input.executor
        : resolveExecutor(config, input.task, input.mode, options.caller);
    const profile = config.executors[executor];
    if (!profile) {
        throw new CodeckError('executor_not_found', `Executor "${executor}" is not configured.`, {
            executors: Object.keys(config.executors),
        });
    }
    if (!profile.allowed_modes.includes(input.mode)) {
        throw new CodeckError('mode_not_allowed', `Executor "${executor}" does not allow mode "${input.mode}".`, {
            allowed_modes: profile.allowed_modes,
        });
    }
    if ((profile.write_files || profile.run_shell) && options.caller === 'mcp') {
        throw new CodeckError('permission_requires_cli_confirmation', 'MCP calls cannot auto-run writable or shell-enabled executors.');
    }
    const agent = config.agents[profile.agent];
    if (!agent) {
        throw new CodeckError('agent_not_found', `Agent "${profile.agent}" for executor "${executor}" is not configured.`);
    }
    const maxConfiguredContext = options.caller === 'mcp' ? config.budget.mcp_max_context_chars : config.budget.max_context_chars;
    const maxContext = input.mode === 'ask' && !input.files?.length && !options.allowOverBudget
        ? Math.min(config.budget.ask_context_chars, maxConfiguredContext)
        : maxConfiguredContext;
    const context = options.contextOverride || buildContext(cwd, { task: input.task, executor: profile, files: input.files, maxChars: maxContext });
    if (context.summary.chars > maxContext && !options.allowOverBudget && !options.contextOverride) {
        throw new CodeckError('budget_exceeded', 'Context exceeds configured budget.', {
            actual: context.summary.chars,
            max: maxContext,
            omitted: context.summary.omitted,
        });
    }
    const adapterInput = {
        agentName: profile.agent,
        agent,
        executorName: executor,
        profile,
        task: input.task,
        context,
        files: input.files,
        cwd,
    };
    const prepared = options.preparedOverride || prepareAdapterRequest(adapterInput);
    return { cwd, config, executor, profile, agent, context, maxContext, prepared };
}
async function executeRouteJob(initial, route, input, controller) {
    let output = initial.partialOutput || '';
    let stderr = initial.stderr || '';
    let lastPersistAt = 0;
    let progressTimer = null;
    const persistProgress = () => {
        progressTimer = null;
        const progressRun = {
            ...initial,
            status: 'running',
            output: '',
            partialOutput: output,
            stderr,
            error: stderr,
            updatedAt: new Date().toISOString(),
        };
        lastPersistAt = Date.now();
        saveRun(route.cwd, progressRun, route.config);
    };
    const onProgress = (progress) => {
        if (typeof progress.output === 'string')
            output = progress.output;
        if (typeof progress.error === 'string')
            stderr = progress.error;
        const elapsed = Date.now() - lastPersistAt;
        if (elapsed >= route.config.archive.progress_interval_ms) {
            persistProgress();
        }
        else if (!progressTimer) {
            progressTimer = setTimeout(persistProgress, Math.max(100, route.config.archive.progress_interval_ms - elapsed));
        }
    };
    try {
        const result = await getAdapter(route.agent.adapter).invoke({
            agentName: route.profile.agent,
            agent: route.agent,
            executorName: route.executor,
            profile: route.profile,
            task: input.task,
            context: route.context,
            files: input.files,
            cwd: route.cwd,
            signal: controller.signal,
            onProgress,
            prepared: route.prepared,
        });
        if (progressTimer)
            clearTimeout(progressTimer);
        output = result.output || output;
        stderr = result.stderr || result.error || stderr;
        const status = controller.signal.aborted
            ? 'cancelled'
            : result.exitCode === 0
                ? 'succeeded'
                : result.exitCode === 124
                    ? 'timeout'
                    : 'failed';
        const finished = {
            ...initial,
            status,
            output,
            partialOutput: '',
            error: result.error,
            stderr,
            exitCode: controller.signal.aborted ? 130 : result.exitCode,
            usage: result.usage,
            prompt: result.prompt || initial.prompt,
            invocationPrompt: result.invocationPrompt || initial.invocationPrompt,
            contextSnapshot: result.contextSnapshot || initial.contextSnapshot,
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        return saveRun(route.cwd, finished, route.config);
    }
    catch (error) {
        if (progressTimer)
            clearTimeout(progressTimer);
        const failed = {
            ...initial,
            status: controller.signal.aborted ? 'cancelled' : 'failed',
            output,
            partialOutput: '',
            error: error?.message || String(error),
            stderr,
            exitCode: controller.signal.aborted ? 130 : 1,
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        return saveRun(route.cwd, failed, route.config);
    }
}
export async function startRouteTask(input, options = {}) {
    const route = validateRoute(input, options);
    const controller = new AbortController();
    const timestamp = new Date().toISOString();
    const id = runId();
    const initial = {
        id,
        date: timestamp,
        host: input.host || (options.caller === 'cli' ? 'cli' : 'codex'),
        mode: input.mode,
        executor: route.executor,
        agent: route.profile.agent,
        adapter: route.agent.adapter || route.agent.command,
        model: route.agent.model || route.agent.adapter || route.agent.command,
        task: input.task,
        output: '',
        error: '',
        exitCode: null,
        logPath: path.join(runsDir(route.cwd), `${id}.md`),
        jsonPath: path.join(runsDir(route.cwd), `${id}.json`),
        contextSummary: route.context.summary,
        budget: {
            max: route.maxContext,
            actual: route.context.summary.chars,
            exceeded: route.context.summary.chars > route.maxContext,
        },
        status: 'running',
        startedAt: timestamp,
        updatedAt: timestamp,
        prompt: route.prepared.prompt,
        invocationPrompt: route.prepared.invocationPrompt,
        contextSnapshot: route.prepared.materializedContext || route.context.markdown,
        partialOutput: '',
        stderr: '',
        archiveVersion: 1,
        sourceConversationId: input.sourceConversationId,
        parentRunId: input.parentRunId,
        projectPath: route.cwd,
        attachedFiles: route.prepared.attachedFiles?.map((file) => ({ path: file })),
    };
    const saved = saveRun(route.cwd, initial, route.config);
    const promise = executeRouteJob(saved, route, input, controller);
    activeJobs.set(id, { controller, promise });
    void promise.then((completed) => {
        completedJobs.set(id, completed);
        const cleanupTimer = setTimeout(() => completedJobs.delete(id), 60000);
        cleanupTimer.unref?.();
    }).finally(() => activeJobs.delete(id)).catch(() => undefined);
    return saved;
}
export async function waitForRun(runIdValue, cwd = process.cwd(), timeoutMs) {
    const started = Date.now();
    const limit = timeoutMs === undefined ? Number.POSITIVE_INFINITY : Math.max(0, timeoutMs);
    while (true) {
        const run = getRun(runIdValue, cwd);
        if (!run)
            return null;
        const status = terminalStatus(run);
        if (status !== 'running' && status !== 'pending')
            return { ...run, status };
        if (Date.now() - started >= limit)
            return { ...run, status };
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
}
export function cancelRouteTask(runIdValue, cwd = process.cwd()) {
    const job = activeJobs.get(runIdValue);
    if (job)
        job.controller.abort();
    return getRun(runIdValue, cwd);
}
export function listRuns(filter = {}, cwd = process.cwd()) {
    return listArchivedRuns(cwd, filter);
}
export function curateRun(runIdValue, update, cwd = process.cwd()) {
    const config = loadConfig(cwd);
    return curateArchivedRun(cwd, runIdValue, update, config.archive);
}
export function deleteRun(runIdValue, cwd = process.cwd()) {
    const deletedArchive = deleteArchivedRun(cwd, runIdValue);
    // The legacy files are intentionally metadata-only now, but removing them
    // prevents getRun() from resurrecting a record after archive deletion.
    let deletedLegacy = false;
    for (const extension of ['json', 'md']) {
        const filePath = legacyRunPath(cwd, runIdValue, extension);
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            deletedLegacy = true;
        }
    }
    return deletedArchive || deletedLegacy;
}
export function exportRuns(format = 'json', filter = {}, cwd = process.cwd()) {
    return exportArchive(cwd, format, filter);
}
export function importRuns(cwd = process.cwd()) {
    const config = loadConfig(cwd);
    return importLegacyRuns(cwd, config.archive);
}
export async function replayRun(runIdValue, options = {}) {
    const cwd = options.cwd || process.cwd();
    const source = getArchivedRun(cwd, runIdValue) || getRun(runIdValue, cwd);
    if (!source)
        throw new CodeckError('run_not_found', `Run "${runIdValue}" was not found.`);
    if (source.mode === 'compare') {
        throw new CodeckError('aggregate_not_replayable', 'Compare aggregate runs are not replayable; replay an individual child run.');
    }
    const files = source.attachedFiles?.map((file) => file.path);
    const replayInput = {
        host: options.caller === 'cli' ? 'cli' : 'codex',
        mode: source.mode,
        executor: source.executor,
        task: source.task,
        files,
        parentRunId: source.id,
    };
    if (options.currentContext)
        return routeTask(replayInput, options);
    const contextSnapshot = source.contextSnapshot || '';
    const contextOverride = {
        markdown: contextSnapshot,
        resources: [],
        summary: source.contextSummary,
    };
    const preparedOverride = {
        prompt: source.prompt || contextSnapshot,
        invocationPrompt: source.invocationPrompt || source.prompt || contextSnapshot,
        materializedContext: contextSnapshot,
        attachedFiles: files,
    };
    return routeTask(replayInput, { ...options, cwd, contextOverride, preparedOverride });
}
export async function routeTask(input, options = {}) {
    const cwd = options.cwd || process.cwd();
    const config = loadConfig(cwd);
    const initial = await startRouteTask(input, options);
    const waitMs = options.waitMs ?? (options.caller === 'mcp' ? Math.min(config.archive.async_threshold_ms, 45000) : undefined);
    const waited = await waitForRun(initial.id, cwd, waitMs);
    const run = completedJobs.get(initial.id) || waited || initial;
    if (terminalStatus(run) !== 'running' && terminalStatus(run) !== 'pending' && run.exitCode !== 0) {
        const detail = (run.error || run.output || '').trim();
        throw new CodeckError('executor_failed', `Executor "${run.executor}" exited with code ${run.exitCode}.${detail ? `\n${detail.slice(0, 1200)}` : ''}`, {
            runId: run.id,
            exitCode: run.exitCode,
            error: run.error,
            logPath: run.logPath,
        });
    }
    return run;
}
export async function compareExecutors(input, options = {}) {
    assertTask(input.task);
    const cwd = options.cwd || process.cwd();
    const config = loadConfig(cwd);
    const runs = [];
    const errors = [];
    const routeInput = (executor) => ({
        host: input.host,
        mode: 'compare',
        executor,
        task: input.task,
        files: input.files,
    });
    if (options.caller === 'mcp') {
        // Start all compare children together so the MCP caller does not spend
        // 45 seconds on each model before seeing the pending run IDs.
        const started = await Promise.all(input.executors.map((executor) => startRouteTask(routeInput(executor), { ...options, cwd })));
        const waited = await Promise.all(started.map((run) => waitForRun(run.id, cwd, config.archive.async_threshold_ms)));
        for (const [index, run] of waited.entries()) {
            const fallback = started[index];
            if (run)
                runs.push(run);
            else
                errors.push(`## ${input.executors[index]}\nError: run ${fallback.id} disappeared.`);
        }
    }
    else {
        for (const executor of input.executors) {
            try {
                runs.push(await routeTask(routeInput(executor), { ...options, cwd }));
            }
            catch (err) {
                errors.push(`## ${executor}\nError: ${err.message}`);
            }
        }
    }
    const output = [
        '# Codeck Compare Result',
        ...runs.map((run) => {
            const body = run.status === 'running' || run.status === 'pending'
                ? `Pending. Poll run \`${run.id}\` with wait_run.`
                : (run.output || '(no output)');
            return `## ${run.executor} · ${run.status || 'unknown'}\n\n${body}`;
        }),
        ...errors,
        '',
        '## Handoff Notes',
        'Review agreement, conflicts, and choose the next Codex action.',
    ].join('\n\n');
    const pending = runs.filter((run) => terminalStatus(run) === 'running' || terminalStatus(run) === 'pending');
    const aggregateRun = saveRun(cwd, {
        id: runId(),
        date: new Date().toISOString(),
        host: input.host || (options.caller === 'cli' ? 'cli' : 'codex'),
        mode: 'compare',
        executor: input.executors.join(','),
        agent: 'codeck',
        task: input.task,
        output,
        error: errors.join('\n'),
        exitCode: pending.length ? null : (errors.length ? 1 : 0),
        contextSummary: {
            chars: output.length,
            resourceCount: runs.length,
            truncated: false,
            omitted: [],
        },
        budget: {
            max: config.budget.max_context_chars,
            actual: output.length,
            exceeded: output.length > config.budget.max_context_chars,
        },
        usage: sumUsage(runs),
        status: pending.length ? 'running' : (errors.length ? 'failed' : 'succeeded'),
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    }, config);
    if (pending.length) {
        void Promise.all(pending.map((run) => waitForRun(run.id, cwd)))
            .then((completed) => {
            const finalRuns = completed.filter(Boolean);
            const finalErrors = finalRuns.filter((run) => terminalStatus(run) !== 'succeeded');
            const finalOutput = [
                '# Codeck Compare Result',
                ...finalRuns.map((run) => `## ${run.executor} · ${run.status || 'unknown'}\n\n${run.output || '(no output)'}`),
                ...errors,
                '',
                '## Handoff Notes',
                'Review agreement, conflicts, and choose the next Codex action.',
            ].join('\n\n');
            saveRun(cwd, {
                ...aggregateRun,
                output: finalOutput,
                error: [...errors, ...finalErrors.map((run) => `${run.executor}: ${run.error}`)].join('\n'),
                exitCode: finalErrors.length || errors.length ? 1 : 0,
                status: finalErrors.length || errors.length ? 'failed' : 'succeeded',
                updatedAt: new Date().toISOString(),
                completedAt: new Date().toISOString(),
                contextSummary: { ...aggregateRun.contextSummary, chars: finalOutput.length },
                budget: { ...aggregateRun.budget, actual: finalOutput.length, exceeded: finalOutput.length > aggregateRun.budget.max },
                usage: sumUsage(finalRuns),
            }, config);
        })
            .catch(() => undefined);
    }
    return { runs, output, run: aggregateRun };
}
export function createRawHandoff(run) {
    return [
        '=== DEVDECK RAW HANDOFF ===',
        `Run: ${run.id}`,
        `Mode: ${run.mode}`,
        `Executor: ${run.executor}`,
        '',
        '## Key Source Output',
        run.output.trim() || '(no output)',
        '',
        '## Host Next Step Prompt',
        'Continue from the executor result above. Preserve project constraints, avoid unrelated changes, and verify the final work.',
    ].join('\n');
}
export async function createHandoff(input = {}, options = {}) {
    const cwd = options.cwd || process.cwd();
    const config = loadConfig(cwd);
    const run = getRun(input.runId, cwd);
    if (!run)
        return 'No previous Codeck run is available.';
    const mode = input.mode || config.handoff.default_mode;
    if (mode === 'raw')
        return createRawHandoff(run);
    if (!config.handoff.smart_enabled) {
        throw new CodeckError('smart_handoff_disabled', 'Smart handoff is disabled in config.');
    }
    const smartRun = await routeTask({
        host: options.caller === 'cli' ? 'cli' : 'codex',
        mode: 'ask',
        executor: config.handoff.handoff_executor,
        task: [
            'Convert this Codeck executor output into a Host-ready handoff.',
            'Include: key judgment, executable next steps, do-not-change scope, project constraint conflicts, and a continuation prompt.',
            '',
            run.output,
        ].join('\n'),
    }, options);
    return smartRun.output;
}
export function listExecutors(cwd = process.cwd()) {
    const config = loadConfig(cwd);
    return Object.entries(config.executors)
        .map(([name, profile]) => `- **${name}**: agent=\`${profile.agent}\`, role=\`${profile.role}\`, modes=${profile.allowed_modes.join(', ')}, write_files=${profile.write_files}, run_shell=${profile.run_shell}`)
        .join('\n');
}
