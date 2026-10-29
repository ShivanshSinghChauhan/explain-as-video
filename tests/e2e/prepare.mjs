// Playwright globalSetup: copy extension/ to .e2e-build/ with a test-only
// manifest. Automation can't click Chrome's permission prompts, so the test
// build pre-grants the Gemini origin and declares the floating-button script
// for the localhost fixture server only. The shipped manifest is untouched.
import { cpSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const E2E_DIR = fileURLToPath(new URL('../../.e2e-build/', import.meta.url));

export default function prepare() {
  const src = fileURLToPath(new URL('../../extension/', import.meta.url));
  rmSync(E2E_DIR, { recursive: true, force: true });
  cpSync(src, E2E_DIR, { recursive: true });
  const m = JSON.parse(readFileSync(`${E2E_DIR}manifest.json`, 'utf8'));
  m.host_permissions = ['https://generativelanguage.googleapis.com/*', 'http://localhost/*'];
  m.content_scripts = [{ matches: ['http://localhost/*'], js: ['src/content.js'], run_at: 'document_idle' }];
  writeFileSync(`${E2E_DIR}manifest.json`, JSON.stringify(m, null, 2));
}
