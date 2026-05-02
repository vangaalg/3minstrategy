# 3-Mint Live

Real-time intraday Nifty 50 scanner. Combines mechanical strategies (EMA mean-reversion, Bollinger VRL recovery, SMA pullback continuation) on 3-min candles with options-chain analysis (PCR, OI buildup, wall migration, Max Pain, IV skew), market breadth (advances/declines for all 50 constituents), 5-day daily structure, and a deterministic confluence score. Includes directional strangle proposals with risk filters.

**Architecture:** Next.js 15 → Breeze REST API (1-min Nifty data + options chain + per-stock LTP) → JS resampler (1-min → 3-min) → Claude API (computes strategies + bias + price projection with prompt caching) → JS confluence + strangle engines → live dashboard.

**Fallback:** When Breeze options chain fails, upload a screenshot of any options chain (NSE / Sensibull / Opstra / broker terminal) — Claude Vision parses it into the same structure.

---

## Features

| Feature | Detail |
|---|---|
| Three mechanical strategies | EMA 5×SMA 20 mean-reversion, Bollinger VRL recovery breakout, SMA 20 pullback continuation — each computed on 3-min bars with R:R ≥ 1.5 filter |
| Discretionary bias | Claude reads price action + indicators + options chain, returns BULLISH/BEARISH/NEUTRAL with confidence |
| OI buildup matrix | Per-strike Long Buildup / Short Buildup / Short Covering / Long Unwinding classification |
| OI wall migration | Top OI strikes vs OI-change strikes — detects wall direction shifts |
| Confluence score | 6 signals scored ±1 each (-6 to +6), deterministic, with contradiction flags |
| Daily structure | Last 5 days HH/HL/LH/LL classification with regime (BULLISH/BEARISH/UNCERTAIN/CHOPPY) — yesterday weighted heavier than 5-day pattern |
| Opening-range strangle | When yesterday/today is an outside bar, strangle strike = first-15-min midpoint |
| Directional strangle | When confluence is decisive, strike = projected target (PIN scenario) or one strike beyond (TOUCH_AND_BOUNCE) |
| Advances/declines | All 50 Nifty constituents fetched in parallel, top gainers/losers, breadth bar |
| Market ticker | Live VIX, USD/INR, Brent, Dow Jones, Dow Futures via Yahoo Finance |
| OI screenshot upload | Drag-drop / paste / pick — Claude Vision parses into chain rows |
| Cost tracking | Per-scan token cost and session total displayed |
| Prompt caching | System prompt cached, ~10% cost on cache hits |
| Auto-refresh | Optional 3-min auto-scan during market hours |
| Sonnet/Opus toggle | Switch models from settings; Sonnet 4.6 is default (40% cheaper, equivalent accuracy) |

---

## Prerequisites

