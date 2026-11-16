# @pulsar/react-ads

React components and event tracking for the Pulsar ad API. React and React DOM 18 or 19 are peer dependencies. This package is not published to npm; build and pack it from the workspace:

```sh
npm run build --workspace=@pulsar/react-ads
npm pack --workspace=@pulsar/react-ads
```

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

`fingerprintConsent` is optional and defaults to `false`. Set it to `true` only after the visitor explicitly consents; set it back to `false` when consent is withdrawn. The provider derives an origin-scoped SHA-256 fingerprint from browser characteristics and attaches it to events while consent is enabled. The provider controls this field; callers cannot override it through `track`. Fingerprinting is unavailable when the browser cannot compute the digest.

`useAdFingerprint()` returns the current fingerprint inside an `AdProvider`, or `null` when consent is off, computation is pending, or the browser cannot compute it. Fingerprints are approximate pseudonymous identifiers, not proof of identity. The backend stores associations separately with 30-day TTL; DynamoDB deletes expired records asynchronously. Withdrawal prevents future collection but does not immediately remove prior records. No fingerprint or browser signals are sent to Firehose.

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
