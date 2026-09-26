import fs from "fs";
import path from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { runDoctor } from "./config.js";
import { buildContext, formatContextToMarkdown } from "./context.js";
import {
  cancelRouteTask,
  compareExecutors,
  createHandoff,
  CodeckError,
  curateRun,
  deleteRun,
  exportRuns,
  getRun,
  importRuns,
  listExecutors,
  listRuns,
  pickExecutor,
  publicRun,
  replayRun,
  routeTask,
  waitForRun,
} from "./router.js";
import { VERSION } from "./version.js";

function text(text: string) {
  return { content: [{ type: "text", text }] };
}

function errorResult(error: any) {
  const body = error instanceof CodeckError
    ? { code: error.code, message: error.message, details: error.details }
    : { code: 'codeck_error', message: error.message || String(error), details: {} };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
}

function resolveProjectPath(value: unknown): string {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input || !path.isAbsolute(input)) {
    throw new CodeckError('project_path_required', 'Codeck requires an absolute projectPath for project-scoped MCP calls.');
  }
  try {
    const resolved = fs.realpathSync(input);
    if (!fs.statSync(resolved).isDirectory()) throw new Error('not a directory');
    return resolved;
  } catch {
    throw new CodeckError('project_path_invalid', `Project path is not an accessible directory: ${input}`);
  }
}

