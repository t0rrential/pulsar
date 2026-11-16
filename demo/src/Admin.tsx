import { useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowUpRight, BarChart3, ImagePlus, KeyRound, Plus, RefreshCw } from 'lucide-react';
import DashboardStats from './DashboardStats';
import FingerprintReport from './FingerprintReport';
import AnalyticsPipeline from './AnalyticsPipeline';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { NativeSelect, NativeSelectOption } from './components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table';

type Status = 'active' | 'paused';
type Creative = { id: string; imageUrl: string; headline: string; landingUrl: string; width: number; height: number };
type Campaign = { id: string; name: string; status: Status; placements: string[]; weight: number; creatives: Creative[] };
type CampaignDraft = { name: string; status: Status; placements: string; weight: string };

const emptyCampaign: CampaignDraft = { name: '', status: 'active', placements: '', weight: '1' };

export default function Admin({ apiUrl }: { apiUrl: string }) {
  const [key, setKey] = useState('');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<CampaignDraft>(emptyCampaign);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [headline, setHeadline] = useState('');
  const [landingUrl, setLandingUrl] = useState('');
  const [width, setWidth] = useState('300');
  const [height, setHeight] = useState('250');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connected, setConnected] = useState(false);
  const [statsRefresh, setStatsRefresh] = useState(0);
  const selected = campaigns.find((campaign) => campaign.id === selectedId);
  const baseUrl = apiUrl.replace(/\/+$/, '');

  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { 'x-admin-key': key, ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error || `Request failed (${response.status}).`);
    return body as T;
  }

  async function loadCampaigns() {
    const result = await request<{ campaigns: Campaign[] }>('/campaigns');
    setCampaigns(result.campaigns);
    setSelectedId((id) => result.campaigns.some((campaign) => campaign.id === id) ? id : result.campaigns[0]?.id || '');
    setConnected(true);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.'); } finally { setBusy(false); }
  }

  function editCampaign(campaign: Campaign) {
    setEditingId(campaign.id);
    setDraft({ name: campaign.name, status: campaign.status, placements: campaign.placements.join(', '), weight: String(campaign.weight) });
  }

  async function saveCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const placements = draft.placements.split(',').map((placement) => placement.trim()).filter(Boolean);
    if (!draft.name.trim() || !placements.length || !Number.isFinite(Number(draft.weight)) || Number(draft.weight) <= 0) {
      setError('Enter a name, at least one placement and a positive weight.');
      return;
    }
    await run(async () => {
      const body = JSON.stringify({ name: draft.name.trim(), status: draft.status, placements, weight: Number(draft.weight) });
      const result = await request<{ campaign: Campaign }>(editingId ? `/campaigns/${encodeURIComponent(editingId)}` : '/campaigns', { method: editingId ? 'PUT' : 'POST', body });
      await loadCampaigns();
      setSelectedId(result.campaign.id);
      setEditingId(null);
      setDraft(emptyCampaign);
      setNotice(editingId ? 'Campaign updated.' : 'Campaign created.');
    });
  }

  async function toggleCampaign(campaign: Campaign) {
    await run(async () => {
      await request(`/campaigns/${encodeURIComponent(campaign.id)}`, { method: 'PUT', body: JSON.stringify({ name: campaign.name, status: campaign.status === 'active' ? 'paused' : 'active', placements: campaign.placements, weight: campaign.weight }) });
      await loadCampaigns();
      setNotice(campaign.status === 'active' ? 'Campaign paused.' : 'Campaign resumed.');
    });
  }

  async function addCreative(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !selected) return;
    const campaign = selected;
    const form = event.currentTarget;
    await run(async () => {
      const upload = await request<{ uploadUrl: string; imageUrl: string; headers: Record<string, string> }>('/uploads', { method: 'POST', body: JSON.stringify({ contentType: file.type }) });
      const response = await fetch(upload.uploadUrl, { method: 'PUT', headers: upload.headers, body: file });
      if (!response.ok) throw new Error(`Image upload failed (${response.status}).`);
      await request(`/campaigns/${encodeURIComponent(campaign.id)}/creatives`, { method: 'POST', body: JSON.stringify({ imageUrl: upload.imageUrl, headline: headline.trim(), landingUrl: landingUrl.trim(), width: Number(width), height: Number(height) }) });
      await loadCampaigns();
      setFile(null);
      setHeadline('');
      setLandingUrl('');
      form.reset();
      setNotice('Creative added.');
    });
  }

  return (
    <section className="w-full space-y-6 text-foreground" aria-label="Campaign administration">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Pulsar / Admin</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Campaign management</h1>
        <p className="text-sm text-muted-foreground">Manage campaigns, creatives and their performance.</p>
      </header>

      <Card className="gap-4 py-5">
        <CardContent>
          <form className="flex flex-col gap-4 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); void run(loadCampaigns); }}>
            <div className="grid flex-1 gap-2">
              <Label htmlFor="admin-key">Admin key</Label>
              <Input id="admin-key" type="password" value={key} onChange={(event) => { setKey(event.target.value); setConnected(false); setCampaigns([]); setSelectedId(''); }} autoComplete="off" required aria-describedby="admin-key-help" />
              <p id="admin-key-help" className="text-xs text-muted-foreground">Your key stays on this page and is not saved.</p>
            </div>
            <Button disabled={busy || !key} type="submit" className="sm:mb-5">
              {connected ? <RefreshCw /> : <KeyRound />}
              {busy ? 'Working…' : connected ? 'Refresh campaigns' : 'Connect'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">{error}</p>}
      {notice && <p className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm" role="status">{notice}</p>}
      {!connected && !busy && <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Connect with your admin key to manage campaigns.</div>}

      {connected && <>
        <div className="flex justify-end"><Button type="button" variant="outline" size="sm" onClick={() => document.getElementById('analytics-pipeline')?.scrollIntoView()}>Open analytics pipeline</Button></div>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="min-w-0 gap-0 overflow-hidden py-0">
            <CardHeader className="flex flex-row items-start justify-between gap-4 border-b py-5">
              <div className="space-y-1.5"><CardTitle className="text-base">Campaigns</CardTitle><CardDescription>Select a campaign to view its creatives and performance.</CardDescription></div>
              <Badge variant="secondary">{campaigns.length} total</Badge>
            </CardHeader>
            <CardContent className="px-0">
              {campaigns.length === 0 ? <div className="px-6 py-12 text-center"><p className="text-sm font-medium">No campaigns yet</p><p className="mt-1 text-sm text-muted-foreground">Create a campaign to get started.</p></div> : (
                <Table>
                  <TableHeader><TableRow><TableHead className="pl-6">Campaign</TableHead><TableHead>Status</TableHead><TableHead className="text-right pr-6">Actions</TableHead></TableRow></TableHeader>
                  <TableBody>{campaigns.map((campaign) => (
                    <TableRow key={campaign.id} className={selectedId === campaign.id ? 'bg-muted/50' : ''}>
                      <TableCell className="max-w-xs whitespace-normal pl-6">
                        <Button type="button" variant="ghost" aria-pressed={selectedId === campaign.id} onClick={() => setSelectedId(campaign.id)} className="h-auto max-w-full flex-col items-start gap-1 whitespace-normal px-0 text-left">
                          <span className="block font-medium">{campaign.name}</span>
                          <span className="block text-xs font-normal text-muted-foreground">{campaign.placements.join(', ')} · weight {campaign.weight}</span>
                        </Button>
                      </TableCell>
                      <TableCell><Badge variant={campaign.status === 'active' ? 'secondary' : 'outline'} className="capitalize">{campaign.status}</Badge></TableCell>
                      <TableCell className="pr-6 text-right"><div className="flex justify-end gap-1"><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => editCampaign(campaign)} aria-label={`Edit ${campaign.name}`}>Edit</Button><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void toggleCampaign(campaign)} aria-label={`${campaign.status === 'active' ? 'Pause' : 'Resume'} ${campaign.name}`}>{campaign.status === 'active' ? 'Pause' : 'Resume'}</Button></div></TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="gap-5">
            <CardHeader><CardTitle className="text-base">{editingId ? 'Edit campaign' : 'Create campaign'}</CardTitle><CardDescription>Set up the details and delivery settings.</CardDescription></CardHeader>
            <CardContent>
              <form className="grid gap-4" onSubmit={saveCampaign}>
                <div className="grid gap-2"><Label htmlFor="campaign-name">Name</Label><Input id="campaign-name" required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
                <div className="grid gap-2"><Label htmlFor="campaign-placements">Placements</Label><Input id="campaign-placements" required placeholder="sidebar, banner" value={draft.placements} onChange={(event) => setDraft({ ...draft, placements: event.target.value })} aria-describedby="placements-help" /><p id="placements-help" className="text-xs text-muted-foreground">Separate placements with commas.</p></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2"><Label htmlFor="campaign-weight">Weight</Label><Input id="campaign-weight" type="number" min="0.01" step="any" required value={draft.weight} onChange={(event) => setDraft({ ...draft, weight: event.target.value })} /></div>
                  <div className="grid gap-2"><Label htmlFor="campaign-status">Status</Label><NativeSelect id="campaign-status" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Status })}><NativeSelectOption value="active">Active</NativeSelectOption><NativeSelectOption value="paused">Paused</NativeSelectOption></NativeSelect></div>
                </div>
                <div className="flex flex-wrap gap-2 pt-1"><Button type="submit" disabled={busy}>{!editingId && <Plus />}{editingId ? 'Save changes' : 'Create campaign'}</Button>{editingId && <Button type="button" variant="outline" onClick={() => { setEditingId(null); setDraft(emptyCampaign); }}>Cancel</Button>}</div>
              </form>
            </CardContent>
          </Card>
        </div>

        {selected && <>
          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="border-b py-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 space-y-1.5"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Selected campaign</p><CardTitle className="break-words text-base">{selected.name}</CardTitle><CardDescription className="break-all">{selected.id}</CardDescription></div><Badge variant="outline">{selected.creatives.length} {selected.creatives.length === 1 ? 'creative' : 'creatives'}</Badge></div></CardHeader>
            <CardContent className="grid gap-8 py-6 lg:grid-cols-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">Creatives</h3>
                {selected.creatives.length === 0 ? <div className="mt-4 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No creatives yet. Add one to this campaign.</div> : <ul className="mt-4 divide-y rounded-lg border">{selected.creatives.map((creative) => <li key={creative.id} className="flex min-w-0 items-center gap-4 p-3"><img className="h-14 w-20 shrink-0 rounded-md border bg-muted object-contain" src={creative.imageUrl} alt="" /><div className="min-w-0 space-y-1"><p className="break-words text-sm font-medium">{creative.headline}</p><p className="text-xs text-muted-foreground">{creative.width} × {creative.height}</p><a className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-4" href={creative.landingUrl} target="_blank" rel="noreferrer">View destination <ArrowUpRight className="size-3" /></a></div></li>)}</ul>}
              </div>
              <div><h3 className="text-sm font-semibold">Add a creative</h3><p className="mt-1 text-sm text-muted-foreground">Upload an image and add its destination.</p>
                <form className="mt-4 grid gap-4" onSubmit={addCreative}>
                  <div className="grid gap-2"><Label htmlFor="creative-image">Image</Label><Input id="creative-image" type="file" accept="image/png,image/jpeg,image/webp,image/gif" required onChange={(event) => setFile(event.target.files?.[0] || null)} aria-describedby="image-help" /><p id="image-help" className="text-xs text-muted-foreground">PNG, JPEG, WebP or GIF</p></div>
                  <div className="grid gap-2"><Label htmlFor="creative-headline">Headline</Label><Input id="creative-headline" required value={headline} onChange={(event) => setHeadline(event.target.value)} /></div>
                  <div className="grid gap-2"><Label htmlFor="creative-url">Destination URL</Label><Input id="creative-url" type="url" required value={landingUrl} onChange={(event) => setLandingUrl(event.target.value)} placeholder="https://example.com" /></div>
                  <div className="grid grid-cols-2 gap-3"><div className="grid gap-2"><Label htmlFor="creative-width">Width (px)</Label><Input id="creative-width" type="number" min="1" step="1" required value={width} onChange={(event) => setWidth(event.target.value)} /></div><div className="grid gap-2"><Label htmlFor="creative-height">Height (px)</Label><Input id="creative-height" type="number" min="1" step="1" required value={height} onChange={(event) => setHeight(event.target.value)} /></div></div>
                  <div><Button type="submit" disabled={busy || !file}><ImagePlus />Upload and add creative</Button></div>
                </form>
              </div>
            </CardContent>
          </Card>
          <section aria-labelledby="performance-heading" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Last 7 days / UTC</p><h2 id="performance-heading" className="mt-1 flex items-center gap-2 text-lg font-semibold"><BarChart3 className="size-4 text-muted-foreground" />Campaign performance</h2></div><Button type="button" variant="outline" size="sm" onClick={() => setStatsRefresh((value) => value + 1)}><RefreshCw />Refresh stats</Button></div>
            <DashboardStats apiUrl={apiUrl} campaignId={selected.id} refreshKey={statsRefresh} />
          </section>
          <FingerprintReport key={selected.id} apiUrl={apiUrl} adminKey={key} campaignId={selected.id} />
        </>}
        <AnalyticsPipeline apiUrl={apiUrl} adminKey={key} />
      </>}
    </section>
  );
}
