export interface Ad {
  impressionId: string;
  campaignId: string;
  creativeId: string;
  imageUrl: string;
  headline: string;
  landingUrl: string;
  width: number;
  height: number;
}

export interface AdEvent {
  eventId: string;
  type: "impression" | "click" | "viewable" | "conversion";
  impressionId: string;
  campaignId: string;
  creativeId: string;
  placement: string;
  sessionId?: string;
  /** SHA-256 site-scoped pseudonymous fingerprint, when consented and available. */
  fingerprint?: string;
  browser?: "Chrome" | "Edge" | "Firefox" | "Safari" | "Other";
  device?: "Mobile" | "Tablet" | "Desktop" | "Other";
  ts: number;
}

export interface DailyStats {
  date: string;
  requests: number;
  impressions: number;
  viewable?: number;
  conversions?: number;
  clicks: number;
}

export interface StatsResponse {
  days: DailyStats[];
}
