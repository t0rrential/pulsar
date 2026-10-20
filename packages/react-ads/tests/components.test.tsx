// @vitest-environment jsdom

import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdProvider, AdSlot, AdStats } from "../src/index";
import type { Ad, AdEvent } from "../src/index";

const firstAd: Ad = {
  impressionId: "i1",
  campaignId: "c1",
  creativeId: "cr1",
  imageUrl: "https://images.example/ad.png",
  headline: "A useful product",
  landingUrl: "https://advertiser.example/",
  width: 300,
  height: 250,
};

const secondAd: Ad = {
  ...firstAd,
  impressionId: "i2",
  creativeId: "cr2",
  headline: "Another useful product",
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const fetchMock = vi.fn<typeof fetch>();
const beaconMock = vi.fn<Navigator["sendBeacon"]>();
const originalBeacon = Object.getOwnPropertyDescriptor(navigator, "sendBeacon");

function sentEvents(): AdEvent[] {
  return beaconMock.mock.calls.flatMap(([, body]) => {
    if (typeof body !== "string") throw new Error("Expected a plain string beacon body.");
    // This reads our own serialized event envelope, not an external API response.
    const payload = JSON.parse(body) as { events: AdEvent[] };
    return payload.events;
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  beaconMock.mockReset().mockReturnValue(true);
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: beaconMock,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalBeacon) {
    Object.defineProperty(navigator, "sendBeacon", originalBeacon);
  } else {
    Reflect.deleteProperty(navigator, "sendBeacon");
  }
});

describe("AdSlot", () => {
  it("reuses its initial request in StrictMode and still displays and tracks the result", async () => {
    const response = deferredResponse();
    fetchMock.mockReturnValue(response.promise);

    render(
      <StrictMode>
        <AdProvider apiUrl="https://ads.example/">
          <AdSlot placement="sidebar" />
        </AdProvider>
      </StrictMode>,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => response.resolve(jsonResponse(firstAd)));

    await screen.findByRole("link", { name: "A useful product" });
    expect(sentEvents().map((event) => event.type)).toEqual(["impression"]);
  });

  it("renders nothing and does not track when the API returns no fill", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const { container } = render(
      <AdProvider apiUrl="https://ads.example"><AdSlot placement="empty" /></AdProvider>,
    );

    await waitFor(() => expect(container.textContent).toBe(""));
    expect(container.childElementCount).toBe(0);
    expect(beaconMock).not.toHaveBeenCalled();
  });

  it("ignores stale ad responses after the placement and provider URL change", async () => {
    const oldResponse = deferredResponse();
    const newResponse = deferredResponse();
    fetchMock.mockReturnValueOnce(oldResponse.promise).mockReturnValueOnce(newResponse.promise);
    const { rerender } = render(
      <AdProvider apiUrl="https://old.example"><AdSlot placement="sidebar" /></AdProvider>,
    );
    rerender(
      <AdProvider apiUrl="https://new.example"><AdSlot placement="banner" /></AdProvider>,
    );

    await act(async () => newResponse.resolve(jsonResponse(secondAd)));
    await screen.findByRole("link", { name: "Another useful product" });
    await act(async () => oldResponse.resolve(jsonResponse(firstAd)));

    expect(screen.queryByRole("link", { name: "A useful product" })).toBeNull();
    expect(sentEvents()).toEqual([
      expect.objectContaining({ type: "impression", impressionId: "i2", placement: "banner" }),
    ]);
  });

  it("fetches and counts a new impression after an actual unmount and remount", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(firstAd)).mockResolvedValueOnce(jsonResponse(secondAd));
    const first = render(
      <AdProvider apiUrl="https://ads.example"><AdSlot placement="sidebar" /></AdProvider>,
    );
    await screen.findByRole("link", { name: "A useful product" });
    first.unmount();
    render(<AdProvider apiUrl="https://ads.example"><AdSlot placement="sidebar" /></AdProvider>);
    await screen.findByRole("link", { name: "Another useful product" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentEvents().map((event) => event.impressionId)).toEqual(["i1", "i2"]);
  });

  it("tracks clicks with distinct UUIDs and uses keepalive when a beacon is rejected", async () => {
    beaconMock.mockReturnValue(false);
    fetchMock.mockResolvedValueOnce(jsonResponse(firstAd)).mockResolvedValue(new Response(null, { status: 202 }));
    render(<AdProvider apiUrl="https://ads.example"><AdSlot placement="sidebar" /></AdProvider>);
    const link = await screen.findByRole("link", { name: "A useful product" });
    fireEvent.click(link);

    const events = sentEvents();
    expect(events.map((event) => event.type)).toEqual(["impression", "click"]);
    expect(events[0]?.eventId).not.toBe(events[1]?.eventId);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[1]?.keepalive).toBe(true);
  });

  it("uses the fetch fallback without unhandled rejection when sendBeacon is unavailable", async () => {
    Reflect.deleteProperty(navigator, "sendBeacon");
    fetchMock.mockResolvedValueOnce(jsonResponse(firstAd)).mockRejectedValue(new Error("offline"));
    render(<AdProvider apiUrl="https://ads.example"><AdSlot placement="sidebar" /></AdProvider>);
    await screen.findByRole("link", { name: "A useful product" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[1]?.keepalive).toBe(true);
  });

});

