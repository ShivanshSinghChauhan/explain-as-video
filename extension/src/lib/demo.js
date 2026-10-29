// Offline "demo mode" storyboard: a small extractive summariser. No network,
// no API key, deterministic for the same input.

import { splitSentences, normalizeText } from './text.js';
import { validateStoryboard } from './storyboard.js';

const STOP = new Set(('a an and are as at be been but by can could did do does for from had has have he her his how i if in into ' +
  'is it its just may more most no not of on or our out over she so such than that the their them then there these they this ' +
  'those to too up was we were what when where which while who why will with would you your also about after all any because ' +
  'before being between both each few other only own same some very one two new used use using like many much make made').split(' '));

function words(s) {
  return (s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || []).filter((w) => w.length > 2 && !STOP.has(w));
}

export function topKeywords(text, n = 4) {
  const freq = new Map();
  const display = new Map();
  for (const m of normalizeText(text).matchAll(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu)) {
    const w = m[0].toLowerCase();
    if (w.length <= 2 || STOP.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
    if (!display.has(w)) display.set(w, m[0]);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || (a[0] < b[0] ? -1 : 1))
    .slice(0, n)
    .map(([w]) => display.get(w));
}

function clip(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.5 ? cut.slice(0, sp) : cut) + '…';
}

export function buildDemoStoryboard(text) {
  const sentences = splitSentences(text).filter((s) => s.length >= 12);
  const pool = sentences.length ? sentences : [normalizeText(text)];
  const keywords = topKeywords(text, 4);
  const kwSet = new Set(keywords.map((k) => k.toLowerCase()));

  // Score sentences by keyword density, keep original order for the story.
  const scored = pool.map((s, i) => {
    const w = words(s);
    const hits = w.filter((x) => kwSet.has(x)).length;
    return { s, i, score: w.length ? hits / Math.sqrt(w.length) + (i === 0 ? 0.5 : 0) : 0 };
  });
  const best = [...scored].sort((a, b) => b.score - a.score || a.i - b.i).slice(0, 4).sort((a, b) => a.i - b.i);

  const title = clip(pool[0].replace(/[.!?]+$/, ''), 60);
  const scenes = [
    { heading: title, visual: 'title', bullets: [], narration: clip(`Here is a quick look at this passage. ${pool[0]}`, 380) },
  ];
  if (keywords.length >= 2) {
    scenes.push({
      heading: 'Key terms', visual: 'keyword', bullets: keywords,
      narration: `The key ideas to watch for are ${keywords.slice(0, -1).join(', ')} and ${keywords[keywords.length - 1]}.`,
    });
  }
  const body = best.filter((b) => b.i !== 0);
  if (body.length >= 2) {
    scenes.push({
      heading: 'Main points', visual: 'bullets',
      bullets: body.slice(0, 3).map((b) => clip(b.s, 70)),
      narration: clip(body.slice(0, 2).map((b) => b.s).join(' '), 380),
    });
  }
  const quote = best[best.length - 1];
  if (quote) scenes.push({ heading: 'In the author’s words', visual: 'quote', bullets: [], narration: clip(quote.s, 300) });
  scenes.push({
    heading: 'Recap', visual: 'bullets',
    bullets: keywords.length ? keywords.slice(0, 3).map((k) => `Remember: ${k}`) : ['Re-read the passage', 'Check the source'],
    narration: 'That is the gist. This demo summary was made offline by picking key sentences, so check the original for nuance.',
  });
  return validateStoryboard({ title, scenes }).storyboard;
}
