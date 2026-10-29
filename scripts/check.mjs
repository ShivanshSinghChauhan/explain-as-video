// Static checks with no dependencies:
//  - every JS file parses (node --check; ES modules checked as modules)
//  - manifest references existing files and asks for no required host access
//  - no HTML-injection / eval sinks, no inline scripts, no remote code
//  - no invisible/bidi Unicode characters hidden in source
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ext = join(root, 'extension');
const failures = [];
const fail = (m) => failures.push(m);

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(ext);

for (const f of files) {
  const rel = relative(root, f);
  const name = f.split('/').pop();
  if (name.startsWith('_') || name.startsWith('.')) fail(`${rel}: Chrome refuses files starting with "_"/"." in an extension`);
  if (!['.js', '.html', '.css', '.json'].includes(extname(f))) continue;
  const src = readFileSync(f, 'utf8');
  if (/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/.test(src)) fail(`${rel}: contains invisible/bidi Unicode characters`);
  if (extname(f) === '.js') {
    try {
      // content.js is a classic script; everything else is an ES module.
      const tmpExt = name === 'content.js' ? [] : ['--input-type=module'];
      execFileSync(process.execPath, ['--check', ...tmpExt], { input: src, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      fail(`${rel}: syntax error\n${e.stderr}`);
    }
    for (const [re, what] of [
      [/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write\(/, 'HTML injection sink'],
      [/\beval\(|new Function\(|setTimeout\(\s*['"`]/, 'dynamic code execution'],
      [/import\(\s*['"`]https?:|<script[^>]+src=["']https?:/, 'remote code'],
    ]) if (re.test(src)) fail(`${rel}: ${what}`);
  }
  if (extname(f) === '.html') {
    if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(src)) fail(`${rel}: inline <script> (blocked by MV3 CSP)`);
    if (/\son[a-z]+\s*=/i.test(src)) fail(`${rel}: inline event handler attribute`);
    for (const m of src.matchAll(/(?:src|href)="([^"#:]+)"/g)) {
      if (!existsSync(join(f, '..', m[1]))) fail(`${rel}: missing referenced file ${m[1]}`);
    }
  }
}

const manifest = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) fail('manifest: not MV3');
if (manifest.host_permissions?.length) fail(`manifest: required host_permissions present: ${manifest.host_permissions}`);
if (manifest.content_scripts?.length) fail('manifest: static content_scripts run on every page; use optional registration');
const allowed = new Set(['contextMenus', 'storage', 'activeTab', 'scripting']);
for (const p of manifest.permissions || []) if (!allowed.has(p)) fail(`manifest: unexpected permission "${p}"`);
const csp = manifest.content_security_policy?.extension_pages || '';
if (/unsafe-eval|unsafe-inline|https?:/.test(csp)) fail(`manifest: weak CSP "${csp}"`);
const refs = [
  manifest.background?.service_worker, manifest.options_page,
  ...Object.values(manifest.icons || {}), ...Object.values(manifest.action?.default_icon || {}),
];
for (const r of refs) if (r && !existsSync(join(ext, r))) fail(`manifest: missing file ${r}`);
// Files the background registers dynamically.
if (!existsSync(join(ext, 'src/content.js'))) fail('missing src/content.js');

if (failures.length) {
  console.error(`✗ ${failures.length} problem(s):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`✓ static checks passed (${files.length} files)`);
