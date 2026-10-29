// Player page controller: review → generate → play → export.
// All page/model text is inserted with textContent; nothing is parsed as HTML.

import { LIMITS, prepareSelection, safeFileStem } from '../lib/text.js';
import { loadSettings, saveSettings } from '../lib/settings.js';
import { buildDemoStoryboard } from '../lib/demo.js';
import { generateStoryboard, ProviderError, GEMINI_ORIGIN } from '../lib/providers.js';
import { validateStoryboard } from '../lib/storyboard.js';
import { buildTimeline, toSRT, toTranscript, toWebVTT, toMarkdownOutline } from '../lib/captions.js';
import { PlayerEngine } from './engine.js';
import { Narrator } from './narrator.js';
import { exportWebM, webmSupport } from './recorder.js';
import { SlideDeck } from './slides.js';
import { THEMES } from './renderer.js';

const $ = (id) => document.getElementById(id);
const SECTIONS = ['review', 'working', 'failure', 'player', 'slides'];

const state = {
  id: location.hash.slice(1).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64),
  entry: null,
  settings: null,
  storyboard: null,
  generator: '',
  engine: null,
  deck: null,
  output: 'video', // 'video' | 'slides'
  abort: null,
  exportAbort: null,
  lastMode: 'demo',
  retryTimer: 0,
};
const narrator = new Narrator();

function show(section) {
  for (const s of SECTIONS) $(s).hidden = s !== section;
}

function setText(el, text) {
  el.textContent = text;
  el.hidden = !text;
}

function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ---------- review ---------- */

const NOTICES = {
  unsupported: 'Chrome does not let extensions read this page (for example chrome:// pages, the Chrome Web Store, or some PDFs and viewers). Copy the text and paste it below.',
  empty: 'No text was selected on the page. Highlight some text first, or paste it below.',
  missing: 'This explainer session has expired (the browser was restarted or the tab was reopened). Paste the text below to continue.',
};

function updateCounter() {
  const raw = $('selection').value;
  const prep = prepareSelection(raw);
  const n = raw.length;
  let msg = `${n.toLocaleString()} characters selected.`;
  if (prep.ok && prep.truncated) {
    msg += ` Only the first ${prep.text.length.toLocaleString()} characters (cut at a sentence) will be used — long selections are trimmed to keep the video short and the request small.`;
  } else if (prep.ok) {
    msg += ` All ${prep.text.length.toLocaleString()} will be used.`;
  }
  $('counter').textContent = msg;
  $('generate').disabled = !prep.ok;
  $('generate-slides').disabled = !prep.ok;
  renderSharing(prep);
  return prep;
}

function renderSharing(prep) {
  const box = $('sharing');
  box.replaceChildren();
  const s = state.settings;
  const p = document.createElement('p');
  if (s.mode === 'gemini') {
    const strong = document.createElement('strong');
    strong.textContent = `Gemini (${s.model}): `;
    p.append(strong, `only the ${prep.ok ? prep.text.length.toLocaleString() : 0} characters shown above will be sent to Google's Gemini API. ` +
      'On the free tier Google may use prompts and responses to improve its products, and human reviewers may read them. ' +
      'Do not send confidential or personal information.');
    $('generate-demo').hidden = false;
  } else {
    const strong = document.createElement('strong');
    strong.textContent = 'Demo mode: ';
    p.append(strong, 'the storyboard is built offline by picking key sentences. Nothing leaves your browser. ' +
      'Add a free Gemini API key in Settings for real AI explanations.');
    $('generate-demo').hidden = true;
  }
  box.append(p);
}

function renderReview() {
  const e = state.entry || {};
  setText($('notice'), NOTICES[e.notice] || '');
  const src = [];
  if (e.sourceTitle) src.push(`From: ${e.sourceTitle}`);
  if (e.sourceUrl) src.push(e.sourceUrl);
  setText($('source'), src.join(' — '));
  $('selection').value = e.text || '';
  $('mode-badge').textContent = state.settings.mode === 'gemini' ? `Gemini · ${state.settings.model}` : 'Demo mode (offline)';
  updateCounter();
  show('review');
  $('selection').focus();
}

