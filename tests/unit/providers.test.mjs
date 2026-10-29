import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateStoryboard, buildGeminiRequest, mapHttpError, extractGeminiText, parseRetryAfterMs,
  isValidModelId, looksLikeApiKey, ProviderError,
} from '../../extension/src/lib/providers.js';

const KEY = 'AIzaFAKEKEY_for-tests-000000000000';
const TEXT = 'Selected passage about tides. The moon pulls the oceans. That creates high and low tides.';
const STORYBOARD = {
  title: 'Tides',
  scenes: [
    { heading: 'Tides', narration: 'Why do tides happen?', visual: 'title', bullets: [] },
    { heading: 'Moon', narration: 'The moon pulls the oceans.', visual: 'bullets', bullets: ['Gravity'] },
    { heading: 'Recap', narration: 'High and low tides follow.', visual: 'bullets', bullets: [] },
  ],
};

function reply(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: (h) => headers[h.toLowerCase()] ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}
const success = (text, finishReason = 'STOP') => reply(200, { candidates: [{ content: { parts: [{ text }] }, finishReason }] });

/** Fake fetch that returns queued responses and records calls. */
function fakeFetch(...responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (typeof r === 'function') return r(url, init);
    if (r instanceof Error) throw r;
    return r;
  };
  fn.calls = calls;
  return fn;
}
const opts = (fetchImpl, extra = {}) => ({ apiKey: KEY, model: 'gemini-3.5-flash-lite', text: TEXT, fetchImpl, retryDelayMs: 1, ...extra });

test('request: key goes in a header (not URL), only the confirmed text is sent, JSON mode on', () => {
  const { url, init } = buildGeminiRequest({ apiKey: KEY, model: 'gemini-3.5-flash-lite', text: TEXT });
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
  assert.ok(!url.includes(KEY));
  assert.equal(init.headers['x-goog-api-key'], KEY);
  assert.equal(init.credentials, 'omit');
  const body = JSON.parse(init.body);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.ok(body.contents[0].parts[0].text.includes(TEXT));
  assert.deepEqual(Object.keys(body).sort(), ['contents', 'generationConfig', 'systemInstruction']);
});

test('model ids are validated to block path/URL injection', () => {
  assert.ok(isValidModelId('gemini-3.8-flash'));
  for (const bad of ['../v1/x', 'gemini?key=1', 'Gemini', 'a/b', '', 'x'.repeat(80)]) assert.equal(isValidModelId(bad), false, bad);
  assert.throws(() => buildGeminiRequest({ apiKey: KEY, model: '../evil', text: 'x' }), ProviderError);
});

test('api key shape check', () => {
  assert.ok(looksLikeApiKey(KEY));
  assert.equal(looksLikeApiKey('short'), false);
  assert.equal(looksLikeApiKey('has spaces in it which is wrong ok'), false);
});

test('success path returns a validated storyboard', async () => {
  const f = fakeFetch(success(JSON.stringify(STORYBOARD)));
  const { storyboard } = await generateStoryboard(opts(f));
  assert.equal(storyboard.title, 'Tides');
  assert.equal(f.calls.length, 1);
});

test('no key → no_key without any network call', async () => {
  const f = fakeFetch();
  await assert.rejects(generateStoryboard(opts(f, { apiKey: '' })), { code: 'no_key' });
  assert.equal(f.calls.length, 0);
});

