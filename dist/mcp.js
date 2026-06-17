import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { runDoctor } from "./config.js";
import { buildContext, formatContextToMarkdown } from "./context.js";
import { compareExecutors, createHandoff, CodeckError, getRun, listExecutors, pickExecutor, routeTask } from "./router.js";
function text(text) {
    return { content: [{ type: "text", text }] };
}
function errorResult(error) {
    const body = error instanceof CodeckError
        ? { code: error.code, message: error.message, details: error.details }
        : { code: 'codeck_error', message: error.message || String(error), details: {} };
    return { isError: true, content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
}
export async function startMcpServer() {
    const server = new Server({ name: "codeck-mcp", version: "0.1.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            {
                name: "route_task",
                description: "Route a task from Codex to a configured Codeck executor profile. Omit executor or pass auto to use routing rules.",
                inputSchema: {
                    type: "object",
                    properties: {
                        mode: { type: "string", enum: ["ask", "subagent", "delegate"], description: "Routing mode." },
                        executor: { type: "string", description: "Executor profile name, or auto." },
                        task: { type: "string", description: "Explicit current task. Required." },
                        files: { type: "array", items: { type: "string" }, description: "Optional files to include." },
                        fullContext: { type: "boolean", description: "Use full context budget instead of the smaller ask budget." },
                        handoffMode: { type: "string", enum: ["raw", "smart"], description: "Optional handoff mode." },
                    },
                    required: ["mode", "task"],
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
                    },
                    required: ["task"],
                },
            },
            {
                name: "compare_executors",
                description: "Run the same task through multiple executor profiles sequentially and return a comparison payload.",
                inputSchema: {
                    type: "object",
                    properties: {
                        executors: { type: "array", items: { type: "string" } },
                        task: { type: "string" },
                        files: { type: "array", items: { type: "string" } },
                    },
                    required: ["executors", "task"],
                },
            },
            {
                name: "build_context",
                description: "Build a Codeck context payload and resource summary.",
                inputSchema: {
                    type: "object",
                    properties: {
                        task: { type: "string" },
                        files: { type: "array", items: { type: "string" } },
                    },
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
                    },
                },
            },
            {
                name: "get_run",
                description: "Retrieve a previous Codeck run by id, or the latest run if omitted.",
                inputSchema: {
                    type: "object",
                    properties: { runId: { type: "string" } },
                },
            },
            {
                name: "list_executors",
                description: "List configured Codeck executor profiles.",
                inputSchema: { type: "object", properties: {} },
            },
            {
                name: "doctor",
                description: "Probe configured agents and list executor profiles.",
                inputSchema: { type: "object", properties: {} },
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
                    },
                    required: ["agent", "prompt"],
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
                    },
                    required: ["agents", "prompt"],
                },
            },
            {
                name: "get_last_output",
                description: "Compatibility wrapper returning latest run output.",
                inputSchema: { type: "object", properties: {} },
            },
        ],
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args = {} } = request.params;
        try {
            switch (name) {
                case "route_task": {
                    const { fullContext, ...input } = args;
                    const run = await routeTask(input, { caller: 'mcp', allowOverBudget: Boolean(fullContext) });
                    return text(JSON.stringify(run, null, 2));
                }
                case "pick_executor": {
                    const { task, mode = 'ask' } = args;
                    return text(pickExecutor(task, mode, process.cwd(), 'mcp'));
                }
                case "compare_executors": {
                    const result = await compareExecutors(args, { caller: 'mcp' });
                    return text(result.output);
                }
                case "build_context": {
                    const ctx = buildContext(process.cwd(), args);
                    return text(JSON.stringify({ summary: ctx.summary, markdown: formatContextToMarkdown(ctx) }, null, 2));
                }
                case "create_handoff": {
                    return text(await createHandoff(args, { caller: 'mcp' }));
                }
                case "get_run": {
                    const run = getRun(args.runId);
                    return text(run ? JSON.stringify(run, null, 2) : 'No Codeck run found.');
                }
                case "list_executors": {
                    return text(listExecutors());
                }
                case "doctor": {
                    return text(JSON.stringify(runDoctor(), null, 2));
                }
                case "ask_agent": {
                    const { agent, prompt } = args;
                    const run = await routeTask({ mode: 'ask', executor: agent, task: prompt }, { caller: 'mcp' });
                    return text(run.output);
                }
                case "compare_agents": {
                    const { agents, prompt } = args;
                    const result = await compareExecutors({ executors: agents, task: prompt }, { caller: 'mcp' });
                    return text(result.output);
                }
                case "get_last_output": {
                    return text(getRun()?.output || 'No output recorded yet.');
                }
                default:
                    throw new CodeckError('unknown_tool', `Unknown tool name: ${name}`);
            }
        }
        catch (error) {
            return errorResult(error);
        }
    });
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[Codeck MCP] Server running on stdio transport...");
}