export async function startMcpServer() {
  const server = new Server(
    { name: "codeck-mcp", version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "route_task",
        description: "Send one explicit specialist task from Codex to the user-named executor, then return the result to Codex.",
        inputSchema: {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["ask", "subagent", "delegate"], description: "Routing mode." },
            executor: { type: "string", description: "Executor explicitly named by the user. Names are case-insensitive; Agy/AGY maps to antigravity. Auto routing is not accepted from MCP." },
            task: { type: "string", description: "Explicit current task. Required." },
            brief: { type: "string", description: "Compact host summary of relevant product decisions and conversation context. Do not copy the full conversation." },
            includeRepository: { type: "boolean", description: "Whether this task needs Git state, diff, repository rules, and executor default files. Use false for copywriting and other non-code tasks." },
            projectPath: { type: "string", description: "Absolute path of the project the current Codex task belongs to." },
            files: { type: "array", items: { type: "string" }, description: "Optional files to include." },
            sourceConversationId: { type: "string", description: "Optional host conversation/task identifier for archive correlation." },
            parentRunId: { type: "string", description: "Optional parent run identifier." },
            fullContext: { type: "boolean", description: "Use full context budget instead of the smaller ask budget." },
            handoffMode: { type: "string", enum: ["raw", "smart"], description: "Optional handoff mode." },
          },
          required: ["mode", "executor", "task", "includeRepository", "projectPath"],
        },
      },
      {
        name: "pick_executor",
        description: "Pick the configured executor for a task without invoking it.",
        inputSchema: {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["ask", "subagent", "delegate"], description: "Routing mode." },
            task: { type: "string", description: "Explicit current task. Required." },
            projectPath: { type: "string", description: "Absolute project path." },
          },
          required: ["task", "projectPath"],
        },
      },
      {
        name: "compare_executors",
        description: "Run the same task through multiple executor profiles and return a comparison payload; long children can be polled by run ID.",
        inputSchema: {
          type: "object",
          properties: {
            executors: { type: "array", items: { type: "string" } },
            task: { type: "string" },
            files: { type: "array", items: { type: "string" } },
            projectPath: { type: "string", description: "Absolute project path." },
          },
          required: ["executors", "task", "projectPath"],
        },
      },
      {
        name: "build_context",
        description: "Build a Codeck context payload and resource summary.",
        inputSchema: {
          type: "object",
          properties: {
            task: { type: "string" },
            brief: { type: "string" },
            includeRepository: { type: "boolean" },
            projectPath: { type: "string", description: "Absolute project path." },
            files: { type: "array", items: { type: "string" } },
          },
          required: ["projectPath"],
        },
      },
      {
        name: "create_handoff",
        description: "Create a raw or smart handoff from a previous run.",
        inputSchema: {
          type: "object",
          properties: {
            runId: { type: "string" },
            mode: { type: "string", enum: ["raw", "smart"] },
            projectPath: { type: "string", description: "Absolute project path." },
          },
          required: ["projectPath"],
        },
      },
      {
        name: "get_run",
        description: "Retrieve a previous Codeck run by id, or the latest run if omitted.",
        inputSchema: {
          type: "object",
          properties: {
            runId: { type: "string" },
            includeContent: { type: "boolean", description: "Include the redacted prompt/context snapshot and stderr." },
            projectPath: { type: "string", description: "Absolute project path." },
          },
          required: ["projectPath"],
        },
      },
      {
        name: "wait_run",
        description: "Wait briefly for a pending Codeck run, then return its current or terminal state.",
        inputSchema: {
          type: "object",
          properties: {
            runId: { type: "string" },
            timeoutMs: { type: "number", description: "Maximum wait in milliseconds; capped below the host MCP timeout." },
            projectPath: { type: "string", description: "Absolute project path." },
          },
          required: ["runId", "projectPath"],
        },
      },
      {
        name: "cancel_run",
        description: "Cancel an active Codeck executor run.",
        inputSchema: {
          type: "object",
          properties: { runId: { type: "string" }, projectPath: { type: "string", description: "Absolute project path." } },
          required: ["runId", "projectPath"],
        },
      },
      {
        name: "list_runs",
        description: "List archived Codeck runs with optional status, executor, and curation filters.",
        inputSchema: {
          type: "object",
          properties: {
            status: { type: "string" },
            executor: { type: "string" },
            curated: { type: "boolean" },
            limit: { type: "number" },
            projectPath: { type: "string", description: "Absolute project path." },
          },
          required: ["projectPath"],
        },
      },
      {
        name: "search_runs",
        description: "Search the project-local Codeck archive by task, prompt, context, or output.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" }, limit: { type: "number" }, projectPath: { type: "string" } },
          required: ["query", "projectPath"],
        },
      },
      {
        name: "curate_run",
        description: "Mark an archived run as reusable knowledge and attach tags or a note.",
        inputSchema: {
          type: "object",
          properties: {
            runId: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            note: { type: "string" },
            projectPath: { type: "string", description: "Absolute project path." },
          },
          required: ["runId", "projectPath"],
        },
      },
      {
        name: "delete_run",
        description: "Permanently delete one archived Codeck run after explicit user confirmation.",
        inputSchema: {
          type: "object",
          properties: {
            runId: { type: "string" },
            confirm: { type: "boolean", description: "Must be true to permanently delete the run." },
            projectPath: { type: "string", description: "Absolute project path." },
          },
          required: ["runId", "confirm", "projectPath"],
        },
      },
      {
        name: "export_archive",
        description: "Export the project-local Codeck archive as redacted JSON or Markdown.",
        inputSchema: {
          type: "object",
          properties: { format: { type: "string", enum: ["json", "markdown"] }, limit: { type: "number" }, projectPath: { type: "string" } },
          required: ["projectPath"],
        },
      },
      {
        name: "import_runs",
        description: "Import existing legacy .codeck/runs JSON records into the archive once.",
        inputSchema: { type: "object", properties: { projectPath: { type: "string" } }, required: ["projectPath"] },
      },
      {
        name: "replay_run",
        description: "Replay an archived run using its redacted historical snapshot, or explicitly use current project context.",
        inputSchema: {
          type: "object",
          properties: { runId: { type: "string" }, currentContext: { type: "boolean" }, projectPath: { type: "string" } },
          required: ["runId", "projectPath"],
        },
      },
      {
        name: "list_executors",
        description: "List configured Codeck executor profiles.",
        inputSchema: { type: "object", properties: { projectPath: { type: "string" } }, required: ["projectPath"] },
      },
      {
        name: "doctor",
        description: "Probe configured agents and list executor profiles.",
        inputSchema: { type: "object", properties: { projectPath: { type: "string" } }, required: ["projectPath"] },
      },
      {
        name: "ask_agent",
        description: "Compatibility wrapper around route_task(mode=ask). Prefer route_task.",
        inputSchema: {
          type: "object",
          properties: {
            agent: { type: "string" },
            role: { type: "string" },
            prompt: { type: "string" },
            projectPath: { type: "string" },
          },
          required: ["agent", "prompt", "projectPath"],
        },
      },
      {
        name: "compare_agents",
        description: "Compatibility wrapper around compare_executors.",
        inputSchema: {
          type: "object",
          properties: {
            agents: { type: "array", items: { type: "string" } },
            prompt: { type: "string" },
            projectPath: { type: "string" },
          },
          required: ["agents", "prompt", "projectPath"],
        },
      },
      {
        name: "get_last_output",
        description: "Compatibility wrapper returning latest run output.",
        inputSchema: { type: "object", properties: { projectPath: { type: "string" } }, required: ["projectPath"] },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args = {} } = request.params;

    try {
      switch (name) {
        case "route_task": {
          const { fullContext, projectPath, ...input } = args as any;
          const cwd = resolveProjectPath(projectPath);
          const progressToken = (request.params as any)._meta?.progressToken;
          const progressStarted = Date.now();
          const progressTimer = progressToken === undefined ? null : setInterval(() => {
            void extra.sendNotification({
              method: 'notifications/progress',
              params: {
                progressToken,
                progress: Math.round((Date.now() - progressStarted) / 1000),
                total: 45,
                message: 'Codeck is waiting for the external executor; use wait_run if this call returns pending.',
              },
            } as any).catch(() => undefined);
          }, 10000);
          let run;
          try {
            run = await routeTask(input, { cwd, caller: 'mcp', allowOverBudget: Boolean(fullContext) });
          } finally {
            if (progressTimer) clearInterval(progressTimer);
          }
          return text(JSON.stringify(publicRun(run), null, 2));
        }
        case "pick_executor": {
          const { task, mode = 'ask', projectPath } = args as { task: string; mode?: any; projectPath?: string };
          return text(pickExecutor(task, mode, resolveProjectPath(projectPath), 'mcp'));
        }
        case "compare_executors": {
          const { projectPath, ...input } = args as any;
          const result = await compareExecutors(input, { cwd: resolveProjectPath(projectPath), caller: 'mcp' });
          return text(JSON.stringify({
            run: publicRun(result.run),
            runs: result.runs.map(publicRun),
            output: result.output,
          }, null, 2));
        }
        case "build_context": {
          const { projectPath, ...input } = args as any;
          const ctx = buildContext(resolveProjectPath(projectPath), input);
          return text(JSON.stringify({ summary: ctx.summary, markdown: formatContextToMarkdown(ctx) }, null, 2));
        }
        case "create_handoff": {
          const { projectPath, ...input } = args as any;
          return text(await createHandoff(input, { cwd: resolveProjectPath(projectPath), caller: 'mcp' }));
        }
        case "get_run": {
          const run = getRun((args as any).runId, resolveProjectPath((args as any).projectPath));
          if (!run) return text('No Codeck run found.');
          return text(JSON.stringify((args as any).includeContent ? run : publicRun(run), null, 2));
        }
        case "wait_run": {
          const runId = String((args as any).runId || '');
          const requestedTimeout = Number((args as any).timeoutMs);
          const timeoutMs = Number.isFinite(requestedTimeout) ? Math.min(Math.max(requestedTimeout, 0), 45000) : 40000;
          const run = await waitForRun(runId, resolveProjectPath((args as any).projectPath), timeoutMs);
          return text(run ? JSON.stringify(publicRun(run), null, 2) : 'No Codeck run found.');
        }
        case "cancel_run": {
          const run = cancelRouteTask(String((args as any).runId || ''), resolveProjectPath((args as any).projectPath));
          return text(run ? JSON.stringify(publicRun(run), null, 2) : 'No active Codeck run found.');
        }
        case "list_runs": {
          const filter = args as any;
          return text(JSON.stringify(listRuns({
            status: filter.status,
            executor: filter.executor,
            curated: filter.curated,
            limit: filter.limit,
          }, resolveProjectPath(filter.projectPath)).map(publicRun), null, 2));
        }
        case "search_runs": {
          const filter = args as any;
          return text(JSON.stringify(listRuns({ query: filter.query, limit: filter.limit }, resolveProjectPath(filter.projectPath)).map(publicRun), null, 2));
        }
        case "curate_run": {
          const value = args as any;
          const run = curateRun(String(value.runId || ''), { tags: value.tags, note: value.note }, resolveProjectPath(value.projectPath));
          return text(run ? JSON.stringify(publicRun(run), null, 2) : 'No archived Codeck run found.');
        }
        case "delete_run": {
          if ((args as any).confirm !== true) {
            throw new CodeckError('confirmation_required', 'Set confirm=true after verifying the run id before deleting it.');
          }
          const deleted = deleteRun(String((args as any).runId || ''), resolveProjectPath((args as any).projectPath));
          return text(deleted ? 'Archived Codeck run deleted.' : 'No archived Codeck run found.');
        }
        case "export_archive": {
          const value = args as any;
          return text(exportRuns(value.format === 'markdown' ? 'markdown' : 'json', { limit: value.limit }, resolveProjectPath(value.projectPath)));
        }
        case "import_runs": {
          return text(JSON.stringify({ imported: importRuns(resolveProjectPath((args as any).projectPath)) }, null, 2));
        }
        case "replay_run": {
          const value = args as any;
          const run = await replayRun(String(value.runId || ''), {
            cwd: resolveProjectPath(value.projectPath),
            caller: 'mcp',
            currentContext: Boolean(value.currentContext),
          });
          return text(JSON.stringify(publicRun(run), null, 2));
        }
        case "list_executors": {
          return text(listExecutors(resolveProjectPath((args as any).projectPath)));
        }
        case "doctor": {
          return text(JSON.stringify(runDoctor(resolveProjectPath((args as any).projectPath)), null, 2));
        }
        case "ask_agent": {
          const { agent, prompt, projectPath } = args as { agent: string; prompt: string; projectPath: string };
          const run = await routeTask({ mode: 'ask', executor: agent, task: prompt }, { cwd: resolveProjectPath(projectPath), caller: 'mcp' });
          return text(run.status === 'succeeded' ? [run.output, run.updateNotice].filter(Boolean).join('\n\n') : JSON.stringify(publicRun(run), null, 2));
        }
        case "compare_agents": {
          const { agents, prompt, projectPath } = args as { agents: string[]; prompt: string; projectPath: string };
          const result = await compareExecutors({ executors: agents, task: prompt }, { cwd: resolveProjectPath(projectPath), caller: 'mcp' });
          return text(result.output);
        }
        case "get_last_output": {
          return text(getRun(undefined, resolveProjectPath((args as any).projectPath))?.output || 'No output recorded yet.');
        }
        default:
          throw new CodeckError('unknown_tool', `Unknown tool name: ${name}`);
      }
    } catch (error: any) {
      return errorResult(error);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[Codeck MCP] Server running on stdio transport...");
}
