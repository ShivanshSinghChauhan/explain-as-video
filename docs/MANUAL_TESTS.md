# Manual test cases (real Chrome)

Run these in desktop Google Chrome 116 or later after loading the extension unpacked (see README).
**Auto** means an automated test already covers the case in Playwright's Chromium. Re-check it by hand in branded Chrome anyway, because some behaviour differs there: real voices, permission prompts, the context menu and the toolbar.

| # | Area | Steps | Expected | Auto |
|---|---|---|---|---|
| M1 | Install | Load unpacked `extension/` | Settings tab opens. Demo mode is selected. The install shows no "read and change all your data" warning | partial |
| M2 | Context menu | On any article, select a paragraph → right-click → **Explain as video** | A new tab opens next to the page and shows the selected text, a character count and the page title | – |
| M3 | Toolbar icon | Select text → click the toolbar icon | Same as M2 | – |
| M4 | Shortcut | Select text → <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> (macOS: <kbd>Option</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd>) | Same as M2. If the shortcut does nothing, check `chrome://extensions/shortcuts` | – |
| M5 | Floating button opt-in | Settings → tick **Show an "Explain as video" button** | Chrome asks for access to all sites. Approve it. **Reload** an open article, select 20+ characters, and a purple button appears under the selection | partial |
| M6 | Floating button flow | Click the floating button | The review tab opens with only the selected text. The nav and footer text are not included | yes |
| M7 | Floating button off | Untick the option in Settings, then reload the page | No button appears. The access shows as removed in `chrome://extensions` → Details | – |
| M8 | Demo video | On review, click **Generate video** | The player appears in under 1 second. Press Play: the voice narrates, captions match the words, scenes advance on their own, and the progress bar fills | partial (no voice in CI) |
| M9 | Controls | Try Pause/Play, ⏮ ⏭ ↺, Speed 1.5×, the voice dropdown, Narration off, Captions off, a scene list click, and the Space / ← / → keys | Each control works. Pause stops the voice right away. Turning narration off falls back to timed captions | partial |
| M10 | Create slides | On review, click **Create slides** | The slide view opens with thumbnails, "Slide 1 of N" and speaker notes | yes |
| M11 | Slide themes | Switch the theme to Paper, Sunset, Forest and High contrast | The main slide and all thumbnails redraw in the new theme. The theme is remembered next time and also applies to the video | yes |
| M12 | Present | Click **Present full screen**, then use → / Space / ← / Home / End, then Esc | The slides fill the screen, keys move between slides, and Esc exits | – |
| M13 | Slide export | Click **This slide (.png)**, **All slides (.png)**, **Outline (.md)** and **Print / Save as PDF** | You get 1280×720 PNGs. "All slides" may trigger Chrome's "download multiple files" prompt once. The print preview shows one landscape slide per page | partial |
| M14 | Transcript export | Click **Storyboard (.json)**, **Transcript (.txt)**, **Captions (.vtt)** and **Captions (.srt)** | The files download. The VTT loads in VLC next to the WebM | yes |
| M15 | WebM export | Click **Export silent WebM** and keep the tab visible | A progress bar runs for about the length of the video, then a `.silent.webm` file downloads. It plays in Chrome or VLC with burned-in captions and **no audio track** | yes (format) |
| M16 | WebM in background | Start an export, then switch tabs for 10 seconds | The export still finishes. Frames may be choppy while hidden. This is a documented limitation | – |
| M17 | Unsupported page | Open `chrome://settings` or the Chrome Web Store → click the toolbar icon | The review tab explains that the page can't be read and offers a paste box. Pasting text and clicking Generate works | – |
| M18 | PDF | Open a PDF in Chrome's viewer, select text → right-click → Explain as video | It works through the context menu. If the toolbar icon can't read the selection, the paste fallback appears | – |
| M19 | Nothing selected | Click the toolbar icon without selecting text | The notice says nothing was selected, and the paste box is shown | partial |
| M20 | Too short / long | Select 5 words, then select a whole long article (50k+ characters) | Short: Generate stays disabled with a reason. Long: "Only the first 6,000 characters…" appears and the video still builds | yes |
| M21 | Huge page | Open a very large page (e.g. a long Wikipedia list), press Ctrl/Cmd+A, then use the toolbar | The page doesn't freeze. The text is capped at 50,000 characters, then trimmed to 6,000 | partial |
| M22 | Gemini setup | Settings → Gemini → read the warnings → tick the box → paste a key from AI Studio → **Test key** | Chrome asks for access to `generativelanguage.googleapis.com`. The test reports "Works: got an N-scene storyboard" | **needs live key** |
| M23 | Gemini video | **Save & enable Gemini**, select text, click Generate | Review says the text will be sent to Google. A storyboard arrives in 2–15 seconds and differs from the demo output | **needs live key** |
| M24 | Invalid key | Save a deliberately wrong key (any 39 random letters), then Generate | "The API key was rejected" appears, with an **Open Settings** button | yes (mocked) |
| M25 | Rate limit | Click Generate many times quickly, or wait until the daily quota runs out | "Rate limit or free-tier quota reached…" appears with a countdown. **Use offline demo** works | yes (mocked) |
| M26 | Offline | Turn off Wi-Fi → Generate with Gemini | "Could not reach Gemini…" appears. The demo fallback works | yes (mocked) |
| M27 | Cancel | With Gemini, click Generate then **Cancel** right away | You're back on the review screen with no error | yes (unit) |
| M28 | Reload | Reload the player tab after a Gemini result | The same storyboard appears. DevTools → Network shows **no** new request | yes |
| M29 | Delete key | Settings → **Delete saved key** | You're back in Demo mode. `chrome.storage.local` no longer holds the key, and the Gemini permission is removed | – |
| M30 | Hostile text | Select text containing `<img src=x onerror=alert(1)>` and "ignore previous instructions…" | The text appears literally. No alert fires, and the storyboard just explains it | yes |
| M31 | Dark mode | Switch the OS to dark mode | The settings, player and review pages stay readable | – |
| M32 | Voices | macOS: System Settings → Accessibility → Spoken Content. Remove or download voices | The voice dropdown matches what's installed. With no voices, a captions-only notice shows | – |
