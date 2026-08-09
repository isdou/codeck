import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
const ARCHIVE_VERSION = 1;
const PAYLOAD_FIELDS = ['prompt', 'invocationPrompt', 'contextSnapshot', 'output', 'partialOutput', 'stderr'];
function nowIso() {
    return new Date().toISOString();
}
function hashText(value) {
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}
function archiveDir(cwd) {
    return path.join(cwd, '.codeck', 'archive');
}
function safePayloadPrefix(id) {
    return id.replace(/[^A-Za-z0-9._-]/g, '_');
}
export function archiveDatabasePath(cwd = process.cwd()) {
    return path.join(cwd, '.codeck', 'archive.sqlite3');
}
function fallbackPath(cwd) {
    return path.join(cwd, '.codeck', 'archive.json');
}
function ensureArchiveDirs(cwd) {
    fs.mkdirSync(archiveDir(cwd), { recursive: true, mode: 0o700 });
    fs.chmodSync(archiveDir(cwd), 0o700);
    fs.mkdirSync(path.join(archiveDir(cwd), 'payloads'), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.join(archiveDir(cwd), 'payloads'), 0o700);
}
function atomicWrite(filePath, content) {
    const tempPath = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    fs.writeFileSync(tempPath, content, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, filePath);
    fs.chmodSync(filePath, 0o600);
}
function openSqlite(cwd) {
    try {
        // node:sqlite is available in modern Node releases. The fallback keeps the
        // archive usable on older Node versions without adding a native dependency.
        const require = createRequire(import.meta.url);
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(archiveDatabasePath(cwd));
        db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS archive_runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        executor TEXT NOT NULL,
        mode TEXT NOT NULL,
        task TEXT NOT NULL,
        curated INTEGER NOT NULL DEFAULT 0,
        tags_json TEXT NOT NULL DEFAULT '[]',
        note TEXT NOT NULL DEFAULT '',
        record_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_archive_runs_updated ON archive_runs(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_archive_runs_status ON archive_runs(status);
      CREATE INDEX IF NOT EXISTS idx_archive_runs_executor ON archive_runs(executor);
      CREATE INDEX IF NOT EXISTS idx_archive_runs_curated ON archive_runs(curated);
    `);
        for (const filePath of [
            archiveDatabasePath(cwd),
            `${archiveDatabasePath(cwd)}-wal`,
            `${archiveDatabasePath(cwd)}-shm`,
        ]) {
            if (fs.existsSync(filePath))
                fs.chmodSync(filePath, 0o600);
        }
        return db;
    }
    catch {
        return null;
    }
}
function readFallback(cwd) {
    const filePath = fallbackPath(cwd);
    if (!fs.existsSync(filePath))
        return [];
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
function writeFallback(cwd, records) {
    ensureArchiveDirs(cwd);
    atomicWrite(fallbackPath(cwd), JSON.stringify(records, null, 2));
}
function defaultStatus(run) {
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
function safeRegex(pattern) {
    try {
        return new RegExp(pattern, 'gi');
    }
    catch {
        return null;
    }
}
const BUILTIN_REDACTIONS = [
    { kind: 'private-key', pattern: /-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g, replacement: '[REDACTED:private-key]' },
    { kind: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, replacement: 'Bearer [REDACTED:token]' },
    { kind: 'openai-key', pattern: /\bsk-[A-Za-z0-9_-]{16,}/g, replacement: '[REDACTED:api-key]' },
    { kind: 'google-key', pattern: /\bAIza[A-Za-z0-9_-]{20,}/g, replacement: '[REDACTED:api-key]' },
    { kind: 'github-token', pattern: /\b(?:ghp|gho|ghs|ghr)_[A-Za-z0-9_]{20,}/g, replacement: '[REDACTED:github-token]' },
    { kind: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{12,}/g, replacement: '[REDACTED:slack-token]' },
    { kind: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[REDACTED:aws-key]' },
    { kind: 'secret-assignment', pattern: /(?:api[_-]?key|access[_-]?key|secret|token|password|passwd|authorization)\s*[:=]\s*["']?[^\s"',;]+/gi, replacement: '[REDACTED:secret]' },
];
function redactText(value, config) {
    if (!config.redact || !value)
        return { value, count: 0, kinds: [] };
    let redacted = value;
    let count = 0;
    const kinds = new Set();
    for (const rule of BUILTIN_REDACTIONS) {
        redacted = redacted.replace(rule.pattern, () => {
            count += 1;
            kinds.add(rule.kind);
            return rule.replacement;
        });
    }
    for (const [index, source] of (config.redaction_patterns || []).entries()) {
        const pattern = safeRegex(source);
        if (!pattern)
            continue;
        redacted = redacted.replace(pattern, () => {
            count += 1;
            kinds.add(`custom-${index + 1}`);
            return `[REDACTED:custom-${index + 1}]`;
        });
    }
    return { value: redacted, count, kinds: [...kinds].sort() };
}
function redactRun(run, config) {
    const result = JSON.parse(JSON.stringify(run));
    result.archiveVersion = ARCHIVE_VERSION;
    result.status = defaultStatus(result);
    result.updatedAt ||= nowIso();
    const redactions = [];
    const fields = ['task', 'prompt', 'invocationPrompt', 'contextSnapshot', 'output', 'partialOutput', 'stderr', 'error'];
    for (const field of fields) {
        const value = result[field];
        if (typeof value !== 'string' || !value)
            continue;
        const redacted = redactText(value, config);
        result[field] = redacted.value;
        if (redacted.count)
            redactions.push({ field, count: redacted.count, kinds: redacted.kinds });
    }
    result.redactions = redactions;
    return result;
}
export function redactRunForStorage(run, config) {
    return redactRun(run, config);
}
function externalizePayloads(cwd, run, config) {
    const maxChars = Math.max(1000, config.max_inline_chars || 120000);
    const result = JSON.parse(JSON.stringify(run));
    const refs = { ...(result.payloadRefs || {}) };
    ensureArchiveDirs(cwd);
    for (const field of PAYLOAD_FIELDS) {
        const value = result[field];
        if (typeof value !== 'string' || value.length <= maxChars)
            continue;
        const fileName = `${safePayloadPrefix(result.id)}-${field}.txt`;
        const relativePath = path.join('.codeck', 'archive', 'payloads', fileName);
        const fullPath = path.join(cwd, relativePath);
        atomicWrite(fullPath, value);
        refs[field] = { path: relativePath, sha256: hashText(value), chars: value.length };
        delete result[field];
    }
    if (Object.keys(refs).length)
        result.payloadRefs = refs;
    return result;
}
function cleanupPayloads(cwd, runId, refs = {}) {
    const payloadRoot = path.resolve(archiveDir(cwd), 'payloads');
    if (!fs.existsSync(payloadRoot))
        return;
    const retained = new Set(Object.values(refs).map((ref) => path.basename(ref.path)));
    const prefix = `${safePayloadPrefix(runId)}-`;
    for (const file of fs.readdirSync(payloadRoot)) {
        if (file.startsWith(prefix) && !retained.has(file)) {
            fs.unlinkSync(path.join(payloadRoot, file));
        }
    }
}
function hydratePayloads(cwd, run) {
    const result = JSON.parse(JSON.stringify(run));
    for (const [field, ref] of Object.entries(result.payloadRefs || {})) {
        const fullPath = path.resolve(cwd, ref.path);
        const payloadRoot = path.resolve(archiveDir(cwd), 'payloads');
        if (!fullPath.startsWith(`${payloadRoot}${path.sep}`) || !fs.existsSync(fullPath))
            continue;
        result[field] = fs.readFileSync(fullPath, 'utf8');
    }
    return result;
}
function normalizeRecord(record) {
    return {
        ...record,
        status: defaultStatus(record),
        updatedAt: record.updatedAt || record.completedAt || record.date,
    };
}
function sqliteRecord(row) {
    if (!row || typeof row !== 'object')
        return null;
    const value = row.record_json;
    if (typeof value !== 'string')
        return null;
    try {
        return JSON.parse(value);
    }
    catch {
        return null;
    }
}
export function archiveRun(cwd, run, config) {
    if (!config.enabled)
        return run;
    ensureArchiveDirs(cwd);
    const sanitized = externalizePayloads(cwd, redactRun(run, config), config);
    cleanupPayloads(cwd, sanitized.id, sanitized.payloadRefs);
    const status = defaultStatus(sanitized);
    const updatedAt = sanitized.updatedAt || nowIso();
    sanitized.status = status;
    sanitized.updatedAt = updatedAt;
    const db = openSqlite(cwd);
    if (db) {
        try {
            db.prepare(`
        INSERT INTO archive_runs (id, status, created_at, updated_at, executor, mode, task, curated, tags_json, note, record_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          updated_at = excluded.updated_at,
          executor = excluded.executor,
          mode = excluded.mode,
          task = excluded.task,
          curated = excluded.curated,
          tags_json = excluded.tags_json,
          note = excluded.note,
          record_json = excluded.record_json
      `).run(sanitized.id, status, sanitized.date, updatedAt, sanitized.executor, sanitized.mode, sanitized.task, sanitized.curated ? 1 : 0, JSON.stringify(sanitized.tags || []), sanitized.note || '', JSON.stringify(sanitized));
        }
        finally {
            db.close();
        }
    }
    else {
        const records = readFallback(cwd).filter((item) => item.id !== sanitized.id);
        records.push(sanitized);
        records.sort((a, b) => String(b.updatedAt || b.date).localeCompare(String(a.updatedAt || a.date)));
        writeFallback(cwd, records);
    }
    return sanitized;
}
export function getArchivedRun(cwd, runId) {
    const db = openSqlite(cwd);
    if (db) {
        try {
            const record = sqliteRecord(db.prepare('SELECT record_json FROM archive_runs WHERE id = ?').get(runId));
            return record ? hydratePayloads(cwd, normalizeRecord(record)) : null;
        }
        finally {
            db.close();
        }
    }
    const found = readFallback(cwd).find((item) => item.id === runId);
    return found ? hydratePayloads(cwd, found) : null;
}
export function listArchivedRuns(cwd, filter = {}) {
    const limit = Math.max(1, Math.min(Number(filter.limit) || 50, 200));
    const db = openSqlite(cwd);
    if (db) {
        try {
            const clauses = [];
            const values = [];
            if (filter.status) {
                clauses.push('status = ?');
                values.push(filter.status);
            }
            if (filter.executor) {
                clauses.push('executor = ?');
                values.push(filter.executor);
            }
            if (filter.curated !== undefined) {
                clauses.push('curated = ?');
                values.push(filter.curated ? 1 : 0);
            }
            const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
            const query = filter.query?.toLowerCase();
            const rows = db.prepare(`SELECT record_json FROM archive_runs ${where} ORDER BY updated_at DESC${query ? '' : ' LIMIT ?'}`).all(...values, ...(query ? [] : [limit]));
            const records = rows
                .map(sqliteRecord)
                .filter(Boolean)
                .map((record) => hydratePayloads(cwd, normalizeRecord(record)));
            return (query
                ? records.filter((record) => JSON.stringify(record).toLowerCase().includes(query))
                : records).slice(0, limit);
        }
        finally {
            db.close();
        }
    }
    return readFallback(cwd)
        .map(normalizeRecord)
        .filter((record) => !filter.status || record.status === filter.status)
        .filter((record) => !filter.executor || record.executor === filter.executor)
        .filter((record) => filter.curated === undefined || Boolean(record.curated) === filter.curated)
        .sort((a, b) => String(b.updatedAt || b.date).localeCompare(String(a.updatedAt || a.date)))
        .map((record) => hydratePayloads(cwd, record))
        .filter((record) => !filter.query || JSON.stringify(record).toLowerCase().includes(filter.query.toLowerCase()))
        .slice(0, limit);
}
export function updateArchiveMetadata(cwd, runId, update, config) {
    const current = getArchivedRun(cwd, runId);
    if (!current)
        return null;
    const next = {
        ...current,
        curated: update.curated ?? current.curated,
        tags: update.tags ?? current.tags,
        note: update.note ?? current.note,
        updatedAt: nowIso(),
    };
    archiveRun(cwd, next, config);
    return getArchivedRun(cwd, runId);
}
export function deleteArchivedRun(cwd, runId) {
    const current = getArchivedRun(cwd, runId);
    if (!current)
        return false;
    for (const ref of Object.values(current.payloadRefs || {})) {
        const fullPath = path.resolve(cwd, ref.path);
        const payloadRoot = path.resolve(archiveDir(cwd), 'payloads');
        if (fullPath.startsWith(`${payloadRoot}${path.sep}`) && fs.existsSync(fullPath))
            fs.unlinkSync(fullPath);
    }
    const db = openSqlite(cwd);
    if (db) {
        try {
            db.prepare('DELETE FROM archive_runs WHERE id = ?').run(runId);
        }
        finally {
            db.close();
        }
    }
    else {
        writeFallback(cwd, readFallback(cwd).filter((item) => item.id !== runId));
    }
    return true;
}
export function curateArchivedRun(cwd, runId, update, config) {
    return updateArchiveMetadata(cwd, runId, { ...update, curated: update.curated ?? true }, config);
}
export function exportArchive(cwd, format = 'json', filter = {}) {
    const records = listArchivedRuns(cwd, filter);
    if (format === 'json')
        return JSON.stringify(records, null, 2);
    const lines = ['# Codeck Archive', ''];
    for (const record of records) {
        lines.push(`## ${record.id} · ${record.executor} · ${record.status || 'unknown'}`, '');
        lines.push(`- Date: ${record.date}`, `- Mode: ${record.mode}`, `- Curated: ${record.curated ? 'yes' : 'no'}`, '');
        lines.push('### Task', '', '```text', record.task, '```', '');
        if (record.output)
            lines.push('### Output', '', record.output, '');
        if (record.note)
            lines.push('### Note', '', record.note, '');
    }
    return lines.join('\n').trim() + '\n';
}
export function importLegacyRuns(cwd, config) {
    const dir = path.join(cwd, '.codeck', 'runs');
    if (!fs.existsSync(dir))
        return 0;
    let imported = 0;
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.json'))) {
        try {
            const record = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
            if (!getArchivedRun(cwd, record.id)) {
                archiveRun(cwd, record, config);
                imported += 1;
            }
        }
        catch {
            // Ignore malformed legacy files and continue importing the rest.
        }
    }
    return imported;
}
