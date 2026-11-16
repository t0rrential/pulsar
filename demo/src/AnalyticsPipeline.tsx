import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { NativeSelect, NativeSelectOption } from './components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table';

type Pipeline = { stream: { name: string; status: string }; objects: { key: string; size: number; lastModified: string }[]; objectsIncomplete: boolean };
type Query = { id: string; state: string; scannedBytes: number; reason?: string; columns?: string[]; rows?: (string | null)[][]; truncated?: boolean };

export default function AnalyticsPipeline({ apiUrl, adminKey }: { apiUrl: string; adminKey: string }) {
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [queryError, setQueryError] = useState('');
  const [queryBusy, setQueryBusy] = useState(false);
  const [query, setQuery] = useState<Query | null>(null);
  const [templateId, setTemplateId] = useState('daily-events');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const request = useCallback(async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${apiUrl.replace(/\/+$/, '')}${path}`, {
      ...options, headers: { 'x-admin-key': adminKey, ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error || `Request failed (${response.status}).`);
    return body as T;
  }, [apiUrl, adminKey]);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { setPipeline(await request<Pipeline>('/analytics/pipeline')); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load pipeline.'); }
    finally { setLoading(false); }
  }, [request]);


  async function startQuery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setQueryBusy(true); setQueryError(''); setQuery(null);
    try {
      const result = await request<{ id: string }>('/analytics/queries', { method: 'POST', body: JSON.stringify({ templateId, startDate, endDate }) });
      setQuery({ id: result.id, state: 'QUEUED', scannedBytes: 0 });
    } catch (cause) { setQueryError(cause instanceof Error ? cause.message : 'Could not start query.'); }
    finally { setQueryBusy(false); }
  }

  async function refreshQuery() {
    if (!query) return;
    setQueryBusy(true); setQueryError('');
    try { setQuery(await request<Query>(`/analytics/queries/${encodeURIComponent(query.id)}`)); }
    catch (cause) { setQueryError(cause instanceof Error ? cause.message : 'Could not load query.'); }
    finally { setQueryBusy(false); }
  }

  return <section id="analytics-pipeline" className="space-y-6" aria-label="Analytics pipeline">
    <Card>
      <CardHeader><CardTitle>Analytics pipeline</CardTitle><CardDescription>Firehose delivery and S3 object metadata. No raw event data is shown. Listing objects incurs S3 request charges.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <Button type="button" variant="outline" disabled={loading} onClick={() => void refresh()}>{loading ? 'Loading…' : pipeline ? 'Refresh pipeline' : 'Load pipeline'}</Button>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {pipeline && <><p className="text-sm">Stream <strong>{pipeline.stream.name}</strong>: {pipeline.stream.status}</p>
          {pipeline.objectsIncomplete && <p className="text-sm text-muted-foreground">Listing was capped to limit costs. These are recent objects within the scanned sample, not necessarily the newest in the bucket.</p>}
          {pipeline.objects.length === 0 ? <p className="text-sm text-muted-foreground">No event or error objects found.</p> :
            <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Object key</TableHead><TableHead>Last modified (UTC)</TableHead><TableHead>Bytes</TableHead></TableRow></TableHeader><TableBody>
              {pipeline.objects.map((object) => <TableRow key={object.key}><TableCell className="break-all">{object.key}</TableCell><TableCell>{object.lastModified}</TableCell><TableCell>{object.size.toLocaleString()}</TableCell></TableRow>)}
            </TableBody></Table></div>}
        </>}
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>Query delivered events</CardTitle><CardDescription>Athena queries and S3 storage incur costs. Firehose buffers delivery; retries and late arrivals can delay data. Dates select UTC arrival-date partitions, not event dates. No query runs until you click Run query.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => void startQuery(event)}>
          <div className="space-y-2"><Label htmlFor="analytics-template">Query</Label><NativeSelect id="analytics-template" value={templateId} onChange={(event) => setTemplateId(event.target.value)}><NativeSelectOption value="daily-events">Daily event counts</NativeSelectOption><NativeSelectOption value="placement-counts">Placement counts</NativeSelectOption><NativeSelectOption value="creative-performance">Creative performance</NativeSelectOption></NativeSelect></div>
          <div className="space-y-2"><Label htmlFor="analytics-start">Start UTC date</Label><Input id="analytics-start" type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="analytics-end">End UTC date</Label><Input id="analytics-end" type="date" required value={endDate} onChange={(event) => setEndDate(event.target.value)} /></div>
          <Button type="submit" disabled={queryBusy}>{queryBusy ? 'Working…' : 'Run query'}</Button>
        </form>
        <p className="text-sm text-muted-foreground">Choose up to 31 inclusive days.</p>
        {queryError && <p role="alert" className="text-sm text-destructive">{queryError}</p>}
        {query && <div className="space-y-3"><p className="text-sm">Query {query.id}: <strong>{query.state}</strong> · {query.scannedBytes.toLocaleString()} bytes scanned</p>
          {query.reason && <p role="alert" className="text-sm text-destructive">{query.reason}</p>}
          {(query.state === 'QUEUED' || query.state === 'RUNNING') && <Button type="button" variant="outline" disabled={queryBusy} onClick={() => void refreshQuery()}>{queryBusy ? 'Loading…' : 'Refresh query status'}</Button>}
          {query.state === 'SUCCEEDED' && (query.rows?.length ? <><div className="overflow-x-auto"><Table><TableHeader><TableRow>{query.columns?.map((column, index) => <TableHead key={index}>{column}</TableHead>)}</TableRow></TableHeader><TableBody>{query.rows.map((row, index) => <TableRow key={index}>{row.map((cell, cellIndex) => <TableCell key={cellIndex}>{cell ?? '—'}</TableCell>)}</TableRow>)}</TableBody></Table></div>{query.truncated && <p className="text-sm text-muted-foreground">Results truncated to the first 100 rows.</p>}</> : <p className="text-sm text-muted-foreground">No rows for this range.</p>)}
        </div>}
      </CardContent>
    </Card>
  </section>;
}