/* ---------- generate ---------- */

async function generate(mode, output = state.output) {
  state.output = output;
  const prep = updateCounter();
  if (!prep.ok) {
    setText($('review-error'), prep.error);
    return;
  }
  setText($('review-error'), '');
  state.lastMode = mode;
  clearInterval(state.retryTimer);

  if (mode === 'demo') {
    finish(buildDemoStoryboard(prep.text), 'Offline demo (extractive)', []);
    return;
  }

  // Gemini: make sure we still have host permission for the API.
  const permitted = await chrome.permissions.contains({ origins: [GEMINI_ORIGIN] });
  if (!permitted) {
    return fail(new ProviderError('permission', 'Gemini access was turned off. Re-enable Gemini in Settings (it asks for permission to contact generativelanguage.googleapis.com).'));
  }
  state.abort = new AbortController();
  show('working');
  $('working-text').textContent = `Asking ${state.settings.model} for a storyboard… (up to 30 seconds)`;
  try {
    const sb = await generateStoryboard({
      apiKey: state.settings.apiKey, model: state.settings.model, text: prep.text, signal: state.abort.signal,
    });
    finish(sb.storyboard, `Gemini (${state.settings.model})`, sb.warnings);
  } catch (e) {
    if (e?.code === 'aborted') return renderReview();
    fail(e);
  } finally {
    state.abort = null;
  }
}

function fail(err) {
  const code = err?.code || 'unknown';
  $('failure-text').textContent = err?.message || 'Something went wrong.';
  const retry = $('retry');
  retry.disabled = false;
  retry.textContent = 'Try again';
  if (code === 'no_key' || code === 'invalid_key' || code === 'permission' || code === 'model_not_found') {
    retry.textContent = 'Open Settings';
    retry.onclick = () => chrome.runtime.openOptionsPage();
  } else {
    retry.onclick = () => generate(state.lastMode);
  }
  if (code === 'rate_limited' && err.retryAfterMs) {
    let left = Math.ceil(err.retryAfterMs / 1000);
    retry.disabled = true;
    const tick = () => {
      retry.textContent = left > 0 ? `Try again in ${left}s` : 'Try again';
      retry.disabled = left > 0;
      if (left-- <= 0) clearInterval(state.retryTimer);
    };
    tick();
    state.retryTimer = setInterval(tick, 1000);
  }
  show('failure');
}

function finish(storyboard, generator, warnings) {
  state.storyboard = storyboard;
  state.generator = generator;
  // Cache so a reload doesn't spend another API request.
  if (state.id) chrome.storage.session.set({ [`sb:${state.id}`]: { storyboard, generator, output: state.output, text: $('selection').value } });
  if (state.output === 'slides') startSlides(warnings);
  else startPlayer(warnings);
}

/* ---------- player ---------- */

