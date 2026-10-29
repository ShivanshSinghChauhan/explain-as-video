// Floating "Explain as video" button. Injected only on sites the user has
// granted (optional permission). It never reads anything but the current
// selection, and only sends it when the user clicks the button.
(() => {
  if (window.__explainAsVideoLoaded) return;
  window.__explainAsVideoLoaded = true;

  const MIN_CHARS = 20;
  const MAX_CHARS = 50000;

  let host = null;
  let button = null;

  function ensureButton() {
    if (host) return;
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;display:none;';
    // Closed shadow root: page CSS and scripts can't restyle or reach the button easily.
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      button { all: initial; font: 600 13px/1 system-ui, -apple-system, Segoe UI, sans-serif; color: #fff;
        background: #4338ca; border-radius: 999px; padding: 8px 12px 8px 10px; cursor: pointer;
        box-shadow: 0 4px 14px rgba(0,0,0,.25); display: inline-flex; align-items: center; gap: 6px; }
      button:hover { background: #3730a3; }
      button:focus-visible { outline: 3px solid #a5b4fc; outline-offset: 2px; }
      svg { width: 14px; height: 14px; fill: currentColor; }`;
    button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', 'Explain the selected text as a video');
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', 'M4 2.5v11l9-5.5z');
    svg.appendChild(path);
    button.append(svg, document.createTextNode('Explain as video'));
    // Keep the page selection alive when the button is pressed.
    button.addEventListener('mousedown', (e) => e.preventDefault());
    button.addEventListener('click', onClick);
    root.append(style, button);
    (document.body || document.documentElement).appendChild(host);
  }

  function hide() {
    if (host) host.style.display = 'none';
  }

  function currentSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const text = sel.toString();
    if (text.trim().length < MIN_CHARS) return null;
    return { text: text.slice(0, MAX_CHARS), range: sel.getRangeAt(sel.rangeCount - 1) };
  }

  function show() {
    const cur = currentSelection();
    if (!cur) return hide();
    ensureButton();
    const rects = cur.range.getClientRects();
    const r = rects.length ? rects[rects.length - 1] : cur.range.getBoundingClientRect();
    const top = Math.min(window.innerHeight - 44, Math.max(4, r.bottom + 8));
    const left = Math.min(window.innerWidth - 170, Math.max(4, r.right - 80));
    host.style.top = `${top}px`;
    host.style.left = `${left}px`;
    host.style.display = 'block';
  }

  let timer = 0;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(show, 180);
  }

  function onClick() {
    const cur = currentSelection();
    hide();
    if (!cur) return;
    try {
      chrome.runtime.sendMessage({ type: 'EXPLAIN_SELECTION', text: cur.text });
    } catch {
      // Extension was reloaded/updated; this old content script is orphaned.
    }
  }

  document.addEventListener('mouseup', (e) => {
    if (host && e.composedPath().includes(host)) return;
    schedule();
  }, true);
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Escape') return hide();
    if (e.shiftKey || e.key === 'a') schedule();
  }, true);
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) hide();
  });
  window.addEventListener('scroll', hide, { passive: true, capture: true });
  window.addEventListener('blur', hide);
})();
