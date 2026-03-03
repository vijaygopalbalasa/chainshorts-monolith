<p align="center">
  <img src="https://chainshorts.live/favicon.png" alt="Chainshorts" width="100" />
</p>

<h1 align="center">Chainshorts</h1>

<p align="center">
  <strong>Web3 news in 60 words. Stake $SKR. Win predictions.</strong><br/>
  The only crypto news app built natively for Solana Mobile and the Seeker device.
</p>

<p align="center">
  <a href="https://chainshorts.live">
    <img src="https://img.shields.io/badge/Live-chainshorts.live-14F195?style=for-the-badge&logoColor=white" />
  </a>
  <a href="https://api.chainshorts.live/health">
    <img src="https://img.shields.io/badge/API-Live-14F195?style=for-the-badge&logoColor=white" />
  </a>
  <a href="https://github.com/vijaygopalbalasa/chainshorts-monolith/releases/latest">
    <img src="https://img.shields.io/badge/APK-v1.4.1-14F195?style=for-the-badge&logo=android&logoColor=white" />
  </a>
  <img src="https://img.shields.io/badge/Solana_dApp_Store-Submitted-14F195?style=for-the-badge&logoColor=white" />
</p>

---

## What Is Chainshorts?

Chainshorts is "Inshorts for Web3" — a Solana Mobile-first Android app that distils every major crypto news story to exactly 60 words, and lets users stake SKR on prediction markets built directly from that news.

No email. No password. No KYC. Connect your Seeker wallet, read the news, stake your opinion, earn SKR.

**Built for MONOLITH Hackathon 2026 — Solana Mobile Track.**

---

## Core Features

### 📰 News Feed
- Every story from 26+ RSS sources condensed to **exactly 60 words**
- Filter by category: **All / Markets / DeFi / Infra / NFT / Security**
- Full-screen swipeable cards — one story per swipe, zero friction
- Tap any card to read the original source article

### 🔖 Bookmarks & Share
- Swipe right on any card to bookmark instantly — goes to your personal Saved tab
- Share any story directly to X, Telegram, or any platform

### 🔍 Search
- Full-text search across the entire feed
- Search by topic, token, protocol, or keyword

### 🎯 Predict — In Feed
- Every news card with an open market shows **STAKE YES / STAKE NO** inline
- Stake SKR without ever leaving the feed
- Live pool odds and staker counts visible on every card

### 🎯 Predict Tab — 50+ Live Markets
- Dedicated prediction market browser with 50+ live markets at all times
- **Ending Soon** section — markets sorted by deadline with full staked amounts visible
- Both-side staking: stake YES and NO on the same market independently
- Early cashout at 5% penalty (minimum 10 SKR out)
- Automated on-chain SKR payout to your wallet after 48-hour claim window

### 🏆 Leaderboard
- Global leaderboard: sort by **Profit / Win Rate / Volume**
- **YOUR STATS** banner always pinned — your rank, P&L, win rate at a glance
- Period filters: All time / This week / This month

### 💼 Portfolio
- Full prediction history: open, won, lost, settled
- Total P&L and win rate displayed prominently

### 💱 Wallet + Jupiter Swap
- SKR balance and prediction stats on one screen
- **In-app Jupiter swap** — SOL ↔ USDC ↔ USDT ↔ SKR, best-price routing
- 1% platform fee on every swap, zero extra apps needed

### 🔐 Wallet Connect — Sign-In With Solana
- SIWS authentication — no email, no password, no account creation
- Supports **Seed Vault** (native Seeker), Phantom, Solflare, Backpack
- Single Ed25519 signature, hardware-grade security via Seed Vault

### 🌗 Light & Dark Mode
- Full dark terminal theme (Solana green `#14F195` on deep dark `#070B0F`)
- Light mode available — toggle instantly in settings