async function startPlayer(warnings = []) {
  state.engine?.destroy();
  const sb = state.storyboard;
  show('player');
  $('sb-title').textContent = sb.title;
  setText($('warnings'), warnings.length ? `Note: ${warnings.join(' ')}` : '');

  const list = $('scene-list');
  list.replaceChildren(...sb.scenes.map((s, i) => {
    const li = document.createElement('li');
    const kind = document.createElement('span');
    kind.className = 'visual';
    kind.textContent = s.visual;
    const h = document.createElement('strong');
    h.textContent = s.heading;
    const p = document.createElement('span');
    p.textContent = s.narration;
    li.append(kind, h, p);
    li.tabIndex = 0;
    li.addEventListener('click', () => state.engine.goto(i, true));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') state.engine.goto(i, true); });
    return li;
  }));

  const engine = new PlayerEngine({ canvas: $('canvas'), storyboard: sb, narrator, onChange: onEngineChange });
  state.engine = engine;
  engine.setTheme(state.settings.theme);
  engine.setRate(Number($('rate').value));
  engine.setCaptions($('captions').checked);

  const voices = await narrator.voices();
  const sel = $('voice');
  sel.replaceChildren();
  if (!voices.length) {
    engine.setNarration(false);
    $('narration').checked = false;
    $('narration').disabled = true;
    sel.disabled = true;
    setText($('speech-note'), 'No speech voices are available in this browser, so the video plays silently with captions on a timer.');
  } else {
    const preferred = voices.filter((v) => /^en/i.test(v.lang));
    for (const v of (preferred.length ? preferred : voices)) {
      const o = document.createElement('option');
      o.value = v.voiceURI;
      o.textContent = `${v.name} (${v.lang})${v.localService ? '' : ' · online'}`;
      sel.append(o);
    }
    const saved = voices.find((v) => v.voiceURI === state.settings.voiceURI);
    const def = saved || preferred.find((v) => v.default) || preferred[0] || voices[0];
    sel.value = def.voiceURI;
    narrator.setVoice(def);
    setText($('speech-note'), 'Narration uses your browser’s built-in voices. Voices marked “online” may send the narration text to the browser vendor’s speech service.');
  }
  updateExportLength();
  $('dl-webm').disabled = !webmSupport().supported;
  if (!webmSupport().supported) $('webm-status').textContent = 'WebM recording is not supported in this browser.';
  $('play').focus();
}

/* ---------- slides ---------- */

function startSlides(warnings = []) {
  state.engine?.pause();
  state.output = 'slides';
  show('slides');
  $('deck-title').textContent = state.storyboard.title;
  if (warnings.length) $('deck-title').title = warnings.join(' ');
  if (!state.deck || state.deck.storyboard !== state.storyboard) {
    state.deck = new SlideDeck({
      canvas: $('deck-canvas'), thumbs: $('thumbs'), storyboard: state.storyboard, theme: state.settings.theme,
      onChange: (i) => {
        $('slide-label').textContent = `Slide ${i + 1} of ${state.deck?.count ?? state.storyboard.scenes.length}`;
        $('slide-notes').textContent = state.storyboard.scenes[i].narration;
      },
    });
  } else {
    state.deck.setTheme(state.settings.theme);
  }
  $('slide-next').focus();
}

function setTheme(theme) {
  state.settings.theme = theme;
  for (const id of ['theme', 'deck-theme']) $(id).value = theme;
  state.engine?.setTheme(theme);
  state.deck?.setTheme(theme);
  saveSettings({ theme });
}

async function printDeck() {
  const area = $('print-area');
  const urls = [];
  for (let i = 0; i < state.deck.count; i++) urls.push(URL.createObjectURL(await state.deck.slideBlob(i)));
  area.replaceChildren(...urls.map((u, i) => {
    const img = new Image();
    img.src = u;
    img.alt = `Slide ${i + 1}`;
    return img;
  }));
  await Promise.all([...area.querySelectorAll('img')].map((img) => img.decode().catch(() => {})));
  window.print();
  setTimeout(() => { area.replaceChildren(); urls.forEach((u) => URL.revokeObjectURL(u)); }, 1000);
}

function onEngineChange(st) {
  $('play').textContent = st.playing ? '❚❚ Pause' : st.ended ? '↺ Replay' : '▶ Play';
  $('play').setAttribute('aria-label', st.playing ? 'Pause' : 'Play');
  $('scene-label').textContent = `Scene ${st.scene + 1} of ${state.storyboard.scenes.length}`;
  [...$('scene-list').children].forEach((li, i) => li.classList.toggle('current', i === st.scene));
  if (st.speechError) {
    $('narration').checked = false;
    setText($('speech-note'), `Speech stopped working (${st.speechError}); continuing with captions only.`);
  }
}

