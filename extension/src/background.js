// Service worker: entry points (context menu, toolbar button, shortcut,
// floating button messages) all end in openPlayer(), which stores the
// selection in session storage and opens the player tab for review.

import { LIMITS } from './lib/text.js';
import { loadSettings } from './lib/settings.js';

const MENU_ID = 'explain-selection';
const CONTENT_SCRIPT_ID = 'floating-button';
const SITE_ORIGINS = ['https://*/*', 'http://*/*'];
const MAX_PENDING = 10;

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html') });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: 'Explain as video', contexts: ['selection'] });
  });
  await syncFloatingButton();
});

chrome.runtime.onStartup.addListener(syncFloatingButton);
chrome.permissions.onAdded.addListener(syncFloatingButton);
chrome.permissions.onRemoved.addListener(syncFloatingButton);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'floatingButton' in changes) syncFloatingButton();
});

/** Register the floating-button content script only when enabled AND permitted. */
export async function syncFloatingButton() {
  const { floatingButton } = await loadSettings();
  const granted = await chrome.permissions.contains({ origins: SITE_ORIGINS });
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  if (floatingButton && granted) {
    if (!existing.length) {
      await chrome.scripting.registerContentScripts([{
        id: CONTENT_SCRIPT_ID,
        matches: SITE_ORIGINS,
        js: ['src/content.js'],
        runAt: 'document_idle',
        allFrames: false,
        persistAcrossSessions: true,
      }]);
    }
  } else if (existing.length) {
    await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  openPlayer({ text: info.selectionText || '', tab, via: 'context-menu' });
});

chrome.action.onClicked.addListener((tab) => explainFromTab(tab, 'toolbar'));

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'explain-selection') return;
  const target = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (target) explainFromTab(target, 'shortcut');
});

/** Read the selection with activeTab; fall back to a paste box on pages we can't script. */
async function explainFromTab(tab, via) {
  let text = '';
  let notice = '';
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (max) => {
        const sel = window.getSelection();
        let s = sel ? sel.toString() : '';
        // Text selected inside a text field isn't part of getSelection() in Chrome.
        const el = document.activeElement;
        if (!s && el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text'))) {
          s = el.value.slice(el.selectionStart || 0, el.selectionEnd || 0);
        }
        return s.slice(0, max);
      },
      args: [LIMITS.captureMax],
    });
    text = typeof result?.result === 'string' ? result.result : '';
    if (!text) notice = 'empty';
  } catch {
    notice = 'unsupported';
  }
  await openPlayer({ text, tab, via, notice });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only accept messages from our own content script running in a tab.
  if (sender.id !== chrome.runtime.id || !sender.tab || msg?.type !== 'EXPLAIN_SELECTION') return false;
  openPlayer({ text: typeof msg.text === 'string' ? msg.text : '', tab: sender.tab, via: 'floating-button' })
    .then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
  return true;
});

export async function openPlayer({ text, tab, via, notice = '' }) {
  const id = crypto.randomUUID();
  const entry = {
    text: String(text || '').slice(0, LIMITS.captureMax),
    sourceUrl: typeof tab?.url === 'string' && /^https?:/.test(tab.url) ? tab.url.slice(0, 2000) : '',
    sourceTitle: typeof tab?.title === 'string' ? tab.title.slice(0, 200) : '',
    via,
    notice,
    createdAt: Date.now(),
  };
  await prunePending();
  await chrome.storage.session.set({ [`sel:${id}`]: entry });
  const url = chrome.runtime.getURL(`src/player/player.html#${id}`);
  const create = { url };
  if (tab && typeof tab.index === 'number') {
    create.index = tab.index + 1;
    create.windowId = tab.windowId;
  }
  await chrome.tabs.create(create);
}

async function prunePending() {
  const all = await chrome.storage.session.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith('sel:'))
    .sort((a, b) => (all[a].createdAt || 0) - (all[b].createdAt || 0));
  if (keys.length >= MAX_PENDING) await chrome.storage.session.remove(keys.slice(0, keys.length - MAX_PENDING + 1));
}
