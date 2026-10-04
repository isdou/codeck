import fs from 'fs';
const packageMetadata = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
if (!packageMetadata.version) {
    throw new Error('Codeck package version is missing.');
}
export const VERSION = packageMetadata.version;
const LATEST_VERSION_URL = 'https://raw.githubusercontent.com/isdou/codeck/main/plugin.json';
const UPDATE_CHECK_TTL_MS = 6 * 60 * 60 * 1000;
let updateCache;
export function isNewerVersion(latest, current) {
    const parse = (value) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim())?.slice(1).map(Number);
    const next = parse(latest);
    const installed = parse(current);
    if (!next || !installed)
        return false;
    for (let index = 0; index < 3; index += 1) {
        if (next[index] !== installed[index])
            return next[index] > installed[index];
    }
    return false;
}
export async function getUpdateNotice(request = fetch) {
    if (process.env.CODECK_DISABLE_UPDATE_CHECK === '1')
        return undefined;
    if (updateCache && updateCache.expiresAt > Date.now())
        return updateCache.notice;
    let notice;
    try {
        const response = await request(LATEST_VERSION_URL, { signal: AbortSignal.timeout(1500) });
        if (response.ok) {
            const latest = String((await response.json()).version || '');
            if (isNewerVersion(latest, VERSION)) {
                notice = `Codeck ${latest} is available (current ${VERSION}). Update the Codeck plugin and restart Codex.`;
            }
        }
    }
    catch {
        // Update checks are advisory and must never affect a routed task.
    }
    updateCache = { expiresAt: Date.now() + UPDATE_CHECK_TTL_MS, notice };
    return notice;
}