1. **ICICI Direct trading account** with Breeze API enabled
2. **Anthropic API key** (https://console.anthropic.com/)
3. **Node.js 20+** locally for development
4. **GitHub account** for Vercel deploy
5. **Vercel account** (free tier works)

---

## Local development

### 1. Install

```bash
unzip 3-mint-live.zip
cd 3-mint-live
npm install
```

### 2. Configure environment

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```
BREEZE_API_KEY=your_breeze_api_key
BREEZE_API_SECRET=your_breeze_api_secret
BREEZE_SESSION_TOKEN=your_daily_session_token
ANTHROPIC_API_KEY=sk-ant-api03-...
```

### 3. Generate Breeze session token (daily)

The session token expires every day around 4 AM IST. Generate fresh each morning:

1. Visit `https://api.icicidirect.com/apiuser/login?api_key=URL_ENCODED_API_KEY`
2. Log in with ICICI credentials
3. After login, copy the `apisession` value from the redirect URL
4. Either paste into `.env.local` (locally) or paste into the **Settings ⚙ panel** in the dashboard (production)

Tip: the dashboard's Settings panel saves the session token in browser localStorage and sends it with every scan, so you don't need to redeploy or change Vercel env vars daily.

### 4. Run

```bash
npm run dev
# → http://localhost:3000
```

### 5. Test the diagnostic endpoints first

Before burning Claude tokens, confirm Breeze auth works:

- `http://localhost:3000/api/breeze` — fetches 1-min and 3-min bars
- `http://localhost:3000/api/options-chain` — fetches Nifty option chain
- `http://localhost:3000/api/advance-decline` — fetches all 50 constituent quotes
- `http://localhost:3000/api/market-data` — fetches global tickers (Yahoo, no auth)

If `/api/breeze` returns an error like "session token expired," refresh your token.

---

## Deploying to Vercel

### Option A: One-click via GitHub

1. **Create a GitHub repo** and push the project:
   ```bash
   cd 3-mint-live
   git init
   git add .
   git commit -m "Initial commit"
   gh repo create 3-mint-live --private --source=. --push
   # or: create the repo manually on github.com, then `git remote add origin <url> && git push`
   ```

2. **Import to Vercel:**
   - Go to https://vercel.com/new
   - Click "Import Git Repository"
   - Select your `3-mint-live` repo
   - Framework: Next.js (auto-detected)
   - Click **Deploy** (it'll fail the first time without env vars — that's fine, fix in step 3)

3. **Add environment variables** (Settings → Environment Variables):
   ```
   BREEZE_API_KEY        = your_key
   BREEZE_API_SECRET     = your_secret
   BREEZE_SESSION_TOKEN  = today's session token (refresh daily)
   ANTHROPIC_API_KEY     = sk-ant-api03-...
   ```
   Apply to **Production**, **Preview**, and **Development** environments.

4. **Trigger redeploy:** Settings → Deployments → click ⋯ on the failed build → Redeploy

5. **Open the URL Vercel gives you** (e.g. `https://3-mint-live.vercel.app`)

### Option B: Vercel CLI

```bash
npm install -g vercel
cd 3-mint-live
vercel login
vercel                         # first deploy (preview URL)
vercel --prod                  # production deploy

# Add env vars
vercel env add BREEZE_API_KEY production
vercel env add BREEZE_API_SECRET production
vercel env add BREEZE_SESSION_TOKEN production
vercel env add ANTHROPIC_API_KEY production

# Redeploy with envs
vercel --prod
```

### Configuring function timeouts (recommended)

The scan endpoint runs 1 Breeze fetch + 50 parallel Breeze quote calls + 1 Claude call. On Vercel's free tier, default function timeout is 10s — that may not be enough.

Add this to your Vercel project settings (Functions → Maximum Duration) **OR** create `vercel.json` in the project root:

```json
{
  "functions": {
    "app/api/scan/route.ts": { "maxDuration": 60 },
    "app/api/parse-oi-screenshot/route.ts": { "maxDuration": 30 },
    "app/api/advance-decline/route.ts": { "maxDuration": 30 }
  }
}
```

Free tier maxes at 60 seconds. Pro tier goes to 300.

---

## Daily operating routine

Every morning before market open (9:00 AM IST):

1. **Refresh Breeze session token:**
   - Visit `https://api.icicidirect.com/apiuser/login?api_key=YOUR_KEY` and log in
   - Copy the `apisession` from the redirect URL
2. **Open the dashboard** → click **⚙ Settings** → paste session token → **Save**
3. **Test:** click "▶ Run scan" — it should complete in 5-15 seconds
4. **(Optional) Toggle auto-refresh on** — every 3 minutes the scan re-runs

If a scan fails with "options chain fetch failed":
1. Click the **📊 Upload OI** pill in the controls bar
2. Drag/paste/upload a screenshot from any options chain source (NSE, Sensibull, Opstra, broker terminal)
3. Wait ~3-5 seconds for Claude Vision to parse
4. Re-run the scan — it'll use the uploaded chain instead

---

## Cost guide (per-scan estimate, with prompt caching)

| Model | Cold scan | Cached scan | Daily auto-refresh (~120 scans) | Monthly (22 trading days) |
|---|---|---|---|---|
| **Sonnet 4.6** | ~$0.034 | ~$0.025 | ~$3.00 | ~$66 |
| **Opus 4.7** | ~$0.069 | ~$0.052 | ~$6.20 | ~$137 |

Plus screenshot parses if Breeze fails: ~$0.005 per parse on Sonnet 4.6. A/D fetches are free (Breeze API has no per-call charge).

---

## Files

```
3-mint-live/
├── app/
│   ├── api/
│   │   ├── advance-decline/route.ts          50-stock breadth fetch
│   │   ├── breeze/route.ts                   diagnostic: 1-min + 3-min bars
│   │   ├── market-data/route.ts              VIX, USD/INR, Brent, Dow via Yahoo
│   │   ├── options-chain/route.ts            diagnostic: option chain
│   │   ├── parse-oi-screenshot/route.ts      Claude Vision OI parse
│   │   └── scan/route.ts                     full scan orchestrator
│   ├── globals.css                           terminal-themed styles
│   ├── layout.tsx
│   └── page.tsx                              dashboard
├── components/
│   ├── AdvanceDeclineCard.tsx
│   ├── BiasCard.tsx
│   ├── ConfluenceCard.tsx                    score gauge + components + contradictions
│   ├── DailyStructureCard.tsx                5-day HH/HL with toggle
│   ├── MarketTicker.tsx
│   ├── OIBuildupCard.tsx                     wall migration + top strikes
│   ├── OIScreenshotUploader.tsx              drag/drop screenshot upload
│   ├── SessionContext.tsx                    spot/H/L strip + options summary + caveats
│   ├── SettingsPanel.tsx                     model + session token + prefer-upload
│   ├── StrangleCard.tsx                      strike + breakevens + filters
│   └── StrategyCard.tsx
├── lib/
│   ├── breeze.ts                             REST client + A/D fetcher
│   ├── claude.ts                             scan API client
│   ├── confluence.ts                         deterministic 6-signal scorer
│   ├── daily-structure.ts                    5-day regime classifier
│   ├── market-data.ts                        Yahoo quotes
│   ├── nifty50-list.ts                       constituent codes
│   ├── resample.ts                           1-min → 3-min OHLCV
│   ├── skill-prompt.ts                       embedded 3-mint skill
│   └── strangle.ts                           strike selector + risk filters
├── .env.local.example
├── package.json
├── tsconfig.json
└── README.md
```

---

## Troubleshooting

**"Missing Breeze credentials"** — `.env.local` not loaded. Restart `npm run dev`. On Vercel, check Settings → Environment Variables.

**"Session token expired"** — Refresh from `apiuser/login` and update via Settings panel (or env var).

**Scan times out on Vercel** — Increase function timeout via `vercel.json` (see Configuring function timeouts above).

**Options chain fetch fails repeatedly** — Use the screenshot upload fallback. Click 📊 Upload OI in the controls bar.

**Claude returns invalid JSON** — Rare; click Run scan again. If persistent, check `ANTHROPIC_API_KEY` is correct.

**A/D shows lots of "errors"** — Some Breeze stock codes may have changed. Edit `lib/nifty50-list.ts` and re-deploy.

**India VIX is null** — Yahoo doesn't expose India VIX. We display CBOE VIX as a global vol proxy. To get India VIX specifically, you'd need a separate scrape (NSE doesn't have a free public JSON endpoint that works server-side without complex headers).

**The dashboard works but A/D is slow** — 50 sequential Breeze calls take ~5-10s. They run in batches of 10 in parallel; if you need faster, reduce `CONCURRENCY` in `lib/breeze.ts` to 5 OR use a paid Breeze plan with higher rate limits.

---

## Disclaimer

Mechanical strategy signals + discretionary bias + OI analysis + options proposals are **research aids**, not advice. Strangles carry **unbounded loss risk**. Position sizing, execution, and final decisions are entirely yours. The author/creator of this tool takes no responsibility for trading outcomes.
