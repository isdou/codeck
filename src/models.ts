export type Host = 'codex' | 'cli' | string;

export type RouteMode = 'ask' | 'subagent' | 'delegate' | 'compare';

export type HandoffMode = 'raw' | 'smart';

export type RunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'timeout' | 'cancelled';

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

export interface ArchiveConfig {
  enabled: boolean;
  redact: boolean;
  async_threshold_ms: number;
  progress_interval_ms: number;
  max_inline_chars: number;
  redaction_patterns: string[];
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
  archive: ArchiveConfig;
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
  sourceConversationId?: string;
  parentRunId?: string;
}

export interface CompareExecutorsInput {
  host?: Host;
  executors: string[];
  task: string;
  files?: string[];
}

export interface RunUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  estimated: boolean;
}

export interface RunRecord {
  id: string;
  date: string;
  host: Host;
  mode: RouteMode;
  executor: string;
  agent: string;
  adapter?: string;
  model?: string;
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
  usage?: RunUsage;
  status?: RunStatus;
  startedAt?: string;
  completedAt?: string;
  updatedAt?: string;
  prompt?: string;
  invocationPrompt?: string;
  contextSnapshot?: string;
  partialOutput?: string;
  stderr?: string;
  archiveVersion?: number;
  redactions?: Array<{ field: string; count: number; kinds: string[] }>;
  sourceConversationId?: string;
  parentRunId?: string;
  projectPath?: string;
  attachedFiles?: Array<{ path: string; sha256?: string; size?: number }>;
  curated?: boolean;
  tags?: string[];
  note?: string;
  payloadRefs?: Record<string, { path: string; sha256: string; chars: number }>;
}

export interface AdapterCapabilities {
  text: boolean;
  file: boolean;
  image: boolean;
  document: boolean;
  writeFiles: boolean;
  runShell: boolean;
}
