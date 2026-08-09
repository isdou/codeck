import fs from 'fs';
const packageMetadata = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
if (!packageMetadata.version) {
    throw new Error('Codeck package version is missing.');
}
export const VERSION = packageMetadata.version;
