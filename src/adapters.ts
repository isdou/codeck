import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { spawnSync } from 'child_process';
import type { AdapterCapabilities, AgentConfig, BuiltContext, ExecutorProfile, RunRecord, RunUsage } from './models.js';

export interface AdapterProgress {
  output?: string;
  error?: string;
  kind?: 'stdout' | 'stderr' | 'status';
}

export interface PreparedAdapterRequest {
  prompt: string;
  invocationPrompt: string;
  materializedContext?: string;
  contextPath?: string;
  attachedFiles?: string[];
}

export interface AdapterInvokeInput {
  agentName: string;
  agent: AgentConfig;
  executorName: string;
  profile: ExecutorProfile;
  task: string;
  context: BuiltContext;
  files?: string[];
  cwd?: string;
  signal?: AbortSignal;
  onProgress?: (progress: AdapterProgress) => void;
  prepared?: PreparedAdapterRequest;
}

export interface AdapterInvokeResult {
  output: string;
  error: string;
  exitCode: number | null;
  usage?: RunUsage;
  prompt?: string;
  invocationPrompt?: string;
  contextSnapshot?: string;
  stderr?: string;
}

export interface AgentAdapter {
  name: string;
  capabilities: AdapterCapabilities;
  probe(agent: AgentConfig): { ok: boolean; message: string };
  invoke(input: AdapterInvokeInput): Promise<AdapterInvokeResult>;
}

interface ModelPricing {
  inputCostPerM: number;
  outputCostPerM: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  'gemini-2.5-flash': { inputCostPerM: 0.075, outputCostPerM: 0.30 },
  'gemini-2.5-pro': { inputCostPerM: 1.25, outputCostPerM: 5.00 },
  'claude-3-5-sonnet-latest': { inputCostPerM: 3.00, outputCostPerM: 15.00 },
  'claude-3-5-sonnet-20241022': { inputCostPerM: 3.00, outputCostPerM: 15.00 },
  'claude-3-opus-latest': { inputCostPerM: 15.00, outputCostPerM: 75.00 },
  'claude': { inputCostPerM: 3.00, outputCostPerM: 15.00 },
  'gemini': { inputCostPerM: 0.075, outputCostPerM: 0.30 },
  'antigravity': { inputCostPerM: 0.075, outputCostPerM: 0.30 },
  'mock': { inputCostPerM: 0, outputCostPerM: 0 },
};

export function getPricing(modelOrAgent: string): ModelPricing {
  const norm = modelOrAgent.toLowerCase();
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (norm.includes(key)) return pricing;
  }
  return MODEL_PRICING['gemini-2.5-flash'];
}

export function calculateUsage(
  promptText: string,
  outputText: string,
  modelOrAgent: string,
  exactPromptTokens?: number,
  exactCompletionTokens?: number,
): RunUsage {
  const estimated = exactPromptTokens === undefined || exactCompletionTokens === undefined;
  
  const promptTokens = exactPromptTokens !== undefined 
    ? exactPromptTokens 
    : Math.ceil(promptText.length / 3.5);
  
  const completionTokens = exactCompletionTokens !== undefined
    ? exactCompletionTokens
    : Math.ceil(outputText.length / 3.5);

  const pricing = getPricing(modelOrAgent);
  const estimatedCostUsd = ((promptTokens * pricing.inputCostPerM) + (completionTokens * pricing.outputCostPerM)) / 1000000;

  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimatedCostUsd,
    estimated,
  };
}

function splitCommand(command: string): { binary: string; args: string[] } {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  return { binary: parts[0] || '', args: parts.slice(1) };
}

function commandExists(command: string): boolean {
  const { binary } = splitCommand(command);
  if (!binary) return false;
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [binary], { stdio: 'ignore' });
  return probe.status === 0;
}

function buildPrompt(input: AdapterInvokeInput): string {
  return [
    `=== DEVDECK ROUTED TASK ===`,
    `Executor: ${input.executorName}`,
    `Role: ${input.profile.role}`,
    `Task: ${input.task}`,
    ``,
    `=== CONTEXT ===`,
    input.context.markdown,
    ``,
    `=== INSTRUCTION ===`,
    `Answer the routed task. Respect the executor permissions: write_files=${input.profile.write_files}, run_shell=${input.profile.run_shell}.`,
  ].join('\n');
}

