// End-to-end: the real extension loaded unpacked into Playwright's Chromium.
// Gemini is never called for real — its endpoint is intercepted with fixtures.
import { test as base, expect, chromium } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { E2E_DIR } from './prepare.mjs';

const FIXTURE = 'http://localhost:4610/article.html';
const GEMINI = 'https://generativelanguage.googleapis.com/**';
const FAKE_KEY = 'AIzaFAKEKEY_e2e_only_0000000000000';

const test = base.extend({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'eav-e2e-')), {
      channel: 'chromium',
      headless: true,
      acceptDownloads: true,
      args: [`--disable-extensions-except=${E2E_DIR}`, `--load-extension=${E2E_DIR}`],
    });
    await use(ctx);
    await ctx.close();
  },
  extId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(new URL(sw.url()).host);
  },
});

async function selectAndClickFloatingButton(page, selector) {
  await page.evaluate((sel) => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(sel));
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, selector);
  // The button lives in a closed shadow root; find its host and click its centre.
  const handle = await page.waitForFunction(() => {
    const host = [...document.body.children].find((el) => el.style.zIndex === '2147483647' && el.style.display === 'block');
    if (!host) return null;
    const r = host.getBoundingClientRect();
    return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
  const { x, y } = await handle.jsonValue();
  const [player] = await Promise.all([page.context().waitForEvent('page'), page.mouse.click(x, y)]);
  await player.waitForLoadState();
  return player;
}

async function openPlayerWith(context, extId, text, settings = {}) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/src/options/options.html`);
  await page.evaluate(async ({ text, settings }) => {
    await chrome.storage.local.set(settings);
    await chrome.storage.session.set({ 'sel:e2e': { text, sourceUrl: 'https://example.com/x', sourceTitle: 'Example', createdAt: Date.now() } });
  }, { text, settings });
  await page.goto(`chrome-extension://${extId}/src/player/player.html#e2e`);
  return page;
}

const geminiSettings = { mode: 'gemini', apiKey: FAKE_KEY, sharingAcknowledged: true, model: 'gemini-3.5-flash-lite' };
const TIDES = 'Tides are the regular rise and fall of the sea, caused mainly by the Moon. Two bulges form, so most coasts get two high tides a day.';
const goodStoryboard = {
  title: 'How tides work',
  scenes: [
    { heading: 'Tides', narration: 'Tides are the rise and fall of the sea.', visual: 'title', bullets: [] },
    { heading: 'Two bulges', narration: 'The Moon pulls water into two bulges.', visual: 'flow', bullets: ['Moon pulls', 'Water bulges', 'Earth rotates'] },
    { heading: 'Spring vs neap', narration: 'Sun and Moon can add up or cancel.', visual: 'compare', bullets: ['Aligned: big tides', 'At right angles: small tides'] },
    { heading: 'Recap', narration: 'Two highs and two lows a day.', visual: 'keyword', bullets: ['Moon', 'Bulges'] },
  ],
};
const geminiReply = (obj) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ candidates: [{ content: { parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] }, finishReason: 'STOP' }] }),
});

test('first install opens the settings page; extension starts in offline demo mode', async ({ context, extId }) => {
  await expect.poll(() => context.pages().some((p) => p.url().includes('options.html')), { timeout: 10000 }).toBe(true);
  const options = context.pages().find((p) => p.url().includes('options.html'));
  await expect(options.locator('#mode-demo')).toBeChecked();
  expect(extId).toBeTruthy();
});

test('select text → floating button → review → demo video plays → exports', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(FIXTURE);
  const player = await selectAndClickFloatingButton(page, '#p1');

  await expect(player.locator('#review')).toBeVisible();
  const reviewed = await player.locator('#selection').inputValue();
  expect(reviewed).toContain('Tides are the regular rise and fall of the sea');
  expect(reviewed).not.toContain('SECRET-NAV-TEXT');
  await expect(player.locator('#source')).toContainText('How tides work');
  await expect(player.locator('#sharing')).toContainText('Nothing leaves your browser');

  const requests = [];
  context.on('request', (r) => { if (!r.url().startsWith('chrome-extension://') && !r.url().startsWith(FIXTURE)) requests.push(r.url()); });

  await player.locator('#generate').click();
  await expect(player.locator('#player')).toBeVisible();
  const scenes = await player.locator('#scene-list li').count();
  expect(scenes).toBeGreaterThanOrEqual(3);
  expect(requests, 'demo mode must not make network requests').toEqual([]);

  // Canvas actually draws something (not a blank frame).
  const distinct = await player.evaluate(() => {
    const c = document.getElementById('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4 * 997) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    return seen.size;
  });
  expect(distinct).toBeGreaterThan(10);

  // Playback: headless Chromium has no voices → timer mode with captions; it should advance scenes.
  await player.locator('#play').click();
  await expect(player.locator('#play')).toContainText('Pause');
  await player.locator('#next').click();
  await expect(player.locator('#scene-label')).toHaveText(/Scene 2 of/);
  await player.locator('#prev').click();
  await player.locator('#play').click();
  await expect(player.locator('#play')).toContainText('Play');

  const [jsonDl] = await Promise.all([player.waitForEvent('download'), player.locator('#dl-json').click()]);
  const json = JSON.parse(readFileSync(await jsonDl.path(), 'utf8'));
  expect(json.scenes.length).toBe(scenes);
  expect(jsonDl.suggestedFilename()).toMatch(/\.storyboard\.json$/);

  const [vttDl] = await Promise.all([player.waitForEvent('download'), player.locator('#dl-vtt').click()]);
  expect(readFileSync(await vttDl.path(), 'utf8')).toMatch(/^WEBVTT\n\n1\n00:00:00\.300 --> /);
  const [srtDl] = await Promise.all([player.waitForEvent('download'), player.locator('#dl-srt').click()]);
  expect(readFileSync(await srtDl.path(), 'utf8')).toMatch(/^1\n00:00:00,300 --> /);
  const [txtDl] = await Promise.all([player.waitForEvent('download'), player.locator('#dl-txt').click()]);
  expect(readFileSync(await txtDl.path(), 'utf8')).toContain('Generated by: Offline demo');
});

