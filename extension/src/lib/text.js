// Text helpers shared by the content script path, the player and the tests.
// Everything here treats input as untrusted plain text.

export const LIMITS = Object.freeze({
  captureMax: 50000, // most characters we ever accept from a page selection
  sendMax: 6000, // most characters sent to the model (or used by demo mode)
  minChars: 20, // selections shorter than this are rejected as too short
});

// C0/C1 control characters except tab and newline, plus zero-width / bidi
// override characters that can be used to hide or reorder text.
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

export function normalizeText(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_RE, '')
    .replace(/[ \t\u00A0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function countWords(text) {
  const t = (text || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

export function splitSentences(text) {
  const t = normalizeText(text);
  if (!t) return [];
  const out = [];
  for (const para of t.split(/\n+/)) {
    const parts = para.match(/[^.!?。！？]+(?:[.!?。！？]+["')\]]*|$)/g) || [para];
    for (const p of parts) {
      const s = p.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

/** Cut text to at most `max` chars, preferring a sentence, then a word boundary. */
export function truncateAtBoundary(text, max) {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const sentenceEnd = Math.max(
    slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '),
    slice.lastIndexOf('.\n'), slice.lastIndexOf('\n\n'),
  );
  if (sentenceEnd > max * 0.5) return slice.slice(0, sentenceEnd + 1).trim();
  const space = slice.lastIndexOf(' ');
  if (space > max * 0.6) return slice.slice(0, space).trim();
  return slice.trim();
}

/**
 * Turn a raw selection into what will actually be shown for review and sent.
 * Returns { ok, text, originalLength, truncated, error }.
 */
export function prepareSelection(raw, { max = LIMITS.sendMax, min = LIMITS.minChars } = {}) {
  const capped = typeof raw === 'string' ? raw.slice(0, LIMITS.captureMax) : '';
  const clean = normalizeText(capped);
  const originalLength = typeof raw === 'string' ? raw.length : 0;
  if (clean.length < min) {
    return {
      ok: false, text: clean, originalLength, truncated: false,
      error: clean.length === 0
        ? 'No text was selected. Highlight some text on the page (or paste it here) and try again.'
        : `The selection is too short (${clean.length} characters). Select at least ${min} characters.`,
    };
  }
  const text = truncateAtBoundary(clean, max);
  return { ok: true, text, originalLength, truncated: text.length < clean.length || originalLength > LIMITS.captureMax };
}

/** Make a safe, short file name stem from an untrusted title. */
export function safeFileStem(title, fallback = 'explainer') {
  const stem = normalizeText(String(title || ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return stem || fallback;
}
