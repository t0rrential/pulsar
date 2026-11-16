// @vitest-environment jsdom

import { StrictMode, useEffect } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AdProvider, useAdEvents, useAdFingerprint } from "../src";
import type { AdEvent } from "../src";
import { coarseUserAgent } from "../src/fingerprint";

it.each([
  ["Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0", "Edge", "Desktop"],
  ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1", "Safari", "Mobile"],
  ["Mozilla/5.0 (Linux; Android 13; Pixel) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36", "Chrome", "Mobile"],
  ["Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Safari/537.36", "Chrome", "Tablet"],
  ["Mozilla/5.0 (iPad; CPU OS 17_0) AppleWebKit/605.1.15 Version/17.0 Safari/604.1", "Safari", "Tablet"],
  ["Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0", "Firefox", "Desktop"],
  ["unrecognized agent", "Other", "Other"],
])("classifies user agent into coarse labels", (ua, browser, device) => {
  expect(coarseUserAgent(ua)).toEqual({ browser, device });
});

const event: AdEvent = { eventId: "event-1", type: "conversion", impressionId: "i1", campaignId: "c1", creativeId: "cr1", placement: "sidebar", ts: 123 };

function Tracker() {
  const track = useAdEvents();
  const fingerprint = useAdFingerprint();
  useEffect(() => { track(event); }, [track]);
  return <><button onClick={() => track({ ...event, eventId: "event-2" })}>Track</button><output>{fingerprint ?? "none"}</output></>;
}

function setup() {
  let resolveDigest!: (value: ArrayBuffer) => void;
  const digest = vi.fn((_algorithm: AlgorithmIdentifier, _data: BufferSource) => new Promise<ArrayBuffer>((resolve) => { resolveDigest = resolve; }));
  vi.stubGlobal("crypto", { randomUUID: () => "session-id", subtle: { digest } });
  const beacon = vi.fn<Navigator["sendBeacon"]>(() => true);
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beacon });
  const flush = () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    fireEvent(document, new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  };
  const events = () => beacon.mock.calls.flatMap(([, body]) => {
    if (typeof body !== "string") throw new Error("Expected a string event body");
    const payload = JSON.parse(body) as { events: AdEvent[] };
    return payload.events;
  });
  return { digest, resolve: () => resolveDigest(new Uint8Array(32).fill(0xab).buffer), flush, events };
}

const originalBeacon = Object.getOwnPropertyDescriptor(navigator, "sendBeacon");
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalBeacon) Object.defineProperty(navigator, "sendBeacon", originalBeacon);
  else Reflect.deleteProperty(navigator, "sendBeacon");
});

it("does not fingerprint without consent and preserves events queued before opting in", async () => {
  const { digest, resolve, flush, events } = setup();
  const { rerender } = render(<AdProvider apiUrl="https://ads.example"><Tracker /></AdProvider>);
  expect(digest).not.toHaveBeenCalled();
  rerender(<AdProvider apiUrl="https://ads.example" fingerprintConsent><Tracker /></AdProvider>);
  expect(digest.mock.calls[0]?.[0]).toBe("SHA-256");
  const input = digest.mock.calls[0]![1] as Uint8Array;
  expect(JSON.parse(new TextDecoder().decode(input))[0]).toBe(window.location.origin);
  fireEvent.click(screen.getByRole("button", { name: "Track" }));
  flush();
  expect(events().every((item) => item.fingerprint === undefined)).toBe(true);
  await act(async () => resolve());
  flush();
  expect(events().map(({ eventId, fingerprint }) => ({ eventId, fingerprint }))).toEqual([
    { eventId: "event-1", fingerprint: undefined },
    { eventId: "event-2", fingerprint: "ab".repeat(32) },
  ]);
  expect(screen.getByText("ab".repeat(32))).toBeTruthy();
});

it("holds early opted-in events until hashing completes, including in StrictMode", async () => {
  const { resolve, flush, events } = setup();
  render(<StrictMode><AdProvider apiUrl="https://ads.example" fingerprintConsent><Tracker /></AdProvider></StrictMode>);
  flush();
  expect(events()).toHaveLength(0);
  await act(async () => resolve());
  flush();
  expect(events().length).toBeGreaterThan(0);
  expect(events().every((item) => item.fingerprint === "ab".repeat(32))).toBe(true);
});

it("removes queued fingerprints on withdrawal and ignores a late digest", async () => {
  const { resolve, flush, events } = setup();
  const { rerender } = render(<AdProvider apiUrl="https://ads.example" fingerprintConsent><Tracker /></AdProvider>);
  rerender(<AdProvider apiUrl="https://ads.example"><Tracker /></AdProvider>);
  await act(async () => resolve());
  fireEvent.click(screen.getByRole("button", { name: "Track" }));
  flush();
  expect(events()).toHaveLength(2);
  expect(events().every((item) => item.fingerprint === undefined)).toBe(true);
  expect(screen.getByText("none")).toBeTruthy();
});