function buildAntigravityPrompt(input: AdapterInvokeInput, materializedPrompt: string): PreparedAdapterRequest {
  const cwd = input.cwd || process.cwd();
  const contextPath = path.resolve(cwd, '.codeck', 'context.md');
  fs.mkdirSync(path.dirname(contextPath), { recursive: true });
  fs.writeFileSync(contextPath, materializedPrompt, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(contextPath, 0o600);

  const invocationPrompt = [
    'A complete routed task and its repository context are stored in this workspace file:',
    contextPath,
    'Read that file first, then answer the task it contains.',
  ].join('\n');
  return {
    prompt: materializedPrompt,
    invocationPrompt,
    materializedContext: materializedPrompt,
    contextPath,
    attachedFiles: input.files,
  };
}

export function prepareAdapterRequest(input: AdapterInvokeInput): PreparedAdapterRequest {
  const adapter = (input.agent.adapter || input.executorName || '').toLowerCase();
  if (input.prepared) {
    // A replay can carry the historical materialized prompt while the Agy CLI
    // still needs a context file in the current project. Re-materialize it so
    // the invocation never points at an overwritten or foreign path.
    if (adapter === 'antigravity' && input.prepared.materializedContext) {
      return buildAntigravityPrompt(input, input.prepared.materializedContext);
    }
    return input.prepared;
  }
  const materializedPrompt = buildPrompt(input);
  if (adapter === 'antigravity') return buildAntigravityPrompt(input, materializedPrompt);
  if (adapter === 'gemini_image') {
    return {
      prompt: input.task,
      invocationPrompt: input.task,
      materializedContext: input.context.markdown,
      attachedFiles: input.files,
    };
  }
  return {
    prompt: materializedPrompt,
    invocationPrompt: materializedPrompt,
    materializedContext: input.context.markdown,
    attachedFiles: input.files,
  };
}

function applyPromptArgs(agent: AgentConfig, defaults: string[], prompt: string): string[] {
  // An explicit empty list selects stdin mode for generic CLI integrations.
  const template = agent.prompt_args ?? defaults;
  return template.map((arg) => arg === '{prompt}' ? prompt : arg);
}

function spawnPrompt(
  agent: AgentConfig,
  promptArgs: string[],
  invocationPrompt: string,
  usagePrompt: string,
  cwd: string,
  env: Record<string, string> = {},
  options: { onProgress?: (progress: AdapterProgress) => void; signal?: AbortSignal } = {},
): Promise<AdapterInvokeResult> {
  return new Promise((resolve, reject) => {
    const { binary, args } = splitCommand(agent.command);
    if (!binary) {
      reject(new Error('Agent command is empty.'));
      return;
    }

    const child = spawn(binary, [...args, ...promptArgs], {
      cwd,
      shell: false,
      env: { ...process.env, ...env, ...(agent.env || {}) },
    });

    let output = '';
    let error = '';
    let settled = false;
    const abort = () => {
      if (!settled) child.kill('SIGTERM');
    };
    if (options.signal?.aborted) abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timeout = agent.timeout_ms && agent.timeout_ms > 0
      ? setTimeout(() => {
        settled = true;
        child.kill('SIGTERM');
        const usage = calculateUsage(usagePrompt, output, agent.model || agent.adapter || agent.command);
        resolve({
          output,
          error: `${error}${error ? '\n' : ''}Timed out after ${agent.timeout_ms}ms.`,
          exitCode: 124,
          usage,
          stderr: error,
        });
      }, agent.timeout_ms)
      : null;
    child.stdout.on('data', (data) => {
      output += data.toString();
      options.onProgress?.({ output, error, kind: 'stdout' });
    });
    child.stderr.on('data', (data) => {
      error += data.toString();
      options.onProgress?.({ output, error, kind: 'stderr' });
    });
    child.on('error', (err) => {
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
      if (!settled) reject(new Error(`Failed to start "${binary}": ${err.message}`));
    });
    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
      if (!settled) {
        const usage = calculateUsage(usagePrompt, output, agent.model || agent.adapter || agent.command);
        resolve({ output, error, exitCode: options.signal?.aborted ? 130 : code, usage, stderr: error });
      }
    });

    if (promptArgs.length === 0) {
      child.stdin.write(invocationPrompt);
    }
    child.stdin.end();
  });
}

