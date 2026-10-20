import { useEffect, useRef } from "react";
import { useAdContext } from "./AdProvider";
import { useJsonResource } from "./useJsonResource";
import type { Ad, AdEvent } from "./types";

export interface AdSlotProps {
  placement: string;
}

function createEvent(type: AdEvent["type"], ad: Ad, placement: string): AdEvent {
  return {
    eventId: crypto.randomUUID(),
    type,
    impressionId: ad.impressionId,
    campaignId: ad.campaignId,
    creativeId: ad.creativeId,
    placement,
    ts: Date.now(),
  };
}

export function AdSlot({ placement }: AdSlotProps) {
  const { apiUrl, track } = useAdContext();
  const query = new URLSearchParams({ placement });
  const resource = useJsonResource<Ad>(`${apiUrl}/ad?${query}`, undefined, true);
  const ad = resource.status === "success" ? resource.data : null;
  const lastImpression = useRef<Ad | null>(null);

  useEffect(() => {
    if (!ad || lastImpression.current === ad) return;
    lastImpression.current = ad;
    track(createEvent("impression", ad, placement));
  }, [ad, placement, track]);

  if (resource.status === "loading") return <p role="status">Loading ad…</p>;
  if (resource.status === "error") {
    return <p role="alert">Unable to load ad. {resource.error.message}</p>;
  }
  if (!ad) return null;

  return (
    <a
      href={ad.landingUrl}
      target="_blank"
      rel="sponsored noopener noreferrer"
      onClick={() => track(createEvent("click", ad, placement))}
      style={{ display: "block", width: "100%", maxWidth: ad.width }}
    >
      <img
        src={ad.imageUrl}
        alt=""
        width={ad.width}
        height={ad.height}
        style={{ display: "block", width: "100%", height: "auto" }}
      />
      <span style={{ display: "block", marginTop: "0.5rem" }}>{ad.headline}</span>
    </a>
  );
}
