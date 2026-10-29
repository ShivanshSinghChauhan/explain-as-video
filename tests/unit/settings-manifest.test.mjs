import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeSettings, saveSettings, loadSettings, maskKey, DEFAULT_SETTINGS } from '../../extension/src/lib/settings.js';
import { frameAt, pickMimeType } from '../../extension/src/player/recorder.js';
import { buildTimeline } from '../../extension/src/lib/captions.js';
import { buildDemoStoryboard } from '../../extension/src/lib/demo.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])),
    set: async (obj) => Object.assign(data, obj),
  };
}

test('defaults to offline demo mode', () => {
  assert.equal(DEFAULT_SETTINGS.mode, 'demo');
  assert.deepEqual(sanitizeSettings(undefined), { ...DEFAULT_SETTINGS });
});

test('gemini mode requires both a key and the data-sharing acknowledgement', () => {
  assert.equal(sanitizeSettings({ mode: 'gemini', apiKey: 'k'.repeat(30) }).mode, 'demo');
  assert.equal(sanitizeSettings({ mode: 'gemini', sharingAcknowledged: true }).mode, 'demo');
  assert.equal(sanitizeSettings({ mode: 'gemini', apiKey: 'k'.repeat(30), sharingAcknowledged: true }).mode, 'gemini');
});

test('rejects bad values from storage', () => {
  const s = sanitizeSettings({ mode: 'evil', model: '../x', rate: 99, captions: 'yes', sharingAcknowledged: 'true', apiKey: 5 });
  assert.equal(s.mode, 'demo');
  assert.equal(s.model, DEFAULT_SETTINGS.model);
  assert.equal(s.rate, 1.5);
  assert.equal(s.captions, true);
  assert.equal(s.sharingAcknowledged, false);
  assert.equal(s.apiKey, '');
});

test('save/load round trip through storage', async () => {
  const store = memoryStorage();
  await saveSettings({ apiKey: '  abcdefghijklmnopqrstuvwxyz  ', sharingAcknowledged: true, mode: 'gemini' }, store);
  const s = await loadSettings(store);
  assert.equal(s.apiKey, 'abcdefghijklmnopqrstuvwxyz');
  assert.equal(s.mode, 'gemini');
});

test('maskKey never reveals the whole key', () => {
  const k = 'AIzaSyD-1234567890abcdef';
  assert.equal(maskKey(k), 'AIza••••cdef');
  assert.ok(!maskKey('short').includes('short'));
  assert.equal(maskKey(''), '');
});

test('manifest asks for minimal permissions', () => {
  const m = JSON.parse(readFileSync(new URL('../../extension/manifest.json', import.meta.url)));
  assert.equal(m.manifest_version, 3);
  assert.deepEqual([...m.permissions].sort(), ['activeTab', 'contextMenus', 'scripting', 'storage']);
  assert.equal(m.host_permissions, undefined, 'no host access at install time');
  assert.equal(m.content_scripts, undefined, 'floating button is opt-in');
  assert.ok(m.optional_host_permissions.includes('https://generativelanguage.googleapis.com/*'));
  assert.ok(!JSON.stringify(m).includes('<all_urls>'));
});

test('recorder frame lookup matches the timeline', () => {
  const sb = buildDemoStoryboard('Volcanoes form where magma reaches the surface. Lava cools into new rock. Eruptions can be explosive or gentle.');
  const tl = buildTimeline(sb);
  assert.equal(frameAt(tl, 0).sceneIndex, 0);
  assert.equal(frameAt(tl, 0).caption, ''); // lead-in before narration
  const firstCue = tl.scenes[0].cues[0];
  assert.equal(frameAt(tl, firstCue.start + 1).caption, firstCue.text);
  assert.equal(frameAt(tl, tl.scenes[1].start + 1).sceneIndex, 1);
  assert.equal(frameAt(tl, tl.duration + 5000).sceneIndex, sb.scenes.length - 1);
});

test('WebM mime selection prefers vp9 and degrades gracefully', () => {
  assert.equal(pickMimeType({ isTypeSupported: () => true }), 'video/webm;codecs=vp9');
  assert.equal(pickMimeType({ isTypeSupported: (m) => m === 'video/webm' }), 'video/webm');
  assert.equal(pickMimeType({ isTypeSupported: () => false }), '');
  assert.equal(pickMimeType(undefined), '');
});

test('theme setting accepts only known themes', async () => {
  const { THEMES } = await import('../../extension/src/player/renderer.js');
  assert.ok(Object.keys(THEMES).length >= 5);
  assert.equal(sanitizeSettings({ theme: 'paper' }).theme, 'paper');
  assert.equal(sanitizeSettings({ theme: 'constructor' }).theme, DEFAULT_SETTINGS.theme);
  assert.equal(sanitizeSettings({ theme: '__proto__' }).theme, DEFAULT_SETTINGS.theme);
  for (const t of Object.values(THEMES)) {
    for (const k of ['bg1', 'bg2', 'fg', 'muted', 'accent', 'accent2', 'accent3', 'card', 'chipFg']) assert.ok(t[k], `${t.label} missing ${k}`);
  }
});
