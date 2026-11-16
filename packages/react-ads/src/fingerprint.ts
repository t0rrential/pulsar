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