test('hostile page text is shown as plain text and never executed', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(FIXTURE);
  const player = await selectAndClickFloatingButton(page, '#evil');
  await expect(player.locator('#selection')).toHaveValue(/<img src=x onerror=/);
  await player.locator('#generate').click();
  await expect(player.locator('#player')).toBeVisible();
  expect(await player.evaluate(() => ({ imgs: document.querySelectorAll('img').length, pwned: window.__pwned }))).toEqual({ imgs: 0, pwned: undefined });
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
});

test('too-short, empty and expired selections are handled', async ({ context, extId }) => {
  const player = await openPlayerWith(context, extId, 'too short');
  await expect(player.locator('#generate')).toBeDisabled();
  await player.locator('#selection').fill('');
  await expect(player.locator('#generate')).toBeDisabled();
  await player.locator('#selection').fill(TIDES);
  await expect(player.locator('#generate')).toBeEnabled();

  const expired = await context.newPage();
  await expired.goto(`chrome-extension://${extId}/src/player/player.html#does-not-exist`);
  await expect(expired.locator('#notice')).toContainText('expired');
});

test('very long selection is trimmed and the user is told', async ({ context, extId }) => {
  const long = 'The ocean covers most of the planet and drives the climate system. '.repeat(1500);
  const player = await openPlayerWith(context, extId, long);
  await expect(player.locator('#counter')).toContainText('Only the first');
  await player.locator('#generate').click();
  await expect(player.locator('#player')).toBeVisible();
});

test('Gemini: sends only the confirmed text with the key in a header; renders result', async ({ context, extId }) => {
  let captured = null;
  await context.route(GEMINI, async (route) => {
    captured = { url: route.request().url(), headers: route.request().headers(), body: route.request().postDataJSON() };
    await route.fulfill(geminiReply(goodStoryboard));
  });
  const player = await openPlayerWith(context, extId, TIDES, geminiSettings);
  await expect(player.locator('#sharing')).toContainText("sent to Google's Gemini API");
  await player.locator('#generate').click();
  await expect(player.locator('#player')).toBeVisible();
  await expect(player.locator('#sb-title')).toHaveText('How tides work');
  await expect(player.locator('#scene-list li')).toHaveCount(4);

  expect(captured.url).toContain('/models/gemini-3.5-flash-lite:generateContent');
  expect(captured.url).not.toContain(FAKE_KEY);
  expect(captured.headers['x-goog-api-key']).toBe(FAKE_KEY);
  const sent = captured.body.contents[0].parts[0].text;
  expect(sent).toContain(TIDES);
  expect(sent).not.toContain('example.com');

  // Reload uses the cached storyboard instead of spending another request.
  captured = null;
  await player.reload();
  await expect(player.locator('#player')).toBeVisible();
  expect(captured).toBeNull();
});

test('Gemini: rate limit shows wait time, retry is disabled, demo fallback works', async ({ context, extId }) => {
  await context.route(GEMINI, (route) => route.fulfill({
    status: 429, contentType: 'application/json',
    body: JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota', details: [{ retryDelay: '20s' }] } }),
  }));
  const player = await openPlayerWith(context, extId, TIDES, geminiSettings);
  await player.locator('#generate').click();
  await expect(player.locator('#failure-text')).toContainText('Rate limit');
  await expect(player.locator('#retry')).toBeDisabled();
  await expect(player.locator('#retry')).toContainText(/Try again in \d+s/);
  await player.locator('#fallback-demo').click();
  await expect(player.locator('#player')).toBeVisible();
});

