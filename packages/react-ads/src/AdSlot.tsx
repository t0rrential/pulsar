import { useEffect, useRef } from "react";
import type { MouseEvent } from "react";
import { useAdContext } from "./AdProvider";
import { useJsonResource } from "./useJsonResource";
import type { Ad, AdEvent } from "./types";

export interface AdSlotProps {
  placement: string;
  className?: string;
  width?: number;
  height?: number;
  onLoad?: (ad: Ad) => void;
  onNoFill?: () => void;
  onClick?: (ad: Ad, event: MouseEvent<HTMLAnchorElement>) => void;
}

function createEvent(type: AdEvent["type"], ad: Ad, placement: string): AdEvent {
  return { eventId: crypto.randomUUID(), type, impressionId: ad.impressionId, campaignId: ad.campaignId, creativeId: ad.creativeId, placement, ts: Date.now() };
}

export function AdSlot({ placement, className, width = 300, height = 250, onLoad, onNoFill, onClick }: AdSlotProps) {
  const { apiUrl, track } = useAdContext();
  const query = new URLSearchParams({ placement });
  const resource = useJsonResource<Ad>(`${apiUrl}/ad?${query}`, undefined, true);
  const ad = resource.status === "success" ? resource.data : null;
  const lastResult = useRef<typeof resource | null>(null);
  const viewableAd = useRef<Ad | null>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const callbacks = useRef({ onLoad, onNoFill });
  callbacks.current = { onLoad, onNoFill };

  useEffect(() => {
    if (resource.status !== "success" || lastResult.current === resource) return;
    lastResult.current = resource;
    if (resource.data) {
      track(createEvent("impression", resource.data, placement));
      callbacks.current.onLoad?.(resource.data);
    } else {
      callbacks.current.onNoFill?.();
    }
  }, [resource, placement, track]);

  useEffect(() => {
    const element = linkRef.current;
    if (!ad || !element || viewableAd.current === ad || typeof IntersectionObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let visible = false;
    const cancel = () => { clearTimeout(timer); timer = undefined; };
    const update = () => {
      cancel();
      if (visible && document.visibilityState !== "hidden" && viewableAd.current !== ad) {
        timer = setTimeout(() => {
          viewableAd.current = ad;
          track(createEvent("viewable", ad, placement));
          observer.disconnect();
        }, 1000);
      }
    };
    const observer = new IntersectionObserver((entries) => {
      const entry = entries.find((item) => item.target === element);
      if (!entry) return;
      const next = entry.isIntersecting && entry.intersectionRatio >= 0.5;
      if (next !== visible) { visible = next; update(); }
    }, { threshold: 0.5 });
    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    return () => { cancel(); observer.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, [ad, placement, track]);

  if (resource.status === "loading") return <div className={className} role="status" style={{ width: "100%", maxWidth: width, aspectRatio: `${width} / ${height}` }}>Loading ad…</div>;
  if (resource.status === "error") return <p className={className} role="alert">Unable to load ad. {resource.error.message}</p>;
  if (!ad) return null;

  return (
    <a ref={linkRef} className={className} href={ad.landingUrl} target="_blank" rel="sponsored noopener noreferrer"
      onClick={(event) => { track(createEvent("click", ad, placement)); onClick?.(ad, event); }}
      style={{ display: "block", width: "100%", maxWidth: ad.width }}>
      <img src={ad.imageUrl} alt="" width={ad.width} height={ad.height} style={{ display: "block", width: "100%", height: "auto" }} />
      <span style={{ display: "block", marginTop: "0.5rem" }}>{ad.headline}</span>
    </a>
  );
}
