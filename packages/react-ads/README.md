# @pulsar/react-ads

React components and event tracking for the Pulsar ad API. React and React DOM 18 or 19 are peer dependencies. This package is not published to npm; build and pack it from the workspace:

```sh
npm run build --workspace=@pulsar/react-ads
npm pack --workspace=@pulsar/react-ads
```

The package uses the public ad, event and stats routes; publishers do not provide an administrator deployment key. Campaign administration is separate: an authenticated account signs in with a password and mandatory emailed one-time code, then redeems the deployment key once to join that deployment's shared administrator group. The key is not an API credential. The existing live showcase is an older snapshot; the current AWS authentication implementation has not been deployed or live-verified.

```tsx
import { AdProvider, AdSlot, AdStats, useAdEvents } from "@pulsar/react-ads";
import type { Ad } from "@pulsar/react-ads";
import { useState } from "react";

function Publisher() {
  const [ad, setAd] = useState<Ad | null>(null);
  const track = useAdEvents();
  return <>
    <AdSlot placement="sidebar" width={300} height={250} onLoad={setAd} onNoFill={() => setAd(null)} />
    <button disabled={!ad} onClick={() => {
      if (ad) track({ eventId: crypto.randomUUID(), type: "conversion", impressionId: ad.impressionId,
        campaignId: ad.campaignId, creativeId: ad.creativeId, placement: "sidebar", ts: Date.now() });
    }}>Record conversion</button>
    <AdStats campaignId="c1" days={7} />
  </>;
}

export function App() {
  return <AdProvider apiUrl="https://ads.example.com"><Publisher /></AdProvider>;
}
```

## AdProvider

`apiUrl` is the API base URL; `children` contains components using the package. Events are queued and sent at 10 events, every five seconds, when the document becomes hidden, and on provider unmount or URL change. Ordinary batches use `fetch` with `keepalive`; failed responses and network errors are requeued with the same event IDs for a later flush while the provider remains mounted. On hidden or unmount the package prefers a plain-string `sendBeacon`, falling back to `fetch`. Browsers do not expose beacon responses, and queues are in memory, so delivery across page exit or a failed final send cannot be guaranteed.

| Prop | Type | Meaning |
| --- | --- | --- |
| `apiUrl` | `string` | Base URL of the Pulsar API. |
| `children` | `ReactNode` | Components using the provider context. |
| `fingerprintConsent` | `boolean` | Explicit visitor consent to site-scoped fingerprinting; defaults to `false`. |

`fingerprintConsent` is optional and defaults to `false`. Set it to `true` only after the visitor explicitly consents; set it back to `false` when consent is withdrawn. The provider derives an origin-scoped SHA-256 fingerprint locally from browser characteristics and attaches it, a coarse browser family and a coarse device category to events while consent is enabled. It does not send the raw user agent or fingerprint inputs. The provider controls these fields; callers cannot override them through `track`. Fingerprinting is unavailable when the browser cannot compute the digest.

`useAdFingerprint()` returns the current fingerprint inside an `AdProvider`, or `null` when consent is off, computation is pending, or the browser cannot compute it. Fingerprints are approximate pseudonymous identifiers, not proof of identity. The backend stores associations and the browser/device categories separately with 30-day TTL; DynamoDB deletes expired records asynchronously. Withdrawal prevents future collection but does not immediately remove prior records. No fingerprint, category labels or raw browser signals are sent to Firehose.

Example opt-in integration:

```tsx
import { useState } from "react";
import { AdProvider, AdSlot, useAdFingerprint } from "@pulsar/react-ads";

function FingerprintStatus() {
  const fingerprint = useAdFingerprint();
  return <p>{fingerprint ? "Fingerprint available" : "No fingerprint"}</p>;
}

export function PublisherWithConsent({ apiUrl }: { apiUrl: string }) {
  const [consent, setConsent] = useState(false);
  return (
    <AdProvider apiUrl={apiUrl} fingerprintConsent={consent}>
      <label>
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        Allow this site to associate ad events with a browser fingerprint.
      </label>
      <p>Records expire after 30 days; deletion may be delayed. Turning this off does not delete previously recorded data.</p>
      <FingerprintStatus />
      <AdSlot placement="sidebar" />
    </AdProvider>
  );
}
```

The digest uses the page origin, user agent, language, platform, hardware concurrency, screen dimensions and color depth, and time zone. Browser settings can change, and different browsers can produce the same digest. The origin is not a secret; this is not anonymous tracking or proof of a unique person. The package does not provide a consent-management system: the publisher is responsible for the notice, consent choice, and applicable privacy requirements.

## AdSlot

| Prop | Type | Description |
| --- | --- | --- |
| `placement` | `string` | Required placement passed to `/ad`. |
| `className` | `string` | Applied to the placeholder, error, and ad link. |
| `width`, `height` | `number` | Expected creative dimensions for the loading placeholder; defaults to 300 × 250. Set these to match the placement's creative dimensions to minimize layout shift. |
| `onLoad` | `(ad: Ad) => void` | Called after a filled response. |
| `onNoFill` | `() => void` | Called for a 204 response. |
| `onClick` | `(ad: Ad, event: React.MouseEvent<HTMLAnchorElement>) => void` | Called on link click after queuing its click event. |

An impression is queued when the ad renders. A viewable event is queued once when at least 50% of the link is visible continuously for one second while the document is visible. Browsers without `IntersectionObserver` do not report viewability.

## useAdEvents

Call the hook inside an `AdProvider` to obtain `track(event)`. An `AdEvent` has `eventId`, `type` (`impression`, `click`, `viewable`, or `conversion`), `impressionId`, `campaignId`, `creativeId`, `placement`, and numeric millisecond timestamp `ts`. Generate a unique `eventId` for each event and retain the ad identifiers from `onLoad` to associate a conversion with an impression.

The provider supplies a session ID for events that omit one. Its scope is the provider instance and API URL; callers may provide their own `sessionId` to correlate across instances.

## AdStats

`<AdStats campaignId="c1" days={7} refreshKey={key} />` displays period totals, daily activity and a UTC breakdown. `days` defaults to 7; change `refreshKey` to refetch. Viewable totals are shown alongside rendered impressions and clicks.
