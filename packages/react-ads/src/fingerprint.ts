import type { AdEvent } from "./types";

/** Extract only broad categories; the user agent itself is never sent. */
export function coarseUserAgent(userAgent: string): { browser: NonNullable<AdEvent["browser"]>; device: NonNullable<AdEvent["device"]> } {
  const browser = /(?:Edg|EdgiOS|EdgA)\//i.test(userAgent) ? "Edge"
    : /(?:Firefox|FxiOS)\//i.test(userAgent) ? "Firefox"
    : /(?:Chrome|CriOS)\//i.test(userAgent) ? "Chrome"
    : /Version\/.*Safari\//i.test(userAgent) ? "Safari"
    : "Other";
  const device = /iPad|Tablet/i.test(userAgent) || (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent)) ? "Tablet"
    : /Mobile|iPhone|iPod/i.test(userAgent) ? "Mobile"
    : /Windows NT|Macintosh|X11|Linux/i.test(userAgent) ? "Desktop"
    : "Other";
  return { browser, device };
}

// Signals stay in this browser; only their site-scoped digest is sent.
export async function browserFingerprint(): Promise<string | null> {
  try {
    if (typeof window === "undefined" || typeof navigator === "undefined" || !globalThis.crypto?.subtle || typeof TextEncoder === "undefined") return null;
    const signals = JSON.stringify([
      window.location.origin,
      navigator.userAgent,
      navigator.language,
      navigator.platform,
      navigator.hardwareConcurrency,
      window.screen.width,
      window.screen.height,
      window.screen.colorDepth,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ]);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(signals));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

