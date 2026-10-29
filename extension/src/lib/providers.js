// Gemini API client for the storyboard step. Pure fetch, no SDK.
// Pricing / free-tier limits were checked on 2026-10-29 — see docs/PRICING.md.

import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';
import { parseStoryboard, StoryboardError } from './storyboard.js';

export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
export const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com/*';
export const GEMINI_MODELS = Object.freeze([
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (default, fastest)' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (better quality, slower)' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (older)' },
]);
export const DEFAULT_MODEL = GEMINI_MODELS[0].id;
export const DEFAULT_TIMEOUT_MS = 30000;

export class ProviderError extends Error {
  /**
   * code: no_key | invalid_key | permission | rate_limited | timeout | network |
   *       server | bad_request | model_not_found | blocked | truncated | malformed | aborted
   */
  constructor(code, message, { status = 0, retryAfterMs = 0 } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export function isValidModelId(id) {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9.-]{2,60}$/.test(id);
}

export function looksLikeApiKey(key) {
  return typeof key === 'string' && /^[A-Za-z0-9_-]{20,100}$/.test(key.trim());
}

export function buildGeminiRequest({ apiKey, model, text }) {
  if (!isValidModelId(model)) throw new ProviderError('bad_request', `Invalid model name "${String(model).slice(0, 40)}".`);
  return {
    // The key goes in a header, never the URL, so it can't leak into logs/history.
    url: `${GEMINI_ENDPOINT}/${model}:generateContent`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: buildUserPrompt(text) }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 4096 },
      }),
    },
  };
}

/** "30s" / "1.5s" from Google RetryInfo, or a Retry-After header in seconds. */
export function parseRetryAfterMs(body, headerValue) {
  const details = body?.error?.details;
  if (Array.isArray(details)) {
    for (const d of details) {
      const m = typeof d?.retryDelay === 'string' && d.retryDelay.match(/^(\d+(?:\.\d+)?)s$/);
      if (m) return Math.round(parseFloat(m[1]) * 1000);
    }
  }
  const secs = Number(headerValue);
  return Number.isFinite(secs) && secs > 0 ? Math.round(secs * 1000) : 0;
}

export function mapHttpError(status, body, retryAfterHeader) {
  const apiMsg = typeof body?.error?.message === 'string' ? body.error.message.slice(0, 300) : '';
  const apiStatus = body?.error?.status || '';
  if (status === 429 || apiStatus === 'RESOURCE_EXHAUSTED') {
    const retryAfterMs = parseRetryAfterMs(body, retryAfterHeader);
    const wait = retryAfterMs ? ` Try again in about ${Math.ceil(retryAfterMs / 1000)} seconds.` : ' Wait a minute and try again.';
    return new ProviderError('rate_limited',
      `Rate limit or free-tier quota reached.${wait} Daily quotas reset at midnight Pacific time. You can use Demo mode meanwhile.`,
      { status, retryAfterMs });
  }
  if (status === 400 && /api key/i.test(apiMsg)) return new ProviderError('invalid_key', 'The API key was rejected. Check it in Settings.', { status });
  if (status === 401) return new ProviderError('invalid_key', 'The API key was rejected. Check it in Settings.', { status });
  if (status === 403) return new ProviderError('permission', `The API key is not allowed to use this model or API (403). ${apiMsg}`.trim(), { status });
  if (status === 404) return new ProviderError('model_not_found', 'That model was not found. Pick another model in Settings.', { status });
  if (status >= 500) return new ProviderError('server', `Gemini had a server problem (${status}). Try again shortly.`, { status });
  return new ProviderError('bad_request', `Request failed (${status}). ${apiMsg}`.trim(), { status });
}

/** Get the text out of a generateContent reply or explain why there is none. */
export function extractGeminiText(json) {
  const block = json?.promptFeedback?.blockReason;
  if (block) throw new ProviderError('blocked', `Gemini declined this text (${String(block).slice(0, 40)}). Try a different selection or Demo mode.`);
  const cand = Array.isArray(json?.candidates) ? json.candidates[0] : null;
  if (!cand) throw new ProviderError('malformed', 'Gemini returned no answer.');
  const text = (cand.content?.parts || [])
    .filter((p) => typeof p?.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
  if (cand.finishReason === 'SAFETY' || cand.finishReason === 'PROHIBITED_CONTENT') {
    throw new ProviderError('blocked', 'Gemini stopped for safety reasons. Try a different selection or Demo mode.');
  }
  if (!text) {
    if (cand.finishReason === 'MAX_TOKENS') throw new ProviderError('truncated', 'The answer was cut off before any text was produced.');
    throw new ProviderError('malformed', 'Gemini returned an empty answer.');
  }
  return { text, finishReason: cand.finishReason || '' };
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new ProviderError('aborted', 'Cancelled.')); }, { once: true });
});

async function callOnce({ apiKey, model, text, fetchImpl, timeoutMs, signal }) {
  const { url, init } = buildGeminiRequest({ apiKey, model, text });
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    let res;
    try {
      res = await fetchImpl(url, { ...init, signal: ctrl.signal });
    } catch (e) {
      if (signal?.aborted) throw new ProviderError('aborted', 'Cancelled.');
      if (timedOut) throw new ProviderError('timeout', `Gemini did not answer within ${Math.round(timeoutMs / 1000)} seconds.`);
      throw new ProviderError('network', 'Could not reach Gemini. Check your internet connection.');
    }
    let body = null;
    let raw = '';
    try {
      raw = await res.text();
      body = raw ? JSON.parse(raw) : null;
    } catch {
      if (timedOut) throw new ProviderError('timeout', `Gemini did not answer within ${Math.round(timeoutMs / 1000)} seconds.`);
      if (!res.ok) throw mapHttpError(res.status, null, res.headers?.get?.('retry-after'));
      throw new ProviderError('malformed', 'Gemini returned a response that was not JSON.');
    }
    if (!res.ok) throw mapHttpError(res.status, body, res.headers?.get?.('retry-after'));
    return extractGeminiText(body);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Ask Gemini for a storyboard and validate it.
 * Retries once on server errors / timeouts and once on a malformed storyboard.
 * Never retries rate limits or auth errors automatically.
 */
export async function generateStoryboard({
  apiKey, model = DEFAULT_MODEL, text, fetchImpl = globalThis.fetch?.bind(globalThis),
  timeoutMs = DEFAULT_TIMEOUT_MS, signal, retryDelayMs = 1500,
}) {
  if (!apiKey) throw new ProviderError('no_key', 'No API key saved. Add one in Settings or use Demo mode.');
  let serverRetries = 1;
  let formatRetries = 1;
  for (;;) {
    try {
      const { text: reply, finishReason } = await callOnce({ apiKey, model, text, fetchImpl, timeoutMs, signal });
      try {
        return parseStoryboard(reply);
      } catch (e) {
        if (!(e instanceof StoryboardError)) throw e;
        if (finishReason === 'MAX_TOKENS') throw new ProviderError('truncated', 'The storyboard was cut off (too long). Try a shorter selection.');
        throw new ProviderError('malformed', `The model reply could not be used: ${e.message}`);
      }
    } catch (e) {
      const err = e instanceof ProviderError ? e : new ProviderError('malformed', String(e?.message || e));
      if ((err.code === 'server' || err.code === 'timeout') && serverRetries-- > 0) {
        await sleep(retryDelayMs, signal);
        continue;
      }
      if (err.code === 'malformed' && formatRetries-- > 0) continue;
      throw err;
    }
  }
}
