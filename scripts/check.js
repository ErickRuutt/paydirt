// "Build" for a no-bundler Express app: syntax-check every module and confirm the server imports.
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const dirs = ['src', 'scripts', 'scripts/lib', 'public'];
let n = 0;
for (const d of dirs) for (const f of readdirSync(d)) if (f.endsWith('.js')) { execFileSync(process.execPath, ['--check', `${d}/${f}`]); n++; }
console.log(`Syntax OK: ${n} files.`);
