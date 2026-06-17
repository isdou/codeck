export type Host = 'codex' | 'cli' | string;

export type RouteMode = 'ask' | 'subagent' | 'delegate' | 'compare';

export type HandoffMode = 'raw' | 'smart';

export type ContextResourceType = 'text' | 'file' | 'image' | 'document' | 'diff' | 'directory';

export interface AgentConfig {
  command: string;
  adapter?: string;
  prompt_args?: string[];
  timeout_ms?: number;
  env?: Record<string, string>;
  api_key?: string;
  model?: string;
}

export interface ExecutorProfile {
  agent: string;
  role: string;
  description: string;
  allowed_modes: RouteMode[];
  read_files: boolean;
  write_files: boolean;
  run_shell: boolean;
  context_include: string[];
}

export interface ContextConfig {
  include_git_diff: boolean;
  include_readme: boolean;
  include_agent_files: boolean;
  max_files: number;
  max_file_bytes: number;
  exclude: string[];
}

export interface BudgetConfig {
  max_context_chars: number;
  mcp_max_context_chars: number;
  ask_context_chars: number;
}

export interface HandoffConfig {
  default_mode: HandoffMode;
  smart_enabled: boolean;
  handoff_executor: string;
}

export interface CompareConfig {
  default_execution: 'sequential' | 'parallel';
  allow_parallel: boolean;
}

export interface RouteRule {
  name?: string;
  executor: string;
  keywords: string[];
}

export interface RoutingConfig {
  default_executor: string;
  rules: RouteRule[];
}

export interface Config {
  agents: Record<string, AgentConfig>;
  executors: Record<string, ExecutorProfile>;
  context: ContextConfig;
  budget: BudgetConfig;
  handoff: HandoffConfig;
  compare: CompareConfig;
  routing: RoutingConfig;
}

export interface ContextResource {
  type: ContextResourceType;
  label: string;
  path?: string;
  content: string;
  chars: number;
  required?: boolean;
}

export interface BuiltContext {
  markdown: string;
  resources: ContextResource[];
  summary: {
    chars: number;
    resourceCount: number;
    truncated: boolean;
    omitted: string[];
  };
}

export interface RouteTaskInput {
  host?: Host;
  mode: RouteMode;
  executor?: string;
  task: string;
  files?: string[];
  handoffMode?: HandoffMode;
}

export interface CompareExecutorsInput {
  host?: Host;
  executors: string[];
  task: string;
  files?: string[];
}

export interface RunRecord {
  id: string;
  date: string;
  host: Host;
  mode: RouteMode;
  executor: string;
  agent: string;
  task: string;
  output: string;
  error: string;
  exitCode: number | null;
  logPath: string;
  jsonPath: string;
  contextSummary: BuiltContext['summary'];
  budget: {
    max: number;
    actual: number;
    exceeded: boolean;
  };
}

export interface AdapterCapabilities {
  text: boolean;
  file: boolean;
  image: boolean;
  document: boolean;
  writeFiles: boolean;
  runShell: boolean;
}
