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
  type: 'impression' | 'click' | 'viewable' | 'conversion';
  impressionId: string;
  campaignId: string;
  creativeId: string;
  placement: string;
  sessionId?: string;
  fingerprint?: string;
  browser?: 'Chrome' | 'Edge' | 'Firefox' | 'Safari' | 'Other';
  device?: 'Mobile' | 'Tablet' | 'Desktop' | 'Other';
  ts: number;
}

export interface DailyStats {
  date: string;
  requests: number;
  impressions: number;
  clicks: number;
  viewable: number;
  conversions: number;
}

export interface StatsResponse {
  days: DailyStats[];
}

export interface Campaign {
  PK: string;
  SK: 'META';
  name: string;
  status: 'active' | 'paused';
  placements: string[];
  weight: number;
}

export interface Creative {
  PK: string;
  SK: string;
  imageUrl: string;
  headline: string;
  landingUrl: string;
  width: number;
  height: number;
}
