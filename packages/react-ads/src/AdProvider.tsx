import { createContext, useContext, useEffect, useMemo } from "react";
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

export function AdProvider({ apiUrl, children }: AdProviderProps) {
  const baseUrl = apiUrl.replace(/\/+$/, "");
  const queue = useMemo(() => {
    let events: AdEvent[] = [];
    let sending = false;
    let stopped = false;
    const sessionId = crypto.randomUUID();
    const url = `${baseUrl}/events`;
    const flush = (unloading = false) => {
      if (!events.length || sending) return;
      const batch = events.splice(0, 10);
      const body = JSON.stringify({ events: batch });
      if (unloading) {
        try {
          if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url, body)) {
            if (events.length) flush(true);
            return;
          }
        } catch { /* Fall back to fetch. */ }
      }
      sending = true;
      try {
        void fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body, keepalive: true })
          .then((response) => {
            if (!response.ok) {
              events.unshift(...batch);
              return false;
            }
            return true;
          }, () => { events.unshift(...batch); return false; })
          .then((succeeded) => {
            sending = false;
            if (stopped && succeeded) flush(true);
            else if (!stopped && succeeded && events.length >= 10) flush();
          });
      } catch {
        sending = false;
        events.unshift(...batch);
      }
    };
    return {
      flush,
      start: () => { stopped = false; },
      stop: () => { stopped = true; flush(true); },
      value: { apiUrl: baseUrl, track: (event: AdEvent) => {
        events.push({ ...event, sessionId: event.sessionId ?? sessionId });
        if (events.length >= 10) flush();
      } },
    };
  }, [baseUrl]);

  useEffect(() => {
    queue.start();
    const timer = setInterval(() => queue.flush(), 5000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") queue.flush(true);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      queue.stop();
    };
  }, [queue]);

  return <AdContext.Provider value={queue.value}>{children}</AdContext.Provider>;
}

export function useAdContext(): AdContextValue {
  const context = useContext(AdContext);
  if (!context) throw new Error("AdSlot, AdStats and useAdEvents must be used inside an AdProvider.");
  return context;
}

/** Queue a complete event, including a unique eventId and timestamp. */
export function useAdEvents(): AdContextValue["track"] {
  return useAdContext().track;
}
