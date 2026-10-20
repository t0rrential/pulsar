import { useAdContext } from "./AdProvider";
import { useJsonResource } from "./useJsonResource";
import { useId } from "react";
import type { StatsResponse } from "./types";

export interface AdStatsProps {
  campaignId: string;
  days?: number;
  refreshKey?: string | number;
}

const numberFormat = new Intl.NumberFormat("en-US");
const axisFormat = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const rateFormat = new Intl.NumberFormat("en-US", {
  style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function AdStats({ campaignId, days = 7, refreshKey }: AdStatsProps) {
  const { apiUrl } = useAdContext();
  const query = new URLSearchParams({ campaignId, days: String(days) });
  const resource = useJsonResource<StatsResponse>(`${apiUrl}/stats?${query}`, refreshKey);
  const headingId = useId();

  if (resource.status === "loading") {
    return <div className="stats-loading" role="status"><span className="stats-loading-mark" aria-hidden="true" />Loading campaign performance…</div>;
  }
  if (resource.status === "error") {
    return <div className="stats-error" role="alert"><strong>Campaign data is unavailable.</strong><p>{resource.error.message}</p></div>;
  }

  const daily = resource.data?.days ?? [];
  let requests = 0;
  let impressions = 0;
  let clicks = 0;
  let maximum = 0;
  for (const day of daily) {
    requests += day.requests;
    impressions += day.impressions;
    clicks += day.clicks;
    maximum = Math.max(maximum, day.impressions, day.clicks);
  }
  const chartMaximum = Math.max(4, Math.ceil(maximum / 4) * 4);
  const labelStep = Math.max(1, Math.ceil(daily.length / 7));
  const metrics = [
    { label: "Ad requests", value: numberFormat.format(requests), note: "Filled ad responses" },
    { label: "Impressions", value: numberFormat.format(impressions), note: "Ads rendered" },
    { label: "Clicks", value: numberFormat.format(clicks), note: "Ad link interactions" },
    { label: "Click-through rate", value: impressions ? rateFormat.format(clicks / impressions) : "—", note: "Clicks ÷ impressions" },
  ];

  return (
    <div className="campaign-stats">
      <dl className="stats-metrics" role="group" aria-label={`Campaign ${campaignId} totals`}>
        {metrics.map((metric, index) => (
          <div className="stats-metric" key={metric.label}>
            <dt id={`${headingId}-metric-${index}`}>{metric.label}</dt>
            <dd aria-labelledby={`${headingId}-metric-${index}`}>{metric.value}</dd>
            <p>{metric.note}</p>
          </div>
        ))}
      </dl>
      <section className="stats-activity" aria-labelledby={`${headingId}-activity`}>
        <div className="stats-activity-header">
          <div><h3 id={`${headingId}-activity`}>Daily activity</h3><p>A little perspective on every interaction.</p></div>
          <div className="stats-legend" aria-label="Chart legend"><span><i className="legend-impressions" />Impressions</span><span><i className="legend-clicks" />Clicks</span></div>
        </div>
        <div className="stats-chart">
          <div className="stats-chart-scale" aria-hidden="true"><span>{axisFormat.format(chartMaximum)}</span><span>{axisFormat.format(chartMaximum / 2)}</span><span>0</span></div>
          <div className="stats-chart-plot">
            <svg viewBox="0 0 700 180" preserveAspectRatio="none" role="img" aria-label={`Daily impressions and clicks for campaign ${campaignId}. Exact values are available in the daily breakdown.`} style={{ display: "block", width: "100%", height: 180 }}>
              {[0, 90, 179].map((y) => <line key={y} x1="0" x2="700" y1={y} y2={y} stroke="var(--stats-grid-color, #e7ebe2)" strokeDasharray={y === 179 ? undefined : "3 5"} />)}
              {daily.map((day, index) => {
                const columnWidth = 700 / daily.length;
                const barWidth = Math.min(26, columnWidth * 0.24);
                const center = (index + 0.5) * columnWidth;
                const impressionHeight = day.impressions / chartMaximum * 174;
                const clickHeight = day.clicks / chartMaximum * 174;
                return (
                  <g key={day.date} className="stats-chart-day">
                    <title>{`${day.date}: ${day.impressions} impressions, ${day.clicks} clicks`}</title>
                    <rect x={center - barWidth - 2} y={179 - impressionHeight} width={barWidth} height={impressionHeight} rx="3" fill="var(--stats-impression-color, #8ba27a)" />
                    <rect x={center + 2} y={179 - clickHeight} width={barWidth} height={clickHeight} rx="3" fill="var(--stats-click-color, #2f523e)" />
                  </g>
                );
              })}
            </svg>
            {maximum === 0 && <p className="stats-chart-empty">No impressions or clicks yet.<span>Your first interaction will appear here.</span></p>}
            <div className="stats-chart-dates" style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, daily.length)}, minmax(0, 1fr))` }} aria-hidden="true">
              {daily.map((day, index) => <span key={day.date}>{index % labelStep === 0 || index === daily.length - 1 ? dateFormat.format(new Date(`${day.date}T00:00:00Z`)) : ""}</span>)}
            </div>
          </div>
        </div>
        <div className="stats-chart-footnote"><span>Last {days} days · UTC</span><span>Impressions are counted on render, not viewability.</span></div>
      </section>
      <details className="stats-breakdown">
        <summary><span>Daily breakdown</span><span className="stats-breakdown-hint">{daily.length} days <span aria-hidden="true">↗</span></span></summary>
        <div className="stats-table-scroll" style={{ maxWidth: "100%", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <caption>Campaign {campaignId} statistics — last {days} days (UTC)</caption>
            <thead><tr><th scope="col">Date (UTC)</th><th scope="col">Requests</th><th scope="col">Impressions</th><th scope="col">Clicks</th></tr></thead>
            <tbody>
              {daily.map((day) => (
                <tr key={day.date}><th scope="row"><time dateTime={day.date}>{day.date}</time></th><td>{numberFormat.format(day.requests)}</td><td>{numberFormat.format(day.impressions)}</td><td>{numberFormat.format(day.clicks)}</td></tr>
              ))}
            </tbody>
          </table>
          {daily.length === 0 && <p>No statistics available.</p>}
        </div>
      </details>
    </div>
  );
}
