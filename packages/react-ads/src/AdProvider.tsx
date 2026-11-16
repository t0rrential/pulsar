import { createContext, useContext, useEffect, useInsertionEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { browserFingerprint } from "./fingerprint";
import type { AdEvent } from "./types";

export interface AdProviderProps {
  apiUrl: string;
  children: ReactNode;
  /** Explicit consent to site-scoped fingerprinting. Defaults to false. */
  fingerprintConsent?: boolean;
}

interface AdContextValue {
  apiUrl: string;
  track: (event: AdEvent) => void;
  subscribe: (listener: () => void) => () => void;
  getFingerprint: () => string | null;
}

const AdContext = createContext<AdContextValue | null>(null);

export function AdProvider({ apiUrl, children, fingerprintConsent = false }: AdProviderProps) {
  const baseUrl = apiUrl.replace(/\/+$/, "");
  const queues = useRef(new Set<{ setConsent: (consent: boolean) => void }>());
  const queue = useMemo(() => {
    type QueuedEvent = { event: AdEvent; consentVersion: number | null };
    let events: QueuedEvent[] = [];
    let sending = false;
    let stopped = false;
    let unloadRequested = false;
    let consent = false;
    let version = 0;
    let fingerprint: string | null = null;
    let pending = false;
    const listeners = new Set<() => void>();
    const notify = () => listeners.forEach((listener) => listener());
    const sessionId = crypto.randomUUID();
    const url = `${baseUrl}/events`;
    const flush = (unloading = false): void => {
      if (unloading) unloadRequested = true;
      if (sending) return;
      if (!events.length) {
        unloadRequested = false;
        if (stopped) queues.current.delete(controller);
        return;
      }
      // A consented event must wait for its digest, but older events can go out.
      const ready = events.findIndex((item) => pending && item.consentVersion === version);
      const count = Math.min(10, ready < 0 ? events.length : ready);
      if (!count) return;
      const batch = events.splice(0, count);
      const body = JSON.stringify({ events: batch.map(({ event, consentVersion }) => ({
        ...event,
        ...(consent && consentVersion === version && fingerprint ? { fingerprint } : {}),
      })) });
      if (unloading) {
        try {
          if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url, body)) {
            if (events.length) flush(true);
            else {
              unloadRequested = false;
              if (stopped) queues.current.delete(controller);
            }
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
            if (succeeded && (stopped || unloadRequested)) flush(true);
            else if (succeeded && events.length >= 10) flush();
          });
      } catch {
        sending = false;
        events.unshift(...batch);
      }
    };
    const controller: {
      flush: (unloading?: boolean) => void;
      start: () => void;
      stop: () => void;
      setConsent: (consent: boolean) => void;
      notify: () => void;
      value: AdContextValue;
    } = {
      flush,
      start: () => { stopped = false; queues.current.add(controller); },
      stop: () => { stopped = true; flush(true); },
      setConsent: (next: boolean) => {
        if (consent === next) return;
        consent = next;
        const current = ++version;
        fingerprint = null;
        pending = next;
        if (next) {
          void browserFingerprint().then((result) => {
            if (!consent || current !== version) return;
            fingerprint = result;
            pending = false;
            notify();
            if (stopped || unloadRequested) flush(true);
            else if (events.length >= 10) flush();
          });
        } else if (stopped || unloadRequested || events.length >= 10) {
          flush(stopped || unloadRequested);
        }
      },
      notify,
      value: {
        apiUrl: baseUrl,
        track: (event: AdEvent) => {
          // The provider, not a caller-supplied field, controls fingerprint consent.
          const { fingerprint: _fingerprint, ...safeEvent } = event;
          events.push({ event: { ...safeEvent, sessionId: event.sessionId ?? sessionId }, consentVersion: consent ? version : null });
          if (stopped) { queues.current.add(controller); flush(true); }
          else if (events.length >= 10) flush();
        },
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        getFingerprint: () => consent ? fingerprint : null,
      },
    };
    return controller;
  }, [baseUrl]);
  const contextValue = useMemo(() => ({
    ...queue.value,
    getFingerprint: () => fingerprintConsent ? queue.value.getFingerprint() : null,
  }), [queue, fingerprintConsent]);

  // Commit consent before any descendant layout or passive effects can track.
  useInsertionEffect(() => {
    queues.current.add(queue);
    if (fingerprintConsent) queue.setConsent(true);
    else queues.current.forEach((item) => item.setConsent(false));
  }, [queue, fingerprintConsent]);
  useEffect(() => { queue.notify(); }, [queue, fingerprintConsent]);
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

  return <AdContext.Provider value={contextValue}>{children}</AdContext.Provider>;
}

export function useAdContext(): AdContextValue {
  const context = useContext(AdContext);
  if (!context) throw new Error("AdSlot, AdStats, useAdEvents and useAdFingerprint must be used inside an AdProvider.");
  return context;
}

/** Queue a complete event, including a unique eventId and timestamp. */
export function useAdEvents(): AdContextValue["track"] {
  return useAdContext().track;
}

/** The current consented fingerprint, or null while unavailable or not consented. */
export function useAdFingerprint(): string | null {
  const { subscribe, getFingerprint } = useAdContext();
  return useSyncExternalStore(subscribe, getFingerprint, () => null);
}
