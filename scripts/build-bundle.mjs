import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [path.join(projectRoot, 'src', 'index.ts')],
  outfile: path.join(projectRoot, 'dist', 'codeck.bundle.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['readline/promises'],
  banner: {
    js: "import { createRequire as __codeckCreateRequire } from 'node:module'; const require = __codeckCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
});
