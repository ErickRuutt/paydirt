// "Build" for a no-bundler Express app: syntax-check every module, syntax-check the inline <script>
// blocks in public/*.html, and import every server module so load-order errors fail here, not in prod.
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Script } from 'node:vm';
import { pathToFileURL } from 'node:url';

const dirs = ['src', 'scripts', 'scripts/lib', 'public'];
let n = 0;
for (const d of dirs) for (const f of readdirSync(d)) if (f.endsWith('.js')) { execFileSync(process.execPath, ['--check', `${d}/${f}`]); n++; }

let inline = 0;
for (const f of readdirSync('public').filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(`public/${f}`, 'utf8');
  for (const [, attrs, body] of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    if (/\bsrc=|type="(?!text\/javascript|module)/.test(attrs ?? '') || !body.trim()) continue;
    try { new Script(body, { filename: `public/${f} (inline script)` }); inline++; }
    catch (e) { console.error(`public/${f}: inline script: ${e.message}`); process.exit(1); }
  }
}

// Importing runs each module's top level (a constant used before it's defined fails here).
// No network: the pool connects lazily, and VERCEL=1 stops server.js from listening.
process.env.DATABASE_URL ??= 'postgres://check:check@localhost:5432/check';
process.env.VERCEL ??= '1';
const mods = readdirSync('src').filter((f) => f.endsWith('.js'));
for (const f of mods) await import(pathToFileURL(`src/${f}`).href);
console.log(`Syntax OK: ${n} files, ${inline} inline scripts. Imported ${mods.length} server modules.`);
process.exit(0);
