import { loadSettings, saveSettings, maskKey } from '../lib/settings.js';
import { GEMINI_MODELS, GEMINI_ORIGIN, generateStoryboard, looksLikeApiKey } from '../lib/providers.js';

const $ = (id) => document.getElementById(id);
const SITE_ORIGINS = ['https://*/*', 'http://*/*'];
const TEST_TEXT = 'Photosynthesis is the process plants use to turn light, water and carbon dioxide into sugar and oxygen. It happens in chloroplasts.';

let cached = null; // last loaded settings, so click handlers can call permissions.request() first

function status(msg, kind = '') {
  $('status').textContent = msg;
  $('status').className = kind;
}

async function render() {
  const s = await loadSettings();
  cached = s;
  $('mode-demo').checked = s.mode === 'demo';
  $('mode-gemini').checked = s.mode === 'gemini';
  $('ack').checked = s.sharingAcknowledged;
  $('key').value = '';
  $('key-saved').textContent = s.apiKey ? `Saved key: ${maskKey(s.apiKey)} (leave the field empty to keep it)` : 'No key saved.';
  $('model').value = s.model;
  $('gemini-box').hidden = !$('mode-gemini').checked;
  const granted = await chrome.permissions.contains({ origins: SITE_ORIGINS });
  $('floating').checked = s.floatingButton && granted;
  $('floating-status').textContent = s.floatingButton && granted
    ? 'On. Reload already-open tabs to see the button there.'
    : 'Off.';
}

function wire() {
  $('model').replaceChildren(...GEMINI_MODELS.map((m) => {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.label;
    return o;
  }));

  for (const r of document.querySelectorAll('input[name=mode]')) {
    r.addEventListener('change', async () => {
      $('gemini-box').hidden = !$('mode-gemini').checked;
      if ($('mode-demo').checked) {
        await saveSettings({ mode: 'demo' });
        status('Demo mode on. Nothing is sent anywhere.', 'ok');
      }
    });
  }

  $('toggle-key').addEventListener('click', () => {
    const show = $('key').type === 'password';
    $('key').type = show ? 'text' : 'password';
    $('toggle-key').textContent = show ? 'Hide' : 'Show';
  });

  $('floating').addEventListener('change', async (e) => {
    if (e.target.checked) {
      // Must be called directly from the click for Chrome to show the prompt.
      const ok = await chrome.permissions.request({ origins: SITE_ORIGINS });
      if (!ok) {
        e.target.checked = false;
        $('floating-status').textContent = 'Permission was not granted, so the floating button stays off.';
        return;
      }
      await saveSettings({ floatingButton: true });
    } else {
      await saveSettings({ floatingButton: false });
      await chrome.permissions.remove({ origins: SITE_ORIGINS });
    }
    render();
  });

  $('save').addEventListener('click', async () => {
    const typed = $('key').value.trim();
    const apiKey = typed || cached.apiKey;
    if (!$('ack').checked) return status('Please tick the acknowledgement first.', 'bad');
    if (!apiKey) return status('Paste an API key first.', 'bad');
    if (typed && !looksLikeApiKey(typed)) return status('That does not look like an API key (letters, digits, - and _ only).', 'bad');
    const ok = await chrome.permissions.request({ origins: [GEMINI_ORIGIN] });
    if (!ok) return status('Chrome permission to contact the Gemini API was not granted, so Gemini stays off.', 'bad');
    await saveSettings({ apiKey, model: $('model').value, sharingAcknowledged: true, mode: 'gemini' });
    status('Saved. Gemini is on.', 'ok');
    render();
  });

  $('test').addEventListener('click', async () => {
    const apiKey = $('key').value.trim() || cached.apiKey;
    if (!$('ack').checked) return status('Please tick the acknowledgement first (the test sends a short sample sentence to Google).', 'bad');
    if (!apiKey) return status('Paste an API key first.', 'bad');
    const ok = await chrome.permissions.request({ origins: [GEMINI_ORIGIN] });
    if (!ok) return status('Chrome permission to contact the Gemini API was not granted.', 'bad');
    status('Testing with a short sample sentence (uses 1 request of your quota)…');
    try {
      const { storyboard } = await generateStoryboard({ apiKey, model: $('model').value, text: TEST_TEXT });
      status(`Works: got a ${storyboard.scenes.length}-scene storyboard. Remember to press Save.`, 'ok');
    } catch (e) {
      status(`Test failed: ${e.message}`, 'bad');
    }
  });

  $('clear').addEventListener('click', async () => {
    await chrome.storage.local.remove('apiKey');
    await saveSettings({ mode: 'demo', sharingAcknowledged: false });
    await chrome.permissions.remove({ origins: [GEMINI_ORIGIN] });
    status('Key deleted from this browser. Demo mode is on. You can also revoke the key in Google AI Studio.', 'ok');
    render();
  });
}

wire();
render();
