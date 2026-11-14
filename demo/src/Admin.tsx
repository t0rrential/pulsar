import { useState } from 'react';
import type { FormEvent } from 'react';
import { AdProvider, AdStats } from '@pulsar/react-ads';
import './admin.css';

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
    <AdProvider apiUrl={apiUrl}>
      <section className="admin" aria-label="Campaign administration">
        <div className="admin-heading"><div><p className="admin-eyebrow">PULSAR / ADMIN</p><h1>Campaign management</h1><p>Manage campaigns, creatives and their performance.</p></div></div>
        <form className="admin-auth" onSubmit={(event) => { event.preventDefault(); void run(loadCampaigns); }}>
          <label>Admin key<input type="password" value={key} onChange={(event) => { setKey(event.target.value); setConnected(false); setCampaigns([]); setSelectedId(''); }} autoComplete="off" required /></label>
          <button disabled={busy || !key} type="submit">{connected ? 'Refresh campaigns' : 'Connect'}</button>
          <span>The key stays in this page and is not saved.</span>
        </form>
        {error && <p className="admin-message admin-error" role="alert">{error}</p>}
        {notice && <p className="admin-message" role="status">{notice}</p>}
        {connected && <>
          <div className="admin-grid">
            <section className="admin-panel"><div className="admin-panel-heading"><div><p className="admin-eyebrow">YOUR CAMPAIGNS</p><h2>Campaigns</h2></div><span>{campaigns.length} total</span></div>
              {campaigns.length === 0 ? <p className="admin-muted">No campaigns yet. Create one to get started.</p> : <ul className="admin-list">{campaigns.map((campaign) => <li key={campaign.id}>
                <button className="admin-campaign" type="button" aria-pressed={selectedId === campaign.id} onClick={() => setSelectedId(campaign.id)}><strong>{campaign.name}</strong><span>{campaign.placements.join(', ')} · weight {campaign.weight}</span><small className={`admin-status ${campaign.status}`}>{campaign.status}</small></button>
                <div className="admin-row-actions"><button type="button" disabled={busy} onClick={() => editCampaign(campaign)}>Edit</button><button type="button" disabled={busy} onClick={() => void toggleCampaign(campaign)}>{campaign.status === 'active' ? 'Pause' : 'Resume'}</button></div>
              </li>)}</ul>}
            </section>
            <section className="admin-panel"><div className="admin-panel-heading"><div><p className="admin-eyebrow">CAMPAIGN DETAILS</p><h2>{editingId ? 'Edit campaign' : 'Create campaign'}</h2></div></div>
              <form className="admin-form" onSubmit={saveCampaign}>
                <label>Name<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
                <label>Placements <span>comma separated</span><input required placeholder="sidebar, banner" value={draft.placements} onChange={(event) => setDraft({ ...draft, placements: event.target.value })} /></label>
                <div className="admin-fields"><label>Weight<input type="number" min="0.01" step="any" required value={draft.weight} onChange={(event) => setDraft({ ...draft, weight: event.target.value })} /></label><label>Status<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Status })}><option value="active">Active</option><option value="paused">Paused</option></select></label></div>
                <div className="admin-buttons"><button type="submit" disabled={busy}>{editingId ? 'Save changes' : 'Create campaign'}</button>{editingId && <button type="button" className="admin-secondary" onClick={() => { setEditingId(null); setDraft(emptyCampaign); }}>Cancel</button>}</div>
              </form>
            </section>
          </div>
          {selected && <><section className="admin-panel admin-creative"><div className="admin-panel-heading"><div><p className="admin-eyebrow">SELECTED CAMPAIGN</p><h2>{selected.name}</h2><p className="admin-muted">{selected.id} · {selected.creatives.length} creatives</p></div></div>
            {selected.creatives.length > 0 && <ul className="admin-creatives">{selected.creatives.map((creative) => <li key={creative.id}><img src={creative.imageUrl} alt="" /><div><strong>{creative.headline}</strong><span>{creative.width} × {creative.height}</span><a href={creative.landingUrl} target="_blank" rel="noreferrer">View destination ↗</a></div></li>)}</ul>}
            <h3>Add a creative</h3><form className="admin-form" onSubmit={addCreative}>
              <div className="admin-fields"><label>Image <span>PNG, JPEG, WebP or GIF</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" required onChange={(event) => setFile(event.target.files?.[0] || null)} /></label><label>Headline<input required value={headline} onChange={(event) => setHeadline(event.target.value)} /></label></div>
              <label>Destination URL<input type="url" required value={landingUrl} onChange={(event) => setLandingUrl(event.target.value)} placeholder="https://example.com" /></label>
              <div className="admin-fields"><label>Width (px)<input type="number" min="1" step="1" required value={width} onChange={(event) => setWidth(event.target.value)} /></label><label>Height (px)<input type="number" min="1" step="1" required value={height} onChange={(event) => setHeight(event.target.value)} /></label></div>
              <div className="admin-buttons"><button type="submit" disabled={busy || !file}>Upload and add creative</button></div>
            </form>
          </section><section className="admin-stats"><div className="admin-panel-heading"><div><p className="admin-eyebrow">LAST 7 DAYS / UTC</p><h2>Campaign performance</h2></div><button type="button" className="admin-secondary" onClick={() => setStatsRefresh((value) => value + 1)}>Refresh stats</button></div><AdStats campaignId={selected.id} days={7} refreshKey={statsRefresh} /></section></>}
        </>}
      </section>
    </AdProvider>
  );
}
