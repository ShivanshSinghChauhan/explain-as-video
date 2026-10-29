# Provider pricing and free-tier notes

**Verified on 2026-10-29** from official sources. Prices, models and limits change often, so check the links again before you rely on them.

## Google Gemini API (the only live provider in this MVP)

| What | What the official page said on 2026-10-29 | Source |
|---|---|---|
| Free tier models | `gemini-3.5-flash-lite`, `gemini-3.8-flash`, `gemini-2.5-flash-lite` (and others) list input/output as "Free of charge" on the Free tier | [Pricing](https://ai.google.dev/gemini-api/docs/pricing) (page "Last updated 2026-10-28 UTC") |
| Free-tier data use | The Free tier is marked "Used to improve our products: Yes". The terms say human reviewers may read inputs/outputs and tell you not to submit sensitive, confidential or personal information | [Pricing](https://ai.google.dev/gemini-api/docs/pricing), [Terms](https://ai.google.dev/gemini-api/terms) (page "Last updated 2026-04-28 UTC") |
| Rate limits | RPM, input TPM and RPD apply **per project, not per key**. RPD resets at midnight Pacific. The page says "Specified rate limits are not guaranteed and actual capacity may vary". Exact free-tier numbers are **not published on the page**; they show in AI Studio | [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) (page "Last updated 2026-10-28 UTC"), [your limits in AI Studio](https://aistudio.google.com/rate-limit) |
| Model lifecycle | `gemini-3.5-flash-lite` and `gemini-2.5-flash-lite` have no shutdown date announced. The page suggests 3.5 Flash-Lite or 3.8 Flash for new projects | [Deprecations](https://ai.google.dev/gemini-api/docs/deprecations) (page "Last updated 2026-10-22") |
| Eligibility | 18+ only. Apps offered to users in the EEA, Switzerland or the UK may use **paid services only** | [Terms](https://ai.google.dev/gemini-api/terms) |

**What this means in practice**

- One video or slide deck = **1 request**. The extension makes 2 only when it retries once after a server error, a timeout or an unusable reply. "Test key" in Settings uses 1 request.
- The input is at most about 6,000 characters plus a fixed prompt of about 400 tokens. The output is capped at 4,096 tokens.
- There is **no promise of unlimited or guaranteed free use**. When you hit a limit, you'll see a rate-limit error with the wait time. Demo mode keeps working.
- If you turn on billing for the key's Google Cloud project, the same requests may be **charged** at that model's paid rates. Use a separate project with no billing for this extension, and set a budget alert if you add billing.

## Providers considered but not shipped

- **Groq**: on 2026-10-29 the [rate-limits page](https://console.groq.com/docs/rate-limits) showed only "Developer plan" base limits. It said the exact limits for your organization are on your own account page. [groq.com/pricing](https://groq.com/pricing) did not show free-plan terms in a form I could read. I couldn't verify the free tier from public official pages, so Groq isn't included.
- **Paid text-to-video APIs**: left out on purpose. Video is made in the browser with Canvas and speech synthesis, at no cost.

Browser narration uses `speechSynthesis` and is free. Voices marked "online" (for example Google voices in Chrome) may send the narration text to the browser vendor's speech service. Local OS voices don't.
