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
  type: "impression" | "click";
  impressionId: string;
  campaignId: string;
  creativeId: string;
  placement: string;
  ts: number;
}

export interface DailyStats {
  date: string;
  requests: number;
  impressions: number;
  clicks: number;
}

export interface StatsResponse {
  days: DailyStats[];
}