function makeCliAdapter(
  name: string,
  defaults: string[] | ((agent: AgentConfig) => string[]),
  capabilities: AdapterCapabilities,
  env: Record<string, string> = {},
): AgentAdapter {
  return {
    name,
    capabilities,
    probe(agent) {
      return commandExists(agent.command)
        ? { ok: true, message: `${agent.command} found` }
        : { ok: false, message: `${agent.command} not found in PATH` };
    },
    invoke(input) {
      const prepared = prepareAdapterRequest(input);
      const defaultArgs = typeof defaults === 'function' ? defaults(input.agent) : defaults;
      const promptArgs = applyPromptArgs(input.agent, defaultArgs, prepared.invocationPrompt);
      return spawnPrompt(
        input.agent,
        promptArgs,
        prepared.invocationPrompt,
        prepared.prompt,
        input.cwd || process.cwd(),
        env,
        { onProgress: input.onProgress, signal: input.signal },
      ).then((result) => ({
        ...result,
        prompt: prepared.prompt,
        invocationPrompt: prepared.invocationPrompt,
        contextSnapshot: prepared.materializedContext,
      }));
    },
  };
}

export const mockAdapter: AgentAdapter = {
  name: 'mock',
  capabilities: { text: true, file: true, image: false, document: true, writeFiles: false, runShell: false },
  probe() {
    return { ok: true, message: 'mock adapter ready' };
  },
  async invoke(input) {
    const output = [
      `Mock executor: ${input.executorName}`,
      `Mode-compatible role: ${input.profile.role}`,
      `Task: ${input.task}`,
      `Context chars: ${input.context.summary.chars}`,
    ].join('\n');
    const prepared = prepareAdapterRequest(input);
    const usage = calculateUsage(prepared.prompt, output, 'mock');
    input.onProgress?.({ output, kind: 'stdout' });
    return {
      output,
      error: '',
      exitCode: 0,
      usage,
      prompt: prepared.prompt,
      invocationPrompt: prepared.invocationPrompt,
      contextSnapshot: prepared.materializedContext,
    };
  },
};

export const geminiApiAdapter: AgentAdapter = {
  name: 'gemini_api',
  capabilities: { text: true, file: true, image: false, document: true, writeFiles: false, runShell: false },
  probe(agent) {
    const key = agent.api_key || process.env.GEMINI_API_KEY;
    return key
      ? { ok: true, message: 'Gemini API key is configured.' }
      : { ok: false, message: 'Gemini API key not found. Set GEMINI_API_KEY in .env or config.toml.' };
  },
  async invoke(input) {
    const key = input.agent.api_key || process.env.GEMINI_API_KEY;
    if (!key) {
      return { output: '', error: 'Gemini API Key is missing. Please set GEMINI_API_KEY.', exitCode: 1 };
    }
    const prepared = prepareAdapterRequest(input);
    const model = input.agent.model || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const prompt = prepared.prompt;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: input.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        return { output: '', error: `Gemini API request failed (${response.status}): ${errText}`, exitCode: 1 };
      }

      const data = (await response.json()) as any;
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        return { output: '', error: `Invalid Gemini API response: ${JSON.stringify(data)}`, exitCode: 1 };
      }
      const usageMetadata = data.usageMetadata;
      const exactPrompt = usageMetadata?.promptTokenCount;
      const exactCompletion = usageMetadata?.candidatesTokenCount;
      const usage = calculateUsage(prompt, text, model, exactPrompt, exactCompletion);
      input.onProgress?.({ output: text, kind: 'stdout' });
      return {
        output: text,
        error: '',
        exitCode: 0,
        usage,
        prompt: prepared.prompt,
        invocationPrompt: prepared.invocationPrompt,
        contextSnapshot: prepared.materializedContext,
      };
    } catch (err: any) {
      return { output: '', error: `Gemini API execution error: ${err.message}`, exitCode: 1 };
    }
  },
};

interface GeminiImagePart {
  data: string;
  mimeType: string;
}

export function extractGeminiImageParts(data: any): GeminiImagePart[] {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part: any) => part.inlineData || part.inline_data)
    .filter(Boolean)
    .map((inlineData: any) => ({
      data: inlineData.data,
      mimeType: inlineData.mimeType || inlineData.mime_type || 'image/png',
    }))
    .filter((part: GeminiImagePart) => part.data);
}

function extractGeminiText(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((part: any) => part.text).filter(Boolean).join('\n').trim();
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes('jpeg')) return 'jpg';
  if (mimeType.includes('webp')) return 'webp';
  return 'png';
}