function updateExportLength() {
  const ms = buildTimeline(state.storyboard, Number($('rate').value)).duration;
  $('export-len').textContent = `${Math.round(ms / 1000)} seconds`;
}

function meta() {
  return { sourceUrl: state.entry?.sourceUrl || '', generator: state.generator };
}

/* ---------- wiring ---------- */

function wire() {
  $('selection').addEventListener('input', updateCounter);
  $('generate').addEventListener('click', () => generate(state.settings.mode, 'video'));
  $('generate-slides').addEventListener('click', () => generate(state.settings.mode, 'slides'));
  $('generate-demo').addEventListener('click', () => generate('demo'));
  $('fallback-demo').addEventListener('click', () => generate('demo'));
  $('back').addEventListener('click', () => { clearInterval(state.retryTimer); renderReview(); });
  $('cancel').addEventListener('click', () => state.abort?.abort());
  const newText = () => {
    state.engine?.destroy();
    state.engine = null;
    state.deck = null;
    renderReview();
  };
  $('new-text').addEventListener('click', newText);
  $('new-text-2').addEventListener('click', newText);

  for (const id of ['theme', 'deck-theme']) {
    $(id).replaceChildren(...Object.entries(THEMES).map(([value, t]) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = t.label;
      return o;
    }));
    $(id).value = state.settings.theme;
    $(id).addEventListener('change', (e) => setTheme(e.target.value));
  }
  $('to-slides').addEventListener('click', () => startSlides());
  $('to-video').addEventListener('click', () => {
    state.output = 'video';
    if (state.engine) { show('player'); state.engine.goto(state.deck?.index ?? 0, false); } else startPlayer();
  });
  $('slide-prev').addEventListener('click', () => state.deck.prev());
  $('slide-next').addEventListener('click', () => state.deck.next());
  $('present').addEventListener('click', () => $('deck-stage').requestFullscreen?.().catch(() => {}));
  $('deck-stage').addEventListener('click', () => { if (document.fullscreenElement) state.deck.next(); });
  $('dl-png').addEventListener('click', async () => {
    download(`${stem()}-slide-${state.deck.index + 1}.png`, await state.deck.slideBlob(state.deck.index));
  });
  $('dl-png-all').addEventListener('click', async () => {
    // Chrome may ask once to allow multiple downloads.
    for (let i = 0; i < state.deck.count; i++) {
      download(`${stem()}-slide-${i + 1}.png`, await state.deck.slideBlob(i));
      await new Promise((r) => setTimeout(r, 250));
    }
  });
  $('print-pdf').addEventListener('click', printDeck);
  $('dl-md').addEventListener('click', () => download(`${stem()}.outline.md`, toMarkdownOutline(state.storyboard), 'text/markdown'));
  $('dl-json-deck').addEventListener('click', () => $('dl-json').click());

  $('play').addEventListener('click', () => state.engine.toggle());
  $('prev').addEventListener('click', () => state.engine.prev());
  $('next').addEventListener('click', () => state.engine.next());
  $('restart').addEventListener('click', () => state.engine.restart());
  $('rate').addEventListener('change', (e) => {
    const rate = Number(e.target.value);
    state.engine.setRate(rate);
    updateExportLength();
    saveSettings({ rate });
  });
  $('voice').addEventListener('change', async (e) => {
    const v = (await narrator.voices()).find((x) => x.voiceURI === e.target.value);
    narrator.setVoice(v);
    state.engine.setNarration($('narration').checked);
    saveSettings({ voiceURI: e.target.value });
  });
  $('narration').addEventListener('change', (e) => state.engine.setNarration(e.target.checked));
  $('captions').addEventListener('change', (e) => {
    state.engine.setCaptions(e.target.checked);
    saveSettings({ captions: e.target.checked });
  });
  document.addEventListener('keydown', (e) => {
    if (!$('slides').hidden && state.deck && !['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) {
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); state.deck.next(); }
      if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); state.deck.prev(); }
      if (e.key === 'Home') state.deck.go(0);
      if (e.key === 'End') state.deck.go(state.deck.count - 1);
      return;
    }
    if ($('player').hidden || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName)) return;
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); state.engine.toggle(); }
    if (e.key === 'ArrowRight') state.engine.next();
    if (e.key === 'ArrowLeft') state.engine.prev();
  });

  const stem = () => safeFileStem(state.storyboard.title);
  $('dl-json').addEventListener('click', () => download(`${stem()}.storyboard.json`,
    JSON.stringify({ ...state.storyboard, generator: state.generator, source: state.entry?.sourceUrl || null }, null, 2), 'application/json'));
  $('dl-txt').addEventListener('click', () => download(`${stem()}.transcript.txt`, toTranscript(state.storyboard, meta()), 'text/plain'));
  $('dl-vtt').addEventListener('click', () => download(`${stem()}.vtt`, toWebVTT(buildTimeline(state.storyboard, Number($('rate').value))), 'text/vtt'));
  $('dl-srt').addEventListener('click', () => download(`${stem()}.srt`, toSRT(buildTimeline(state.storyboard, Number($('rate').value))), 'application/x-subrip'));

  $('dl-webm').addEventListener('click', async () => {
    state.engine.pause();
    state.exportAbort = new AbortController();
    $('dl-webm').disabled = true;
    $('cancel-webm').hidden = false;
    $('webm-progress').hidden = false;
    $('webm-status').textContent = 'Recording… keep this tab visible.';
    try {
      const { blob } = await exportWebM({
        storyboard: state.storyboard, rate: Number($('rate').value), captions: $('captions').checked,
        signal: state.exportAbort.signal, theme: state.settings.theme, onProgress: (p) => { $('webm-progress').value = p; },
      });
      download(`${stem()}.silent.webm`, blob);
      $('webm-status').textContent = `Saved ${(blob.size / 1e6).toFixed(1)} MB silent WebM (no audio track).`;
    } catch (e) {
      $('webm-status').textContent = e?.name === 'AbortError' ? 'Export cancelled.' : `Export failed: ${e?.message || e}`;
    } finally {
      $('dl-webm').disabled = false;
      $('cancel-webm').hidden = true;
      $('webm-progress').hidden = true;
      state.exportAbort = null;
    }
  });
  $('cancel-webm').addEventListener('click', () => state.exportAbort?.abort());

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.engine?.playing && !state.exportAbort) state.engine.pause();
  });
  window.addEventListener('pagehide', () => narrator.cancel());
}

async function init() {
  state.settings = await loadSettings();
  $('rate').value = String(state.settings.rate);
  $('captions').checked = state.settings.captions;
  wire();

  let cached = null;
  if (state.id) {
    const got = await chrome.storage.session.get([`sel:${state.id}`, `sb:${state.id}`]);
    state.entry = got[`sel:${state.id}`] || null;
    cached = got[`sb:${state.id}`] || null;
  }
  if (!state.entry) state.entry = { text: '', notice: state.id ? 'missing' : 'empty' };
  state.entry.text = String(state.entry.text || '').slice(0, LIMITS.captureMax);

  if (cached?.storyboard) {
    try {
      state.storyboard = validateStoryboard(cached.storyboard).storyboard;
      state.generator = cached.generator || '';
      $('selection').value = cached.text || state.entry.text;
      $('mode-badge').textContent = state.generator;
      state.output = cached.output === 'slides' ? 'slides' : 'video';
      return state.output === 'slides' ? startSlides() : startPlayer();
    } catch { /* fall through to review */ }
  }
  renderReview();
}

init().catch((e) => {
  show('failure');
  $('failure-text').textContent = `The player could not start: ${e?.message || e}`;
});
