# Ad Platform — To-Do

A small ad platform on AWS: an exportable React package that shows ads and tracks analytics, backed by a serverless API.

**Approach:** get a rough end-to-end prototype working first (Phase 1), then make it solid (Phase 2). Stretch goals (Phase 3) only start once Phase 2 is done.

**Stack:** TypeScript everywhere · AWS SAM · API Gateway (HTTP API) · Lambda (Node.js) · DynamoDB · S3 · React + Vite · tsup

---

## Phase 0 — Setup

- [x] Install tools: Node.js (current LTS), AWS CLI, AWS SAM CLI. Docker is required for the local demo.
- [x] Configure non-root AWS profile `pulsar` (temporary `credential_process` credentials); bootstrap keys deleted, root profile not used for deployment.
- [x] Deploy the account-wide $5/month gross-spend Budget with email/SNS notifications at $4 and $5. Verified configured subscribers and a live shutdown-handler invocation; real spend-triggered delivery remains untested. This is not a hard spending cap.
- [x] Create the repo as an npm workspaces monorepo:

```
ad-platform/
├── package.json          # "workspaces": ["backend", "packages/*", "demo"]
├── backend/
│   ├── template.yaml     # SAM template
│   └── src/
│       ├── handlers/     # getAd.ts, postEvents.ts, getStats.ts
│       └── lib/          # db.ts, types.ts, select.ts
├── packages/
│   └── react-ads/        # the exportable React package
├── demo/                 # Vite app that consumes react-ads
└── scripts/              # seed.ts, local.ts, deploy-showcase.ts, delete-showcase.ts
```