function mimeForImageFile(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return null;
}

function geminiImageInputParts(files: string[] | undefined, cwd: string = process.cwd()): any[] {
  return (files || []).flatMap((file) => {
    const fullPath = path.resolve(cwd, file);
    const mimeType = mimeForImageFile(fullPath);
    if (!mimeType) return [];
    return [{
      inlineData: {
        mimeType,
        data: fs.readFileSync(fullPath).toString('base64'),
      },
    }];
  });
}

export const geminiImageAdapter: AgentAdapter = {
  name: 'gemini_image',
  capabilities: { text: true, file: true, image: true, document: false, writeFiles: false, runShell: false },
  probe(agent) {
    const key = agent.api_key || process.env.GEMINI_API_KEY;
    return key
      ? { ok: true, message: 'Gemini API key is configured.' }
      : { ok: false, message: 'Gemini API key not found. Set GEMINI_API_KEY in .env or config.toml.' };
  },
  async invoke(input) {
    const key = input.agent.api_key || process.env.GEMINI_API_KEY;
    if (!key) {
      return { output: '', error: 'Gemini API Key is missing. Please set GEMINI_API_KEY.', exitCode: 1 };
    }

    const prepared = prepareAdapterRequest(input);
    const model = input.agent.model || 'gemini-3.1-flash-image';
    const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`;
    const prompt = prepared.prompt;
    const inputParts = geminiImageInputParts(input.files, input.cwd || process.cwd());

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key,
        },
        signal: input.signal,
        body: JSON.stringify({
          contents: [{ parts: [...inputParts, { text: prompt }] }],
          generationConfig: { responseModalities: ['Image'] },
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        return { output: '', error: `Gemini image API request failed (${response.status}): ${errText}`, exitCode: 1 };
      }

      const data = (await response.json()) as any;
      const images = extractGeminiImageParts(data);
      if (!images.length) {
        const text = extractGeminiText(data);
        return { output: text, error: `Gemini image API returned no inline image data.${text ? ` Text response: ${text}` : ''}`, exitCode: 1 };
      }

      const outputDir = path.join(input.cwd || process.cwd(), '.codeck', 'images');
      fs.mkdirSync(outputDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const paths = images.map((image, index) => {
        const filePath = path.join(outputDir, `${stamp}-${index + 1}.${extensionForMime(image.mimeType)}`);
        fs.writeFileSync(filePath, Buffer.from(image.data, 'base64'));
        return filePath;
      });
      const output = [
        `Saved ${paths.length} Gemini image${paths.length === 1 ? '' : 's'}:`,
        ...paths.map((filePath) => `- ${filePath}`),
      ].join('\n');
      const usageMetadata = data.usageMetadata;
      const usage = calculateUsage(prompt, output, model, usageMetadata?.promptTokenCount, usageMetadata?.candidatesTokenCount);
      input.onProgress?.({ output, kind: 'stdout' });
      return {
        output,
        error: '',
        exitCode: 0,
        usage,
        prompt: prepared.prompt,
        invocationPrompt: prepared.invocationPrompt,
        contextSnapshot: prepared.materializedContext,
      };
    } catch (err: any) {
      return { output: '', error: `Gemini image API execution error: ${err.message}`, exitCode: 1 };
    }
  },
};

export const claudeApiAdapter: AgentAdapter = {
  name: 'claude_api',
  capabilities: { text: true, file: true, image: false, document: true, writeFiles: false, runShell: false },
  probe(agent) {
    const key = agent.api_key || process.env.ANTHROPIC_API_KEY;
    return key
      ? { ok: true, message: 'Anthropic API key is configured.' }
      : { ok: false, message: 'Anthropic API key not found. Set ANTHROPIC_API_KEY in .env or config.toml.' };
  },
  async invoke(input) {
    const key = input.agent.api_key || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return { output: '', error: 'Anthropic API Key is missing. Please set ANTHROPIC_API_KEY.', exitCode: 1 };
    }
    const prepared = prepareAdapterRequest(input);
    const model = input.agent.model || 'claude-3-5-sonnet-latest';
    const url = 'https://api.anthropic.com/v1/messages';
    const prompt = prepared.prompt;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        signal: input.signal,
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        return { output: '', error: `Anthropic API request failed (${response.status}): ${errText}`, exitCode: 1 };
      }

      const data = (await response.json()) as any;
      const text = data.content?.[0]?.text;
      if (!text) {
        return { output: '', error: `Invalid Anthropic API response: ${JSON.stringify(data)}`, exitCode: 1 };
      }
      const usageMetadata = data.usage;
      const exactPrompt = usageMetadata?.input_tokens;
      const exactCompletion = usageMetadata?.output_tokens;
      const usage = calculateUsage(prompt, text, model, exactPrompt, exactCompletion);
      input.onProgress?.({ output: text, kind: 'stdout' });
      return {
        output: text,
        error: '',
        exitCode: 0,
        usage,
        prompt: prepared.prompt,
        invocationPrompt: prepared.invocationPrompt,
        contextSnapshot: prepared.materializedContext,
      };
    } catch (err: any) {
      return { output: '', error: `Anthropic API execution error: ${err.message}`, exitCode: 1 };
    }
  },
};

export function getAdapter(name: string | undefined): AgentAdapter {
  switch ((name || 'generic').toLowerCase()) {
    case 'mock':
      return mockAdapter;
    case 'gemini_api':
      return geminiApiAdapter;
    case 'gemini_image':
      return geminiImageAdapter;
    case 'claude_api':
      return claudeApiAdapter;
    case 'claude':
      return makeCliAdapter('claude', ['-p', '{prompt}'], { text: true, file: true, image: false, document: true, writeFiles: false, runShell: false });
    case 'gemini':
      return makeCliAdapter('gemini', ['--skip-trust', '--approval-mode', 'plan', '--output-format', 'text', '-p', '{prompt}'], { text: true, file: true, image: true, document: true, writeFiles: false, runShell: false }, {
        GEMINI_CLI_TRUST_WORKSPACE: 'true',
      });
    case 'kimi':
      return makeCliAdapter('kimi', ['--output-format', 'text', '-p', '{prompt}'], { text: true, file: true, image: true, document: true, writeFiles: false, runShell: false });
    case 'grok':
      return makeCliAdapter('grok', ['--no-auto-update', '--permission-mode', 'dontAsk', '--sandbox', 'read-only', '--output-format', 'plain', '-p', '{prompt}'], { text: true, file: true, image: true, document: true, writeFiles: false, runShell: false });
    case 'antigravity':
      return makeCliAdapter(
        'antigravity',
        (agent) => [
          ...(agent.model ? ['--agent', agent.model] : []),
          '--dangerously-skip-permissions',
          '--print-timeout',
          `${Math.max(1, Math.ceil((agent.timeout_ms || 180000) / 1000))}s`,
          '--print',
          '{prompt}',
        ],
        { text: true, file: true, image: false, document: true, writeFiles: false, runShell: false },
        {},
      );
    case 'codex':
      return makeCliAdapter('codex', ['exec', '{prompt}'], { text: true, file: true, image: false, document: true, writeFiles: true, runShell: true });
    default:
      return makeCliAdapter('generic', ['{prompt}'], { text: true, file: true, image: false, document: true, writeFiles: false, runShell: false });
  }
}

export function formatRunMarkdown(run: RunRecord): string {
  const usageLines = run.usage
    ? [
        `- Prompt Tokens: ${run.usage.promptTokens} (${run.usage.estimated ? 'estimated' : 'exact'})`,
        `- Completion Tokens: ${run.usage.completionTokens} (${run.usage.estimated ? 'estimated' : 'exact'})`,
        `- Total Tokens: ${run.usage.totalTokens}`,
        `- Estimated Cost: $${run.usage.estimatedCostUsd.toFixed(5)} USD`,
      ]
    : [];

  return [
    `# Codeck Run ${run.id}`,
    `- Date: ${run.date}`,
    `- Host: \`${run.host}\``,
    `- Mode: \`${run.mode}\``,
    `- Executor: \`${run.executor}\``,
    `- Agent: \`${run.agent}\``,
    ...(run.adapter ? [`- Adapter: \`${run.adapter}\``] : []),
    ...(run.model ? [`- Model: \`${run.model}\``] : []),
    `- Exit Code: ${run.exitCode}`,
    `- Context Chars: ${run.contextSummary.chars}`,
    ...usageLines,
    ``,
    `## Task`,
    '```text',
    run.task,
    '```',
    ``,
    `## Output`,
    run.output || '(no output)',
    run.error ? `\n## Errors\n\`\`\`text\n${run.error}\n\`\`\`` : '',
  ].join('\n');
}
