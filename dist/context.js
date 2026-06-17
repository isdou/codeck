import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getDevDeckDir, loadConfig } from './config.js';
function runGitCommand(cmd, cwd) {
    try {
        return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    }
    catch {
        return '';
    }
}
function relPath(cwd, filePath) {
    return path.relative(cwd, path.resolve(cwd, filePath)).replaceAll(path.sep, '/');
}
function matchesPattern(file, pattern) {
    const normalized = file.replaceAll(path.sep, '/');
    if (pattern.endsWith('/**'))
        return normalized.startsWith(pattern.slice(0, -3));
    if (pattern.endsWith('*'))
        return normalized.startsWith(pattern.slice(0, -1));
    return normalized === pattern;
}
function isExcluded(file, excludes) {
    return excludes.some((pattern) => matchesPattern(file, pattern));
}
function readTextFile(cwd, file, maxBytes) {
    const fullPath = path.resolve(cwd, file);
    const relative = relPath(cwd, fullPath);
    try {
        const stat = fs.statSync(fullPath);
        if (!stat.isFile() || stat.size > maxBytes)
            return null;
        const content = fs.readFileSync(fullPath, 'utf8');
        return {
            type: 'file',
            label: relative,
            path: relative,
            content,
            chars: content.length,
        };
    }
    catch {
        return null;
    }
}
function walkFiles(cwd, dir, excludes, maxFiles) {
    const out = [];
    const visit = (relativeDir) => {
        if (out.length >= maxFiles)
            return;
        const absoluteDir = path.join(cwd, relativeDir);
        let entries;
        try {
            entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (out.length >= maxFiles)
                break;
            const relative = path.join(relativeDir, entry.name).replaceAll(path.sep, '/');
            if (isExcluded(relative, excludes))
                continue;
            if (entry.isDirectory())
                visit(relative);
            if (entry.isFile())
                out.push(relative);
        }
    };
    visit(dir);
    return out;
}
function filesForInclude(cwd, include, excludes, maxFiles) {
    if (include === 'current_diff')
        return [];
    if (include.endsWith('/**')) {
        return walkFiles(cwd, include.slice(0, -3), excludes, maxFiles);
    }
    return [include];
}
function pushResource(resources, resource, required = false) {
    if (!resource)
        return;
    if (resources.some((r) => r.label === resource.label && r.type === resource.type))
        return;
    resources.push({ ...resource, required });
}
function markdownFromResources(resources) {
    return resources.map((resource) => {
        if (resource.type === 'diff') {
            return `## ${resource.label}\n\`\`\`diff\n${resource.content}\n\`\`\``;
        }
        if (resource.type === 'file') {
            return `## File: ${resource.label}\n\`\`\`text\n${resource.content}\n\`\`\``;
        }
        return `## ${resource.label}\n\n${resource.content}`;
    }).join('\n\n');
}
function trimResources(resources, maxChars) {
    const kept = [...resources];
    const omitted = [];
    const size = () => markdownFromResources(kept).length;
    while (size() > maxChars && kept.some((r) => !r.required)) {
        const index = kept.map((r) => r.required).lastIndexOf(false);
        const [removed] = kept.splice(index, 1);
        omitted.push(removed.label);
    }
    if (size() <= maxChars) {
        return { resources: kept, omitted, truncated: omitted.length > 0 };
    }
    const last = kept[kept.length - 1];
    if (last) {
        const over = size() - maxChars;
        last.content = last.content.slice(0, Math.max(0, last.content.length - over - 200)) + '\n... [truncated by budget]';
        last.chars = last.content.length;
    }
    return { resources: kept, omitted, truncated: true };
}
export function buildContext(cwd = process.cwd(), options = {}) {
    const config = loadConfig(cwd);
    const contextConfig = config.context;
    const resources = [];
    const isGitRepo = fs.existsSync(path.join(cwd, '.git'));
    pushResource(resources, {
        type: 'text',
        label: 'DevDeck Task',
        content: options.task || '',
        chars: (options.task || '').length,
    }, true);
    const projectPath = path.join(getDevDeckDir(cwd), 'project.md');
    if (fs.existsSync(projectPath)) {
        pushResource(resources, readTextFile(cwd, projectPath, contextConfig.max_file_bytes), true);
    }
    const constraintsPath = path.join(getDevDeckDir(cwd), 'constraints.md');
    if (fs.existsSync(constraintsPath)) {
        pushResource(resources, readTextFile(cwd, constraintsPath, contextConfig.max_file_bytes), true);
    }
    if (isGitRepo) {
        const branch = runGitCommand('git rev-parse --abbrev-ref HEAD', cwd) || 'unknown';
        const recentCommit = runGitCommand('git log -1 --oneline', cwd) || 'no commits';
        const status = runGitCommand('git status --short', cwd);
        pushResource(resources, {
            type: 'text',
            label: 'Repository State',
            content: [`Branch: ${branch}`, `Recent Commit: ${recentCommit}`, status ? `Git Status:\n${status}` : 'Git Status: clean'].join('\n'),
            chars: branch.length + recentCommit.length + status.length,
        }, true);
        if (contextConfig.include_git_diff) {
            const diff = runGitCommand('git diff HEAD -- . ":(exclude).devdeck/context.md" ":(exclude).devdeck/last.md" ":(exclude).devdeck/runs/**" ":(exclude)dist/**"', cwd);
            if (diff) {
                pushResource(resources, { type: 'diff', label: 'Current Diff', content: diff, chars: diff.length });
            }
        }
    }
    if (contextConfig.include_readme) {
        for (const readme of ['README.md', 'readme.md', 'README', 'Readme.md']) {
            const resource = readTextFile(cwd, readme, contextConfig.max_file_bytes);
            if (resource) {
                pushResource(resources, resource, true);
                break;
            }
        }
    }
    const requested = new Set(options.files || []);
    for (const include of options.executor?.context_include || []) {
        for (const file of filesForInclude(cwd, include, contextConfig.exclude, contextConfig.max_files)) {
            requested.add(file);
        }
    }
    for (const file of requested) {
        const relative = relPath(cwd, file);
        if (isExcluded(relative, contextConfig.exclude))
            continue;
        pushResource(resources, readTextFile(cwd, relative, contextConfig.max_file_bytes));
    }
    if (contextConfig.include_agent_files) {
        const agentFiles = fs.readdirSync(cwd)
            .filter((file) => {
            const upper = file.toUpperCase();
            return upper.endsWith('.MD') && (upper.includes('AGENT') || upper.includes('CLAUDE') || upper.includes('GEMINI'));
        })
            .slice(0, contextConfig.max_files);
        for (const file of agentFiles) {
            pushResource(resources, readTextFile(cwd, file, contextConfig.max_file_bytes), true);
        }
    }
    const budget = options.maxChars || config.budget.max_context_chars;
    const trimmed = trimResources(resources, budget);
    const markdown = `# DevDeck Context\n\n${markdownFromResources(trimmed.resources)}`;
    return {
        markdown,
        resources: trimmed.resources,
        summary: {
            chars: markdown.length,
            resourceCount: trimmed.resources.length,
            truncated: trimmed.truncated,
            omitted: trimmed.omitted,
        },
    };
}
export function formatContextToMarkdown(ctx) {
    return ctx.markdown;
}
export function writeContextCache(cwd = process.cwd()) {
    const ctx = buildContext(cwd);
    const md = formatContextToMarkdown(ctx);
    fs.mkdirSync(getDevDeckDir(cwd), { recursive: true });
    fs.writeFileSync(path.join(getDevDeckDir(cwd), 'context.md'), md, 'utf8');
    return md;
}
