// Settings stored in chrome.storage.local. The API key is stored unencrypted
// on this device's Chrome profile; the options page explains what that means.

import { DEFAULT_MODEL, isValidModelId } from './providers.js';
import { THEMES, DEFAULT_THEME } from '../player/renderer.js';

export const DEFAULT_SETTINGS = Object.freeze({
  mode: 'demo', // 'demo' (offline) | 'gemini'
  apiKey: '',
  model: DEFAULT_MODEL,
  sharingAcknowledged: false, // user accepted that selected text is sent to Google
  floatingButton: false, // needs the optional "all sites" permission
  rate: 1,
  voiceURI: '',
  captions: true,
  theme: DEFAULT_THEME, // slide/video look, see THEMES in player/renderer.js
});

export function sanitizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return s;
  if (raw.mode === 'demo' || raw.mode === 'gemini') s.mode = raw.mode;
  if (typeof raw.apiKey === 'string') s.apiKey = raw.apiKey.trim().slice(0, 200);
  if (isValidModelId(raw.model)) s.model = raw.model;
  s.sharingAcknowledged = raw.sharingAcknowledged === true;
  s.floatingButton = raw.floatingButton === true;
  const rate = Number(raw.rate);
  if (Number.isFinite(rate)) s.rate = Math.min(1.5, Math.max(0.5, rate));
  if (typeof raw.voiceURI === 'string') s.voiceURI = raw.voiceURI.slice(0, 200);
  if (typeof raw.captions === 'boolean') s.captions = raw.captions;
  if (typeof raw.theme === 'string' && Object.hasOwn(THEMES, raw.theme)) s.theme = raw.theme;
  // Gemini mode is only usable with a key and an explicit data-sharing acknowledgement.
  if (s.mode === 'gemini' && (!s.apiKey || !s.sharingAcknowledged)) s.mode = 'demo';
  return s;
}

export async function loadSettings(storage = globalThis.chrome?.storage?.local) {
  const raw = await storage.get(Object.keys(DEFAULT_SETTINGS));
  return sanitizeSettings(raw);
}

export async function saveSettings(patch, storage = globalThis.chrome?.storage?.local) {
  const current = await loadSettings(storage);
  const next = sanitizeSettings({ ...current, ...patch });
  await storage.set(next);
  return next;
}

/** Shown in the UI instead of the key itself. */
export function maskKey(key) {
  if (!key) return '';
  return key.length <= 8 ? '••••' : `${key.slice(0, 4)}••••${key.slice(-4)}`;
}
