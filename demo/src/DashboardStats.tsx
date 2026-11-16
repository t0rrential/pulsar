import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table';

type DailyStats = {
  date: string;
  requests: number;
  impressions: number;
  viewable?: number;
  clicks: number;
  conversions?: number;
};

type StatsState =
  | { key: string; status: 'loading' }
  | { key: string; status: 'error'; message: string }
  | { key: string; status: 'success'; days: DailyStats[] };

const numberFormat = new Intl.NumberFormat();
const rateFormat = new Intl.NumberFormat(undefined, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function DashboardStats({ apiUrl, campaignId, days = 7, refreshKey }: {
  apiUrl: string;
  campaignId: string;
  days?: number;
  refreshKey?: string | number;
}) {
  const [retry, setRetry] = useState(0);
  const query = new URLSearchParams({ campaignId, days: String(days) });
  const url = `${apiUrl.replace(/\/$/, '')}/stats?${query}`;
  const requestKey = JSON.stringify([url, refreshKey, retry]);
  const [state, setState] = useState<StatsState>({ key: requestKey, status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ key: requestKey, status: 'loading' });
    async function load() {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        const data: { days?: DailyStats[] } = await response.json();
        if (!Array.isArray(data.days)) throw new Error('Invalid statistics response');
        if (active) setState({ key: requestKey, status: 'success', days: data.days });
      } catch (error) {
        if (active) setState({ key: requestKey, status: 'error', message: error instanceof Error ? error.message : 'Unable to load statistics' });
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [url, requestKey]);

  const current: StatsState = state.key === requestKey ? state : { key: requestKey, status: 'loading' };
  const daily = current.status === 'success' ? current.days : [];
  const totals = daily.reduce((sum, day) => ({
    requests: sum.requests + day.requests,
    impressions: sum.impressions + day.impressions,
    viewable: sum.viewable + (day.viewable ?? 0),
    clicks: sum.clicks + day.clicks,
    conversions: sum.conversions + (day.conversions ?? 0),
  }), { requests: 0, impressions: 0, viewable: 0, clicks: 0, conversions: 0 });
  const hasViewable = daily.length > 0 && daily.every((day) => typeof day.viewable === 'number');
  const hasConversions = daily.length > 0 && daily.every((day) => typeof day.conversions === 'number');
  const metrics = [
    { label: 'Requests', value: numberFormat.format(totals.requests), note: 'Filled ad responses' },
    { label: 'Impressions', value: numberFormat.format(totals.impressions), note: 'Ads rendered' },
    { label: 'Viewable', value: hasViewable ? numberFormat.format(totals.viewable) : '—', note: hasViewable ? 'Visible for at least one second' : 'Not available from this API' },
    { label: 'Clicks', value: numberFormat.format(totals.clicks), note: 'Ad link interactions' },
    { label: 'Conversions', value: hasConversions ? numberFormat.format(totals.conversions) : '—', note: hasConversions ? 'Recorded conversions' : 'Not available from this API' },
    { label: 'Click-through rate', value: totals.impressions ? rateFormat.format(totals.clicks / totals.impressions) : '—', note: 'Clicks ÷ impressions' },
  ];
  const maximum = Math.max(0, ...daily.flatMap((day) => [day.impressions, day.clicks]));
  const labelStep = Math.max(1, Math.ceil(daily.length / 7));

  return (
    <section aria-label={`Statistics for campaign ${campaignId}`} className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Performance overview</h2>
        <p className="mt-1 text-sm text-muted-foreground">Last {days} days · UTC</p>
      </div>
      {current.status === 'loading' ? (
        <Card><CardContent className="py-8 text-sm text-muted-foreground" role="status">Loading campaign statistics…</CardContent></Card>
      ) : current.status === 'error' ? (
        <Card><CardContent className="space-y-3 py-6"><p role="alert" className="text-sm text-destructive">Could not load statistics: {current.message}</p><Button type="button" variant="outline" size="sm" onClick={() => setRetry((value) => value + 1)}>Try again</Button></CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            {metrics.map((metric) => <Card key={metric.label} className="gap-3 py-5"><CardHeader className="px-5"><CardDescription className="font-medium">{metric.label}</CardDescription></CardHeader><CardContent className="px-5"><p className="text-2xl font-semibold tracking-tight tabular-nums">{metric.value}</p><p className="mt-1 text-xs text-muted-foreground">{metric.note}</p></CardContent></Card>)}
          </div>
          <Card className="gap-5">
            <CardHeader className="gap-3 sm:flex sm:items-start sm:justify-between">
              <div><CardTitle>Daily activity</CardTitle><CardDescription className="mt-1.5">Impressions and clicks over time</CardDescription></div>
              <div className="flex gap-4 text-xs text-muted-foreground" aria-label="Chart legend"><span className="flex items-center gap-2"><span className="size-2 rounded-sm bg-emerald-600" />Impressions</span><span className="flex items-center gap-2"><span className="size-2 rounded-sm bg-zinc-400" />Clicks</span></div>
            </CardHeader>
            <CardContent>
              {daily.length === 0 ? <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground"><BarChart3 className="size-5" aria-hidden="true" /><p>No daily statistics available for this period.</p></div> : (
                <>
                  <div className="flex gap-3"><div aria-hidden="true" className="flex h-44 flex-col justify-between text-xs tabular-nums text-muted-foreground"><span>{numberFormat.format(maximum)}</span><span>0</span></div><div className="min-w-0 flex-1"><svg viewBox="0 0 700 176" preserveAspectRatio="none" className="block h-44 w-full" role="img" aria-label={`Daily impressions and clicks for campaign ${campaignId}. Exact values are in the daily breakdown.`}><line x1="0" x2="700" y1="1" y2="1" stroke="currentColor" className="text-border" strokeDasharray="4 4" /><line x1="0" x2="700" y1="175" y2="175" stroke="currentColor" className="text-border" />{daily.map((day, index) => { const width = 700 / daily.length; const bar = Math.min(16, width * 0.32); const center = (index + 0.5) * width; const impressionHeight = maximum ? day.impressions / maximum * 170 : 0; const clickHeight = maximum ? day.clicks / maximum * 170 : 0; return <g key={`${day.date}-${index}`}><title>{`${day.date}: ${day.impressions} impressions, ${day.clicks} clicks`}</title><rect x={center - bar - 1} y={175 - impressionHeight} width={bar} height={impressionHeight} rx="2" className="fill-emerald-600" /><rect x={center + 1} y={175 - clickHeight} width={bar} height={clickHeight} rx="2" className="fill-zinc-400" /></g>; })}</svg><div aria-hidden="true" className="mt-2 grid text-[10px] text-muted-foreground" style={{ gridTemplateColumns: `repeat(${daily.length}, minmax(0, 1fr))` }}>{daily.map((day, index) => <span key={`${day.date}-${index}`} className="truncate text-center">{index % labelStep === 0 ? day.date.slice(5) : ''}</span>)}</div></div></div>
                  {maximum === 0 && <p className="mt-4 text-center text-sm text-muted-foreground">No impressions or clicks recorded in this period.</p>}
                </>
              )}
            </CardContent>
          </Card>
          <Card className="gap-4">
            <CardHeader><CardTitle>Daily breakdown</CardTitle><CardDescription>Recorded activity by UTC day</CardDescription></CardHeader>
            <CardContent className="px-4 sm:px-6">
              <Table>
                <caption className="sr-only">Daily statistics for campaign {campaignId} in UTC</caption>
                <TableHeader><TableRow><TableHead scope="col">Date (UTC)</TableHead><TableHead scope="col" className="text-right">Requests</TableHead><TableHead scope="col" className="text-right">Impressions</TableHead><TableHead scope="col" className="text-right">Viewable</TableHead><TableHead scope="col" className="text-right">Clicks</TableHead><TableHead scope="col" className="text-right">Conversions</TableHead></TableRow></TableHeader>
                <TableBody>{daily.length === 0 ? <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No daily statistics available for this period.</TableCell></TableRow> : daily.map((day, index) => (
                  <TableRow key={`${day.date}-${index}`}>
                    <th scope="row" className="p-2 text-left font-medium whitespace-nowrap"><time dateTime={day.date}>{day.date}</time></th>
                    <TableCell className="text-right tabular-nums">{numberFormat.format(day.requests)}</TableCell>
                    <TableCell className="text-right tabular-nums">{numberFormat.format(day.impressions)}</TableCell>
                    <TableCell className="text-right tabular-nums">{typeof day.viewable === 'number' ? numberFormat.format(day.viewable) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{numberFormat.format(day.clicks)}</TableCell>
                    <TableCell className="text-right tabular-nums">{typeof day.conversions === 'number' ? numberFormat.format(day.conversions) : '—'}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}