test('HTTP errors map to clear codes and are not retried', async (t) => {
  const cases = [
    [400, { error: { message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }, 'invalid_key'],
    [401, {}, 'invalid_key'],
    [403, { error: { message: 'Permission denied', status: 'PERMISSION_DENIED' } }, 'permission'],
    [404, { error: { message: 'models/x is not found' } }, 'model_not_found'],
    [400, { error: { message: 'Bad thing' } }, 'bad_request'],
  ];
  for (const [status, body, code] of cases) {
    await t.test(`${status} → ${code}`, async () => {
      const f = fakeFetch(reply(status, body));
      await assert.rejects(generateStoryboard(opts(f)), { code });
      assert.equal(f.calls.length, 1);
    });
  }
});

test('429 → rate_limited with retry delay from RetryInfo, no automatic retry', async () => {
  const f = fakeFetch(reply(429, {
    error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded',
      details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37s' }] },
  }));
  const err = await generateStoryboard(opts(f)).catch((e) => e);
  assert.equal(err.code, 'rate_limited');
  assert.equal(err.retryAfterMs, 37000);
  assert.match(err.message, /37 seconds/);
  assert.equal(f.calls.length, 1);
});

test('retry-after header fallback', () => {
  assert.equal(parseRetryAfterMs(null, '12'), 12000);
  assert.equal(parseRetryAfterMs({}, 'garbage'), 0);
  assert.equal(mapHttpError(429, null, '5').retryAfterMs, 5000);
});

test('5xx is retried once, then succeeds', async () => {
  const f = fakeFetch(reply(503, { error: { message: 'overloaded' } }), success(JSON.stringify(STORYBOARD)));
  const { storyboard } = await generateStoryboard(opts(f));
  assert.equal(storyboard.scenes.length, 3);
  assert.equal(f.calls.length, 2);
});

test('5xx twice → server error', async () => {
  const f = fakeFetch(reply(500, 'Internal error'), reply(502, '<html>Bad gateway</html>'));
  await assert.rejects(generateStoryboard(opts(f)), { code: 'server' });
  assert.equal(f.calls.length, 2);
});

test('timeout aborts the request, retries once, then reports timeout', async () => {
  const hang = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  const f = fakeFetch(hang, hang);
  const err = await generateStoryboard(opts(f, { timeoutMs: 30 })).catch((e) => e);
  assert.equal(err.code, 'timeout');
  assert.equal(f.calls.length, 2);
});

test('network failure → network error', async () => {
  const f = fakeFetch(new TypeError('Failed to fetch'));
  await assert.rejects(generateStoryboard(opts(f)), { code: 'network' });
});

test('user cancel → aborted, no retry', async () => {
  const ctrl = new AbortController();
  const hang = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    setTimeout(() => ctrl.abort(), 5);
  });
  const f = fakeFetch(hang);
  await assert.rejects(generateStoryboard(opts(f, { signal: ctrl.signal })), { code: 'aborted' });
  assert.equal(f.calls.length, 1);
});

test('malformed model output is retried once, then reported', async () => {
  const f = fakeFetch(success('Sorry, here is prose not JSON'), success('{"title":"x","scenes":[]}'));
  const err = await generateStoryboard(opts(f)).catch((e) => e);
  assert.equal(err.code, 'malformed');
  assert.equal(f.calls.length, 2);
});

test('malformed first, valid second → succeeds', async () => {
  const f = fakeFetch(success('{"title": "broken"'), success(JSON.stringify(STORYBOARD)));
  const { storyboard } = await generateStoryboard(opts(f));
  assert.equal(storyboard.title, 'Tides');
});

test('non-JSON 200 body → malformed', async () => {
  const f = fakeFetch(reply(200, '<html>captive portal</html>'), reply(200, '<html>captive portal</html>'));
  await assert.rejects(generateStoryboard(opts(f)), { code: 'malformed' });
});

test('safety blocks and truncation are explained', async () => {
  assert.throws(() => extractGeminiText({ promptFeedback: { blockReason: 'SAFETY' } }), { code: 'blocked' });
  assert.throws(() => extractGeminiText({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }), { code: 'blocked' });
  assert.throws(() => extractGeminiText({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] }), { code: 'truncated' });
  assert.throws(() => extractGeminiText({}), { code: 'malformed' });
  const f = fakeFetch(success('{"title":"cut', 'MAX_TOKENS'));
  await assert.rejects(generateStoryboard(opts(f)), { code: 'truncated' });
});

test('thought parts are ignored when extracting text', () => {
  const { text } = extractGeminiText({ candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text: '{"a":1}' }] } }] });
  assert.equal(text, '{"a":1}');
});