- [x] Shared `types.ts` for `Ad`, `AdEvent`, `DailyStats` (copy into both backend and package for now; don't over-engineer sharing).

**Done when:** repo exists, `npm install` works at the root, `sam --version` and `aws sts get-caller-identity` work.

---

## Phase 1 — Prototype (ASAP)

Goal: a demo page shows a real ad from DynamoDB, clicking it increments a counter, and the stats component shows the numbers. Ugly is fine.

**Implementation status:** deployed AWS showcase at https://uhroesgpkb.execute-api.us-east-1.amazonaws.com/. Browser verification loaded all three ads, opened the advertiser link, and observed `c3` clicks increase from 0 to 1. Non-root CLI/MCP access is verified. The live shutdown handler stopped all four serving functions (HTTP 503); service was restored (HTTP 200). CloudFront requires account verification, so private S3 assets are served by Lambda through API Gateway HTTPS. Teardown and real spend-triggered notification delivery have not been exercised.

### 1.1 Backend: SAM stack

- [x] `template.yaml` with:
  - [x] One DynamoDB table `AdPlatform` (on-demand billing), keys `PK` (string) and `SK` (string)
  - [x] An `AWS::Serverless::HttpApi` serving the same-origin HTTPS website and API; cross-origin CORS permits only the local demo
  - [x] Three functions (Node.js runtime, `BuildMethod: esbuild` so TypeScript just works), each with a DynamoDB policy scoped to the table:
    - `GetAdFunction` → `GET /ad`
    - `PostEventsFunction` → `POST /events`
    - `GetStatsFunction` → `GET /stats`
  - [x] Table name passed via environment variable
  - [x] Outputs for API, table, site bucket, public site URL, budget and cost guard
- [x] Prepare `npm run showcase:deploy`: root rejection, explicit profile/region, owned artifact bucket, build/typecheck/SAM validation, deploy, frontend build, seed and site sync
- [x] Run deployment and verify the public HTTPS site and real AWS counters

### 1.2 Data model (single table)

| PK | SK | Attributes |
|---|---|---|
| `CAMPAIGN#<id>` | `META` | `name`, `status` (`active`/`paused`), `placements` (list), `weight` (number) |
| `CAMPAIGN#<id>` | `CREATIVE#<id>` | `imageUrl`, `headline`, `landingUrl`, `width`, `height` |
| `CAMPAIGN#<id>` | `STATS#<YYYY-MM-DD>` | `requests`, `impressions`, `clicks` (numbers) |

- [x] For the prototype, ad selection can **Scan** for `META` items with `status = active` — fine at this size. (A GSI comes later if ever needed.)

### 1.3 API endpoints

**`GET /ad?placement=sidebar`**
- [x] Find active campaigns that include this placement
- [x] Weighted random pick of a campaign, then a random creative from it
- [x] Increment `requests` on today's `STATS#` item
- [x] Return:
```json
{
  "impressionId": "uuid",
  "campaignId": "c1",
  "creativeId": "cr1",
  "imageUrl": "https://...",
  "headline": "...",
  "landingUrl": "https://...",
  "width": 300,
  "height": 250
}
```
- [x] Return `204 No Content` when nothing matches (no fill)

**`POST /events`**
- [x] Body: `{ "events": [ AdEvent, ... ] }` where
```json
{
  "eventId": "uuid",
  "type": "impression | click",
  "impressionId": "uuid",
  "campaignId": "c1",
  "creativeId": "cr1",
  "placement": "sidebar",
  "ts": 1760678400000
}
```
- [x] For each event, `UpdateItem` with `ADD impressions :one` (or `clicks`) on `STATS#<date>`
- [x] Parse the body even if `Content-Type` is `text/plain` (see the `sendBeacon` note in 1.5)
- [x] Return `202`

**`GET /stats?campaignId=c1&days=7`**
- [x] `Query` `PK = CAMPAIGN#c1 AND SK BETWEEN STATS#<start> AND STATS#<today>` for the last N UTC days
- [x] Return `{ "days": [ { "date": "2026-10-17", "requests": 0, "impressions": 0, "clicks": 0 } ] }`

### 1.4 Seed script

- [x] `scripts/seed.ts` using AWS SDK v3 (`@aws-sdk/lib-dynamodb`) to insert 3 campaigns with 1–2 creatives each
- [x] Original SVG creatives in `demo/public/creatives`; local seed defaults to the local site's `/creatives`, cloud seed uses `<SiteUrl>/creatives`

### 1.5 React package (`packages/react-ads`)

- [x] Set up with `tsup` (ESM + CJS + `.d.ts`); `react` and `react-dom` as **peerDependencies**
- [x] `<AdProvider apiUrl="...">` — React context holding `apiUrl` and a `track(event)` function
- [x] `<AdSlot placement="sidebar" />`
  - [x] Fetch `/ad` on mount; render nothing on 204
  - [x] Render the image + headline as a link
  - [x] Fire an `impression` event when the ad renders (viewability comes in Phase 2)
  - [x] On click: fire a `click` event, then open `landingUrl`
  - [x] Guard against React StrictMode effect replay with a per-slot request promise and impression ref so you don't double-fetch and double-count
- [x] `<AdStats campaignId="c1" days={7} />` — fetch `/stats` and render a simple table
- [x] Sending events: `navigator.sendBeacon(url, JSON.stringify(body))`, falling back to `fetch(..., { keepalive: true })`
  - Note: send the body as a **plain string**, not a `Blob` with `application/json`. Browsers restrict cross-origin beacons with non-simple content types, so the API should accept `text/plain` and `JSON.parse` it.
- [x] Generate `eventId` with `crypto.randomUUID()`

### 1.6 Demo app (`demo/`)

- [x] Vite + React + TypeScript app that depends on the workspace package
- [x] A fake "publisher" page with 2–3 `AdSlot`s in different placements
- [x] A `/stats` page (or section) with `AdStats` for each campaign
- [x] API URL from `VITE_API_URL` in `.env`

**Phase 1 done when:** load the demo page → ads appear from DynamoDB → click one → refresh stats → the click count went up.

---

## Phase 2 — Make it solid

Goal: the prototype behaves like a real (small) product and is easy to demo and tear down.

### Tracking accuracy
- [x] **Viewable impressions:** `IntersectionObserver` at 50% for one continuous second; count `viewable`.
- [x] **Batching:** flush at 10 events, every five seconds, and when the document becomes hidden.
- [x] **Dedupe:** transactional conditional event insert plus counter update; TTL approximately two days.
- [x] Validate event types, required IDs, and batch size.

### Hosting & infra
- [x] Prepare private S3 hosting served by Lambda through API Gateway HTTPS; CloudFront creation is blocked pending account verification
- [x] Prepare API Gateway throttling (5 requests/second, burst 20) as limited abuse protection
- [x] Same-origin website/API; cross-origin CORS permits only the local demo
- [x] Prepare full static-site deployment and browser cache policies (short HTML, immutable fingerprinted assets, one-hour SVGs)
- [x] Prepare seven-day logs, the account-wide gross $5 monthly budget, and SNS-triggered zero-concurrency shutdown for website and API functions
- [x] Verify the earlier Phase 1 site, API, configured budget subscribers and shutdown-handler effects in AWS; real spend-triggered notification delivery remains untested.
- [ ] Complete remaining AWS checks. CloudFormation reports `UPDATE_COMPLETE`; live dashboard, ad serving, event counters, admin authentication, image upload and the Firehose → Parquet → Athena path were checked. Athena query execution required an authorized root session; the deployer role was denied access. Teardown remains unverified.

### Package polish
- [x] Props: `className`, `onLoad`, `onNoFill`, `onClick` callbacks on `AdSlot`.
- [x] Loading placeholder reserves the configured creative dimensions.
- [x] `AdStats`: period totals and weighted click-through rate, dependency-free daily impressions/clicks chart, expandable UTC breakdown, campaign selection, and responsive dashboard styling
- [x] `useAdEvents()` hook for conversion events.
- [x] Package README with usage and props.

### Demo tooling
- [x] Keep cloud counters tied to real requests, rendered impressions and clicks; the disposable local runner supplies labelled synthetic history for demos.
- [x] Update the project README with local-only operation, full-site deploy/seed, `c3` click demo, cost limitations, manual recovery and confirmed teardown
- [x] Prepare `npm run showcase:delete -- --confirm`: non-root check, exact stack site-bucket emptying, stack deletion and wait; retain artifact bucket and IAM access
- [ ] Verify cloud teardown against the deployed stack when its real counters/assets are no longer needed

**Phase 2 done when:** a fresh clone can be deployed, seeded and demoed using real activity from the README alone, and torn down with the explicit-confirmation command. Code preparation is not evidence of cloud deployment or a guaranteed budget ceiling.

---

## Phase 3 — Stretch goals (only after Phase 2)

Admin flows were exercised locally. The AWS admin and analytics resources are deployed; admin authentication, image upload and the Firehose → Parquet → Athena path were checked.

### A. Admin page
- [x] Campaign administration endpoints.
- [x] Presigned S3 PUT uploads.
- [x] Shared admin-key protection.
- [x] Admin UI: list, create/edit, pause/resume, upload creative, and view stats.

### B. Raw events: Firehose → S3 → Athena
- [x] SAM resources: raw-events bucket, Glue database/table, Firehose stream, Athena workgroup and query-results bucket.
- [x] Firehose Parquet conversion and date-partitioned prefix.
- [x] Maximum buffering interval and Athena partition projection.
- [x] `POST /events` sends accepted events to Firehose.
- [x] Example queries for creative CTR, hourly impressions, placements and provider sessions.
- [x] Document delayed delivery and DynamoDB as the live counter source.

---

## Out of scope (mention in write-up as "what I'd add at scale")

- Kinesis Data Streams (multiple independent consumers, replay)
- Signed impression tokens / click-fraud protection
- AWS WAF
- Cognito auth and multi-tenant publishers
- Budget pacing, frequency capping, targeting
- Sandboxed iframes for third-party HTML creatives
