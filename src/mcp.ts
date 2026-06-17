import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { buildContext, formatContextToMarkdown } from "./context.js";
import { runAgent, getLastOutput } from "./runner.js";

export async function startMcpServer() {
  const server = new Server(
    {
      name: "devdeck-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // 1. Register tools list
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "build_context",
          description: "Scan the project workspace (README, Git Diff, Git Status) and generate a Markdown context payload.",
          inputSchema: {
            type: "object",
            properties: {}
          }
        },
        {
          name: "ask_agent",
          description: "Securely delegate a task to a local coding agent (e.g., codex, claude, gemini). Combines current context and previous output automatically.",
          inputSchema: {
            type: "object",
            properties: {
              agent: {
                type: "string",
                description: "Name of the agent (e.g. 'claude', 'gemini', 'codex')"
              },
              prompt: {
                type: "string",
                description: "Instructions or questions for this agent"
              }
            },
            required: ["agent", "prompt"]
          }
        },
        {
          name: "compare_agents",
          description: "Query multiple agents simultaneously with the same prompt and compare their outputs side-by-side.",
          inputSchema: {
            type: "object",
            properties: {
              agents: {
                type: "array",
                items: { type: "string" },
                description: "List of agent names (e.g., ['claude', 'gemini'])"
              },
              prompt: {
                type: "string",
                description: "The prompt to ask both agents"
              }
            },
            required: ["agents", "prompt"]
          }
        },
        {
          name: "get_last_output",
          description: "Retrieve the result of the last agent run.",
          inputSchema: {
            type: "object",
            properties: {}
          }
        },
        {
          name: "list_agents",
          description: "Get a list of all configured local agents.",
          inputSchema: {
            type: "object",
            properties: {}
          }
        }
      ]
    };
  });

  // 2. Register tools handlers
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "build_context": {
          const ctx = buildContext();
          const md = formatContextToMarkdown(ctx);
          return {
            content: [{ type: "text", text: md }]
          };
        }

        case "ask_agent": {
          const { agent, prompt } = args as { agent: string; prompt: string };
          // Ensure agent exists
          const config = loadConfig();
          if (!config.agents[agent]) {
            throw new Error(`Agent "${agent}" is not configured. Configured agents: ${Object.keys(config.agents).join(', ')}`);
          }

          // Executed silently to protect stdio JSON-RPC channel
          const result = await runAgent(agent, prompt, { silent: true });
          
          return {
            content: [{ type: "text", text: result.output }]
          };
        }

        case "compare_agents": {
          const { agents, prompt } = args as { agents: string[]; prompt: string };
          const config = loadConfig();
          
          // Validate agents
          for (const a of agents) {
            if (!config.agents[a]) {
              throw new Error(`Agent "${a}" is not configured.`);
            }
          }

          // Run them sequentially (or concurrently, but sequential is safer for terminal environment)
          const results: string[] = [];
          for (const a of agents) {
            try {
              const res = await runAgent(a, prompt, { silent: true });
              results.push(`## Agent: **${a.toUpperCase()}**\n\n${res.output.trim()}`);
            } catch (err: any) {
              results.push(`## Agent: **${a.toUpperCase()}**\n\n*Error: ${err.message}*`);
            }
          }

          return {
            content: [{ type: "text", text: results.join("\n\n---\n\n") }]
          };
        }

        case "get_last_output": {
          const last = getLastOutput();
          return {
            content: [{ type: "text", text: last || "No output recorded yet." }]
          };
        }

        case "list_agents": {
          const config = loadConfig();
          const list = Object.entries(config.agents)
            .map(([k, v]) => `- **${k}**: command=\`${v.command}\``)
            .join("\n");
          return {
            content: [{ type: "text", text: `### Configured Agents\n\n${list}` }]
          };
        }

        default:
          throw new Error(`Unknown tool name: ${name}`);
      }
    } catch (error: any) {
      return {
        isError: true,
        content: [{ type: "text", text: error.message }]
      };
    }
  });

  // Start Server on stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  // Use stderr to output info since stdout is occupied by JSON-RPC
  console.error("[DevDeck MCP] Server running on stdio transport...");
}