test('Gemini: malformed output (twice), bad key and server errors are reported', async ({ context, extId }) => {
  let mode = 'malformed';
  let calls = 0;
  await context.route(GEMINI, (route) => {
    calls++;
    if (mode === 'malformed') return route.fulfill(geminiReply('Sure! Here is a summary of tides, not JSON.'));
    if (mode === 'badkey') return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: 'API key not valid.' } }) });
    return route.fulfill({ status: 503, body: 'unavailable' });
  });
  const player = await openPlayerWith(context, extId, TIDES, geminiSettings);
  await player.locator('#generate').click();
  await expect(player.locator('#failure-text')).toContainText('could not be used');
  expect(calls).toBe(2);

  mode = 'badkey';
  await player.locator('#retry').click();
  await expect(player.locator('#failure-text')).toContainText('API key was rejected');
  await expect(player.locator('#retry')).toHaveText('Open Settings');

  mode = 'server';
  await player.locator('#back').click();
  await player.locator('#generate').click();
  await expect(player.locator('#failure-text')).toContainText('server problem', { timeout: 15000 });
});

test('Gemini: hostile model output is rendered as inert text', async ({ context, extId }) => {
  await context.route(GEMINI, (route) => route.fulfill(geminiReply({
    title: '<img src=x onerror="window.__pwned=1">Title',
    scenes: [
      { heading: '<script>window.__pwned=2</script>', narration: 'javascript:alert(1)', visual: 'title' },
      { heading: 'OK', narration: '<b onmouseover="window.__pwned=3">bold</b> text', visual: 'nonsense', bullets: [{ evil: true }, 'fine'] },
    ],
  })));
  const player = await openPlayerWith(context, extId, TIDES, geminiSettings);
  await player.locator('#generate').click();
  await expect(player.locator('#player')).toBeVisible();
  await expect(player.locator('#sb-title')).toHaveText('Title');
  expect(await player.evaluate(() => ({ s: document.querySelectorAll('script:not([src])').length, img: document.querySelectorAll('img, b').length, p: window.__pwned })))
    .toEqual({ s: 0, img: 0, p: undefined });
});

test('WebM export produces a real (silent) WebM file', async ({ context, extId }) => {
  const player = await openPlayerWith(context, extId, TIDES);
  await player.locator('#generate').click();
  await expect(player.locator('#player')).toBeVisible();
  await expect(player.locator('#dl-webm')).toBeEnabled();
  const result = await player.evaluate(async (id) => {
    const { exportWebM } = await import(`chrome-extension://${id}/src/player/recorder.js`);
    const storyboard = { title: 'T', scenes: [
      { heading: 'A', narration: 'One short line.', visual: 'title', bullets: [] },
      { heading: 'B', narration: 'Two short line.', visual: 'bullets', bullets: ['x'] },
    ] };
    const { blob, mime } = await exportWebM({ storyboard, timeScale: 4 });
    const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    return { size: blob.size, type: blob.type, mime, magic: [...head].map((b) => b.toString(16)).join('') };
  }, extId);
  expect(result.type).toBe('video/webm');
  expect(result.magic).toBe('1a45dfa3'); // EBML header
  expect(result.size).toBeGreaterThan(5000);
});

test('Create slides: themes, navigation, PNG + outline export, switch to video', async ({ context, extId }) => {
  const player = await openPlayerWith(context, extId, TIDES);
  await player.locator('#generate-slides').click();
  await expect(player.locator('#slides')).toBeVisible();
  const n = await player.locator('#thumbs .thumb').count();
  expect(n).toBeGreaterThanOrEqual(3);
  await expect(player.locator('#slide-label')).toHaveText(`Slide 1 of ${n}`);
  await player.keyboard.press('ArrowRight');
  await expect(player.locator('#slide-label')).toHaveText(`Slide 2 of ${n}`);
  await player.locator('#thumbs .thumb').nth(0).click();
  await expect(player.locator('#slide-notes')).not.toBeEmpty();

  const pixel = () => player.evaluate(() => [...document.getElementById('deck-canvas').getContext('2d').getImageData(4, 4, 1, 1).data].slice(0, 3));
  const dark = await pixel();
  await player.locator('#deck-theme').selectOption('paper');
  const light = await pixel();
  expect(dark[0] + dark[1] + dark[2]).toBeLessThan(200);
  expect(light[0] + light[1] + light[2]).toBeGreaterThan(600);
  expect(await player.evaluate(() => chrome.storage.local.get('theme'))).toEqual({ theme: 'paper' });

  const [png] = await Promise.all([player.waitForEvent('download'), player.locator('#dl-png').click()]);
  const bytes = readFileSync(await png.path());
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  expect(bytes.readUInt32BE(16)).toBe(1280);
  const [md] = await Promise.all([player.waitForEvent('download'), player.locator('#dl-md').click()]);
  expect(readFileSync(await md.path(), 'utf8')).toMatch(/^# .+\n\n## 1\. /);

  await player.locator('#to-video').click();
  await expect(player.locator('#player')).toBeVisible();
  await expect(player.locator('#theme')).toHaveValue('paper');
  await player.locator('#to-slides').click();
  await expect(player.locator('#slides')).toBeVisible();
});
