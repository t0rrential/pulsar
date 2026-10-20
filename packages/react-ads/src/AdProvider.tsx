import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { AdEvent } from "./types";

export interface AdProviderProps {
  apiUrl: string;
  children: ReactNode;
}

interface AdContextValue {
  apiUrl: string;
  track: (event: AdEvent) => void;
}

const AdContext = createContext<AdContextValue | null>(null);

function sendEvent(apiUrl: string, event: AdEvent): void {
  const url = `${apiUrl}/events`;
  const body = JSON.stringify({ events: [event] });

  // A plain string keeps cross-origin beacons CORS-safelisted (text/plain).
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon(url, body)) return;
    }
  } catch {
    // A browser may refuse a beacon synchronously; use the same fallback.
  }

  // Tracking must not break the publisher page or leave rejected promises.
  try {
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Handles unavailable fetch implementations without interrupting navigation.
  }
}

export function AdProvider({ apiUrl, children }: AdProviderProps) {
  const baseUrl = apiUrl.replace(/\/+$/, "");
  const value = useMemo<AdContextValue>(() => ({
    apiUrl: baseUrl,
    track: (event) => sendEvent(baseUrl, event),
  }), [baseUrl]);

  return <AdContext.Provider value={value}>{children}</AdContext.Provider>;
}

export function useAdContext(): AdContextValue {
  const context = useContext(AdContext);
  if (!context) {
    throw new Error("AdSlot and AdStats must be rendered inside an AdProvider.");
  }
  return context;
}