it("sends ordinary events when Web Crypto is unavailable", async () => {
  const { flush, events } = setup();
  vi.stubGlobal("crypto", { randomUUID: () => "session-id" });
  render(<AdProvider apiUrl="https://ads.example" fingerprintConsent><Tracker /></AdProvider>);
  await act(async () => { await Promise.resolve(); });
  flush();
  expect(events().map(({ eventId, fingerprint }) => ({ eventId, fingerprint }))).toEqual([{ eventId: "event-1", fingerprint: undefined }]);
});

it("strips a resolved fingerprint from queued events when consent is withdrawn", async () => {
  const { resolve, flush, events } = setup();
  const { rerender } = render(<AdProvider apiUrl="https://ads.example" fingerprintConsent><Tracker /></AdProvider>);
  await act(async () => resolve());
  rerender(<AdProvider apiUrl="https://ads.example"><Tracker /></AdProvider>);
  flush();
  expect(events()).toHaveLength(1);
  expect(events()[0]?.fingerprint).toBeUndefined();
  expect(events()[0]?.browser).toBeUndefined();
  expect(events()[0]?.device).toBeUndefined();
  expect(screen.getByText("none")).toBeTruthy();
});

it("does not restore a fingerprint when an in-flight batch fails after withdrawal", async () => {
  const { resolve, flush, events } = setup();
  let finishRequest!: (response: Response) => void;
  const response = new Promise<Response>((done) => { finishRequest = done; });
  const fetchMock = vi.fn<typeof fetch>().mockReturnValue(response);
  vi.stubGlobal("fetch", fetchMock);
  const beacon = vi.mocked(navigator.sendBeacon);
  beacon.mockReturnValueOnce(false);
  const { rerender } = render(<AdProvider apiUrl="https://ads.example" fingerprintConsent><Tracker /></AdProvider>);
  await act(async () => resolve());
  flush();
  const sent = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { events: AdEvent[] };
  expect(sent.events[0]?.fingerprint).toBe("ab".repeat(32));
  expect(sent.events[0]?.browser).toBeDefined();
  expect(sent.events[0]?.device).toBeDefined();
  rerender(<AdProvider apiUrl="https://ads.example"><Tracker /></AdProvider>);
  await act(async () => { finishRequest(new Response(null, { status: 503 })); });
  flush();
  expect(events().at(-1)?.fingerprint).toBeUndefined();
  expect(events().at(-1)?.browser).toBeUndefined();
  expect(events().at(-1)?.device).toBeUndefined();
});

it("withdraws consent from an older queue when the API URL changes", async () => {
  const { resolve, flush, events } = setup();
  const { rerender } = render(<AdProvider apiUrl="https://old.example" fingerprintConsent><Tracker /></AdProvider>);
  rerender(<AdProvider apiUrl="https://new.example"><Tracker /></AdProvider>);
  await act(async () => resolve());
  flush();
  expect(events().length).toBeGreaterThan(0);
  expect(events().every((item) => item.fingerprint === undefined)).toBe(true);
});

it("sends only coarse labels with a consented fingerprint", async () => {
  const { resolve, flush, events } = setup();
  const userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1";
  const original = Object.getOwnPropertyDescriptor(navigator, "userAgent");
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: userAgent });
  try {
    render(<AdProvider apiUrl="https://ads.example" fingerprintConsent><Tracker /></AdProvider>);
    await act(async () => resolve());
    flush();
    expect(events()[0]).toMatchObject({ fingerprint: "ab".repeat(32), browser: "Safari", device: "Mobile" });
    expect(JSON.stringify(events())).not.toContain(userAgent);
    expect(events()[0]).not.toHaveProperty("userAgent");
  } finally {
    if (original) Object.defineProperty(navigator, "userAgent", original);
    else Reflect.deleteProperty(navigator, "userAgent");
  }
});

it("ignores caller-supplied fingerprint and labels without consent", () => {
  const { flush, events } = setup();
  function Spoof() {
    const track = useAdEvents();
    useEffect(() => { track({ ...event, fingerprint: "a".repeat(64), browser: "Chrome", device: "Mobile" }); }, [track]);
    return null;
  }
  render(<AdProvider apiUrl="https://ads.example"><Spoof /></AdProvider>);
  flush();
  expect(events()[0]).not.toHaveProperty("fingerprint");
  expect(events()[0]).not.toHaveProperty("browser");
  expect(events()[0]).not.toHaveProperty("device");
});
