import { useEffect, useState } from 'react';
import { Fingerprint, RefreshCw } from 'lucide-react';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table';

type Report = {
  totals: { fingerprints: number; newFingerprints: number; returningFingerprints: number; events: number };
  daily: { date: string; fingerprints: number; events: number }[];
  fingerprints: { fingerprint: string; browser: string; device: string; firstSeen: number; lastSeen: number; events: number }[];
  fingerprintsTruncated: boolean;
};
type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'success'; report: Report };

export default function FingerprintReport({ apiUrl, adminKey, campaignId }: { apiUrl: string; adminKey: string; campaignId: string }) {
  const [days, setDays] = useState(7);
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<State>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetch(`${apiUrl.replace(/\/+$/, '')}/campaigns/${encodeURIComponent(campaignId)}/fingerprints?days=${days}`, {
      headers: { authorization: `Bearer ${adminKey}` }, signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Fingerprint report could not be loaded.');
      if (!controller.signal.aborted) setState({ status: 'success', report: data as Report });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ status: 'error', message: error instanceof Error ? error.message : 'Fingerprint report could not be loaded.' });
    });
    return () => controller.abort();
  }, [apiUrl, adminKey, campaignId, days, refresh]);

  const report = state.status === 'success' ? state.report : null;
  const dateTime = (value: number) => new Date(value).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  return <section aria-labelledby="fingerprint-report-heading" className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Consented activity</p><h2 id="fingerprint-report-heading" className="mt-1 flex items-center gap-2 text-lg font-semibold"><Fingerprint className="size-4 text-muted-foreground" />Browser fingerprints</h2></div>
      <div className="flex items-center gap-2"><label htmlFor="fingerprint-period" className="sr-only">Fingerprint reporting period</label><select id="fingerprint-period" value={days} onChange={(event) => setDays(Number(event.target.value))} className="h-9 rounded-md border bg-background px-3 text-sm"><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option></select><Button type="button" variant="outline" size="sm" onClick={() => setRefresh((value) => value + 1)}><RefreshCw />Refresh</Button></div>
    </div>
    <p className="text-xs leading-5 text-muted-foreground">Opted-in fingerprints only; these are estimates, not people. First seen and returning compare only with retained campaign activity, not all-time history. The 30-day view has no earlier comparison window, so returning is zero. Records expire after 30 days and deletion can be delayed. Browser and device labels are unavailable for older records.</p>
    {state.status === 'loading' && <p role="status" className="rounded-lg border p-5 text-sm text-muted-foreground">Loading fingerprint activity…</p>}
    {state.status === 'error' && <p role="alert" className="rounded-lg border border-destructive/30 p-5 text-sm text-destructive">{state.message}</p>}
    {report && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
        ['Distinct fingerprints', report.totals.fingerprints], ['First observed in period', report.totals.newFingerprints], ['Seen earlier in retention', report.totals.returningFingerprints], ['Consented events', report.totals.events],
      ].map(([label, value]) => <Card key={label} className="gap-2 py-4"><CardHeader><CardDescription>{label}</CardDescription></CardHeader><CardContent><p className="text-2xl font-semibold tabular-nums">{Number(value).toLocaleString()}</p></CardContent></Card>)}</div>
      <Card className="gap-0 overflow-hidden py-0"><CardHeader className="border-b py-4"><CardTitle className="text-base">Daily activity</CardTitle><CardDescription>UTC dates; a fingerprint can appear on more than one day.</CardDescription></CardHeader><CardContent className="px-0"><Table><TableHeader><TableRow><TableHead className="pl-6">Date (UTC)</TableHead><TableHead>Distinct fingerprints</TableHead><TableHead className="pr-6 text-right">Events</TableHead></TableRow></TableHeader><TableBody>{report.daily.map((day) => <TableRow key={day.date}><TableCell className="pl-6">{day.date}</TableCell><TableCell>{day.fingerprints.toLocaleString()}</TableCell><TableCell className="pr-6 text-right">{day.events.toLocaleString()}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
      <Card className="gap-0 overflow-hidden py-0"><CardHeader className="border-b py-4"><CardTitle className="text-base">Recent fingerprints</CardTitle><CardDescription>Browser family and device category are the only device labels stored with the hash and event details.{report.fingerprintsTruncated && ' Showing the 200 most recently active fingerprints.'}</CardDescription></CardHeader><CardContent className="overflow-x-auto px-0">{report.fingerprints.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No opted-in activity for this campaign in the selected period.</p> : <Table><TableHeader><TableRow><TableHead className="pl-6">Fingerprint</TableHead><TableHead>Browser</TableHead><TableHead>Device</TableHead><TableHead>Last seen</TableHead><TableHead className="pr-6 text-right">Events</TableHead></TableRow></TableHeader><TableBody>{report.fingerprints.map((row) => <TableRow key={row.fingerprint}><TableCell className="pl-6"><code className="break-all text-xs">{row.fingerprint}</code></TableCell><TableCell>{row.browser}</TableCell><TableCell>{row.device}</TableCell><TableCell className="whitespace-nowrap text-xs">{dateTime(row.lastSeen)}</TableCell><TableCell className="pr-6 text-right">{row.events.toLocaleString()}</TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>
    </>}
  </section>;
}
