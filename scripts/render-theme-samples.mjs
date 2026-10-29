// Renders docs/themes/<theme>.jpg and docs/themes/overview.jpg with the
// real extension (offline demo storyboard) in Playwright's Chromium.
// Usage: npm run samples
import { chromium } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import prepare, { E2E_DIR } from '../tests/e2e/prepare.mjs';

const out = fileURLToPath(new URL('../docs/themes/', import.meta.url));
mkdirSync(out, { recursive: true });
prepare();

const SAMPLE = {
  title: 'How tides work',
  scenes: [
    { heading: 'Why the sea rises and falls', narration: 'Tides are the regular rise and fall of the sea.', visual: 'title', bullets: [] },
    { heading: 'The Moon makes two bulges', narration: 'The Moon pulls water into two bulges.', visual: 'flow', bullets: ['Moon pulls the ocean', 'Water bulges on both sides', 'Earth rotates through them'] },
    { heading: 'Spring vs neap tides', narration: 'Sun and Moon can add up or partly cancel.', visual: 'compare', bullets: ['Sun and Moon aligned: extra-high spring tides', 'At right angles: gentler neap tides'] },
    { heading: 'Key terms', narration: 'Remember these words.', visual: 'keyword', bullets: ['Gravity', 'Bulge', 'Spring tide', 'Neap tide'] },
  ],
};

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'eav-samples-')), {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${E2E_DIR}`, `--load-extension=${E2E_DIR}`],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
const page = await ctx.newPage();
await page.goto(`chrome-extension://${extId}/src/player/player.html`);
const result = await page.evaluate(async ({ id, sb }) => {
  const { drawSlide, THEMES, WIDTH, HEIGHT } = await import(`chrome-extension://${id}/src/player/renderer.js`);
  const names = Object.keys(THEMES);
  const files = {};
  const sheet = document.createElement('canvas');
  const tw = 480;
  const th = 270;
  sheet.width = tw * sb.scenes.length + 20 * (sb.scenes.length + 1);
  sheet.height = (th + 50) * names.length + 20;
  const sc = sheet.getContext('2d');
  sc.fillStyle = '#ffffff';
  sc.fillRect(0, 0, sheet.width, sheet.height);
  const c = document.createElement('canvas');
  c.width = WIDTH;
  c.height = HEIGHT;
  const cx = c.getContext('2d');
  names.forEach((name, row) => {
    sc.fillStyle = '#111827';
    sc.font = '600 26px system-ui, sans-serif';
    sc.fillText(THEMES[name].label, 20, row * (th + 50) + 42);
    sb.scenes.forEach((_, i) => {
      drawSlide(cx, { storyboard: sb, index: i, theme: name });
      if (i === 1) files[`${name}.jpg`] = c.toDataURL('image/jpeg', 0.88); // one full-size sample per theme
      sc.drawImage(c, 20 + i * (tw + 20), row * (th + 50) + 60, tw, th);
    });
  });
  files['overview.jpg'] = sheet.toDataURL('image/jpeg', 0.88);
  return files;
}, { id: extId, sb: SAMPLE });
for (const [name, url] of Object.entries(result)) writeFileSync(join(out, name), Buffer.from(url.split(',')[1], 'base64'));
console.log(`wrote ${Object.keys(result).length} images to ${out}`);
await ctx.close();