### 📣 Sponsored Cards
- Native advertiser cards injected directly into the feed
- Self-serve advertiser portal at [advertiser.chainshorts.live](https://advertiser.chainshorts.live)
- Three formats: Classic / Banner / Spotlight
- Three campaign goals: Traffic (CPM) / Lead Gen (CPL) / Solana Blinks (CPA)

---

## SKR Token Integration

SKR is the economic backbone — not a badge:

| Feature | SKR Role |
|---------|----------|
| Signal tier | Hold 100 SKR |
| Alpha tier | Hold 500 SKR |
| Pro tier | Hold 2,000 SKR |
| Prediction staking | Stake SKR on YES / NO outcomes |
| Prediction payouts | Automated on-chain SKR transfer to winners |
| Early cashout penalty | 5% fee collected in SKR |
| Dispute deposit | 50 SKR to challenge a market resolution |
| Content boosts | Spend SKR to surface articles |
| Jupiter swap fee | 1% of every swap → platform wallet |

Every action in the app touches SKR. Removing it would break the product.

---

## Architecture

```
chainshorts/
├── apps/
│   ├── mobile/       React Native 0.81.4 + Expo 54 (Android, bare workflow)
│   ├── api/          Fastify 5 API (Node 20, TypeScript ESM, 55 DB migrations)
│   └── advertiser/   Next.js 16 advertiser portal (Vercel)
├── workers/
│   ├── ingest/       RSS ingestion + automated summarization (5-min intervals)
│   ├── predictions/  Market generation + resolution (15-min intervals)
│   └── helius/       On-chain transfer monitoring via Helius webhooks
├── packages/
│   └── shared/       Shared types, auth primitives, settlement logic
└── supabase/
    └── migrations/   55 PostgreSQL migrations — all applied to production
```

### Production Infrastructure

| Service | Platform | URL |
|---------|----------|-----|
| API | Railway | api.chainshorts.live |
| Ingest worker | Railway | — |
| Predictions worker | Railway | — |
| Helius webhook | Railway | — |
| Landing page | Vercel | chainshorts.live |
| Advertiser portal | Vercel | advertiser.chainshorts.live |
| Database | Railway PostgreSQL | — |
| Android app | EAS + Solana dApp Store | Submitted ✅ |

---

## Prediction Markets — Technical Detail

- Markets generated continuously from live news events
- Automated resolution system with multi-source verification and confidence scoring
- Atomic CAS payout claim: `transfer_status = 'in_progress'` + `ON CONFLICT DO NOTHING` — zero double-claims possible
- `UNIQUE(stake_id)` enforces exactly one payout per stake at the DB level
- 48-hour claim delay enforced via `claimable_at` column — prevents instant drain
- Dispute system: 48h challenge window, 50 SKR deposit, `dispute_freeze` blocks all claims during review
- Unique-wallet staker counters — no double-counting

---

## Authentication — SIWS + MWA

- Challenge/verify flow via Ed25519 signatures using tweetnacl
- All MWA steps (authorize + sign) in a **single `transact()` call** — required for Seeker's Seed Vault
- Sessions stored in Expo SecureStore with strict key naming (`[A-Za-z0-9._-]+`)
- `solana-wallet://` scheme discovery — no `baseUri` hardcoded
- Session revocation propagates across all devices

---

## Security

- RLS deny-all policies on all financial tables (20+ tables)
- Payment intent reservation system — prevents concurrent double-stakes
- ATA creation uses `CreateIdempotent` (`0x01`) — no TOCTOU race conditions
- All API keys server-side only — mobile uses proxied endpoints:
  - Helius RPC → `/v1/rpc`
  - Jupiter quote → `/v1/jupiter/quote`
  - Jupiter swap → `/v1/jupiter/swap`

---

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| Mobile | React Native 0.81.4, Expo 54, MWA, Solana web3.js, Jupiter SDK |
| API | Fastify 5, TypeScript ESM, PostgreSQL, tweetnacl, @solana/spl-token |
| Workers | Node 20, RSS parsing, Helius webhooks |
| Infrastructure | Railway, Vercel, EAS, Solana Mainnet via Helius RPC |

---

## Running Locally

### API
```bash
cd apps/api
cp .env.example .env      # add DATABASE_URL and other required vars
npm install && npm run dev
```

### Mobile
```bash
cd apps/mobile
cp .env.example .env      # add EXPO_PUBLIC_API_BASE_URL
npm install
npx expo prebuild --platform android --clean
npx expo run:android
```

### Workers
```bash
cd workers/ingest          # or predictions / helius
cp .env.example .env
npm install && npm run dev
```

---

## Links

| | |
|-|-|
| 🌐 App | https://chainshorts.live |
| 🔑 API | https://api.chainshorts.live |
| 📣 Advertisers | https://advertiser.chainshorts.live |
| 📱 APK | [Download latest](https://github.com/vijaygopalbalasa/chainshorts-monolith/releases/latest) |

---

## MONOLITH 2026

**Track:** Solana Mobile
**SKR Bonus Track:** Eligible — deepest SKR integration in the ecosystem
**dApp Store:** Already submitted ✅
**Device tested:** Physical Seeker — every feature verified on real hardware
**Builder:** Vijay Gopal — solo

---

<p align="center">Built on Solana · Native to Seeker · Powered by $SKR</p>
