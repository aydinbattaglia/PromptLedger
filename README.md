# PromptLedger

Per-prompt cost and usage tracking for AI creative tools. A Manifest V3 Chrome
extension that records what each generation actually costs you on
[Runway](https://runwayml.com), [ElevenLabs](https://elevenlabs.io), and
[Midjourney](https://midjourney.com) — credits, characters, and GPU hours,
normalised to money.

**[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/cbciekapacldpgpkgclpfmdnhcljjbmi)**

## Why

AI creative tools bill in deliberately incomparable units — Runway counts
credits, ElevenLabs counts characters-turned-credits, Midjourney sells GPU
time — and none of them show you what a single prompt cost. PromptLedger
watches the generation flow in your browser, records the credit delta per
prompt, and turns it into a spend ledger you can filter, tag by project, and
export.

## Features

- **Per-prompt capture** — prompt text, model, credits used, and cost recorded
  for every generation
- **Plan detection** — reads your plan from the tool's billing page to convert
  credits into your actual dollar rate
- **Dashboard** — filterable log, time-series and spend-by-tool charts, CSV export
- **Project tags** — attribute generations to projects (including retroactively)
- **Budget alerts** — per-tool daily/monthly limits with browser notifications,
  multi-currency
- **Capture health** — warns you when a tool's UI has changed and capture is
  degraded, instead of failing silently
- **Private by design** — everything stays in your browser (IndexedDB +
  extension storage); no accounts, no servers, no telemetry

## How it works

Each tool has an adapter (`src/adapters/`) that detects generation start via
DOM events and completion via balance deltas, new audio/media elements, or
intercepted API responses (a `world: MAIN` content script patches
`fetch`/XHR). Records flow through the service worker, which validates deltas
(per-tool caps + a warmed-up 5× EMA rule), applies your plan rate, and stores
them in IndexedDB.

Tool UIs change without notice; when selectors drift, the popup's health
banner will tell you rather than silently dropping data. Selectors live in
`SEL` constants at the top of each adapter for easy patching.

## Development

```bash
npm install
npm run build       # production build → dist/
npm run dev         # watch mode
npm run typecheck   # tsc --noEmit
npm test            # unit tests (vitest)
npm run test:e2e    # E2E tests (puppeteer + fixture pages, ~75s)
npm run test:all    # both
```

Load `dist/` as an unpacked extension at `chrome://extensions` (enable
Developer mode).

## Privacy

Prompt text and credit balances are read from pages you already have open and
stored **locally only**. See the
[privacy policy](https://aydinbattaglia.github.io/PromptLedger/privacy.html).

## License

[MIT](LICENSE)