describe("AdStats", () => {
  it("calculates period CTR from total clicks and impressions, not an average of daily rates", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      days: [
        { date: "2026-10-16", requests: 12, impressions: 10, clicks: 5 },
        { date: "2026-10-17", requests: 100, impressions: 90, clicks: 0 },
      ],
    }));
    render(<AdProvider apiUrl="https://ads.example"><AdStats campaignId="c1" /></AdProvider>);
    const ctr = await screen.findByRole("definition", { name: "Click-through rate" });
    expect(ctr.textContent).toBe("5.00%");
    expect(screen.getByRole("definition", { name: "Impressions" }).textContent).toBe("100");
    expect(screen.getByRole("definition", { name: "Clicks" }).textContent).toBe("5");
  });

  it("does not report a click-through rate before any impression is recorded", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      days: [{ date: "2026-10-17", requests: 1, impressions: 0, clicks: 1 }],
    }));
    render(<AdProvider apiUrl="https://ads.example"><AdStats campaignId="c1" /></AdProvider>);
    const ctr = await screen.findByRole("definition", { name: "Click-through rate" });
    expect(ctr.textContent).toBe("—");
  });

  it("defaults to seven days, avoids StrictMode duplicate requests, and refreshes on refreshKey", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      days: [{ date: "2026-10-17", requests: 4, impressions: 3, clicks: 1 }],
    })).mockResolvedValueOnce(jsonResponse({
      days: [{ date: "2026-10-17", requests: 4, impressions: 3, clicks: 2 }],
    }));
    const { rerender } = render(
      <StrictMode>
        <AdProvider apiUrl="https://ads.example"><AdStats campaignId="c1" /></AdProvider>
      </StrictMode>,
    );
    await screen.findByRole("table", { name: /c1/ });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender(
      <StrictMode>
        <AdProvider apiUrl="https://ads.example"><AdStats campaignId="c1" refreshKey={1} /></AdProvider>
      </StrictMode>,
    );
    await screen.findByRole("cell", { name: "2" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not replace current statistics with a stale response", async () => {
    const oldResponse = deferredResponse();
    const newResponse = deferredResponse();
    fetchMock.mockReturnValueOnce(oldResponse.promise).mockReturnValueOnce(newResponse.promise);
    const { rerender } = render(
      <AdProvider apiUrl="https://ads.example"><AdStats campaignId="c1" /></AdProvider>,
    );
    rerender(<AdProvider apiUrl="https://ads.example"><AdStats campaignId="c2" days={3} /></AdProvider>);
    await act(async () => newResponse.resolve(jsonResponse({
      days: [{ date: "2026-10-17", requests: 8, impressions: 6, clicks: 2 }],
    })));
    await screen.findByRole("table", { name: /c2/ });
    await act(async () => oldResponse.resolve(jsonResponse({
      days: [{ date: "2026-10-16", requests: 1, impressions: 1, clicks: 0 }],
    })));
    expect(screen.queryByRole("rowheader", { name: "2026-10-16" })).toBeNull();
    expect(screen.getByRole("cell", { name: "8" })).toBeTruthy();
  });

});
