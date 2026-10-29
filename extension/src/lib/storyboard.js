// Storyboard schema: parsing and strict validation of untrusted model output.
//
// {
//   "title": string,
//   "scenes": [{ "heading": string, "narration": string,
//                "visual": "title"|"bullets"|"flow"|"compare"|"keyword"|"quote",
//                "bullets": string[] }]
// }

import { normalizeText } from './text.js';

export const VISUALS = Object.freeze(['title', 'bullets', 'flow', 'compare', 'keyword', 'quote']);

export const SB_LIMITS = Object.freeze({
  minScenes: 2,
  maxScenes: 7,
  title: 80,
  heading: 70,
  narration: 400,
  bullet: 80,
  maxBullets: 4,
});

export class StoryboardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StoryboardError';
    this.code = 'malformed';
  }
}

/** Pull a JSON object out of a model reply that may contain fences or prose. */
export function extractJson(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new StoryboardError('The model returned an empty response.');
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) throw new StoryboardError('The model response did not contain a JSON object.');
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    throw new StoryboardError('The model response was not valid JSON (it may have been cut off).');
  }
}

/** Plain-text cleanup: strip markup the renderer would show literally, clip length. */
export function cleanString(value, max) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  let s = normalizeText(String(value)).replace(/\n+/g, ' ');
  s = s
    .replace(/<\/?[a-z][^>]*>/gi, '') // stray HTML tags
    .replace(/\*\*|__|`+/g, '') // markdown emphasis / code
    .replace(/^#+\s*/, '') // markdown heading
    .replace(/^[-*•]\s+/, '') // list bullet
    .trim();
  if (s.length > max) {
    const cut = s.slice(0, max - 1);
    const sp = cut.lastIndexOf(' ');
    s = (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:\s]+$/, '') + '…';
  }
  return s;
}

/**
 * Validate and normalise a parsed storyboard. Unknown fields are dropped,
 * bad values are coerced where safe, and hopeless input throws StoryboardError.
 */
export function validateStoryboard(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new StoryboardError('The storyboard is not an object.');
  }
  const warnings = [];
  const rawScenes = Array.isArray(input.scenes) ? input.scenes : null;
  if (!rawScenes) throw new StoryboardError('The storyboard has no "scenes" list.');

  const scenes = [];
  for (const raw of rawScenes) {
    if (!raw || typeof raw !== 'object') continue;
    const narration = cleanString(raw.narration, SB_LIMITS.narration);
    if (!narration) continue;
    let visual = VISUALS.includes(raw.visual) ? raw.visual : 'bullets';
    if (visual !== raw.visual) warnings.push(`Unknown visual "${String(raw.visual).slice(0, 20)}" replaced with "bullets".`);
    const bullets = (Array.isArray(raw.bullets) ? raw.bullets : [])
      .map((b) => cleanString(b, SB_LIMITS.bullet))
      .filter(Boolean)
      .slice(0, SB_LIMITS.maxBullets);
    if (visual === 'compare' && bullets.length < 2) visual = 'bullets';
    if (visual === 'flow' && bullets.length < 2) visual = 'bullets';
    if (visual === 'keyword' && bullets.length < 1) visual = 'quote';
    const heading = cleanString(raw.heading, SB_LIMITS.heading) || cleanString(narration, 40);
    scenes.push({ heading, narration, visual, bullets });
  }

  if (scenes.length > SB_LIMITS.maxScenes) {
    warnings.push(`Trimmed ${scenes.length - SB_LIMITS.maxScenes} extra scene(s).`);
    scenes.length = SB_LIMITS.maxScenes;
  }
  if (scenes.length < SB_LIMITS.minScenes) {
    throw new StoryboardError(`The storyboard needs at least ${SB_LIMITS.minScenes} usable scenes (got ${scenes.length}).`);
  }
  const title = cleanString(input.title, SB_LIMITS.title) || scenes[0].heading || 'Explainer';
  return { storyboard: { title, scenes }, warnings };
}

export function parseStoryboard(raw) {
  return validateStoryboard(extractJson(raw));
}
