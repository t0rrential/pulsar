import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AdProvider, useAdFingerprint } from '@pulsar/react-ads';
import { BarChart3, ChevronRight, CircleHelp, ExternalLink, LayoutDashboard, PanelTop, RefreshCw, Settings2, Sparkles } from 'lucide-react';
import Admin from './Admin';
import DashboardStats from './DashboardStats';
import PublisherPreview from './PublisherPreview';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import './theme.css';

const apiUrl = (import.meta.env.VITE_API_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:3001')).replace(/\/$/, '');
const campaigns = [
  { id: 'c1', label: 'Weekend escapes', placement: 'Sidebar', artwork: 'escape.svg' },
  { id: 'c2', label: 'Outside every day', placement: 'Sidebar', artwork: 'outside.svg' },
  { id: 'c3', label: 'Find your next adventure', placement: 'Banner', artwork: 'explore.svg' },
  { id: 'c4', label: 'Morning rituals', placement: 'Sidebar', artwork: 'escape.svg' },
  { id: 'c5', label: 'City discoveries', placement: 'Sidebar', artwork: 'outside.svg' },
  { id: 'c6', label: 'Explore further', placement: 'Banner', artwork: 'explore.svg' },
];
type View = 'publisher' | 'stats' | 'admin';
type ThemePreference = 'system' | 'light' | 'dark';
const isLocalApi = ['localhost', '127.0.0.1'].includes(new URL(apiUrl, window.location.href).hostname);
const fingerprintConsentKey = 'pulsar-fingerprint-consent';

function FingerprintControl({ consent, onChange }: { consent: boolean; onChange: (value: boolean) => void }) {
  const fingerprint = useAdFingerprint();
  const [copyStatus, setCopyStatus] = useState('');
  return (
    <section aria-labelledby="fingerprint-heading" className="mb-6 rounded-lg border bg-card p-4">
      <h2 id="fingerprint-heading" className="text-sm font-semibold">Optional browser fingerprint</h2>
      <p className="mt-2 max-w-3xl text-xs leading-5 text-zinc-500">
        Allow this publisher site to associate ad events with a pseudonymous, site-scoped fingerprint. The hash is generated locally from browser and device settings. Alongside ordinary ad event data, the browser sends the hash, browser family and device category, but not the underlying settings or raw user agent. Fingerprints are imperfect: browsers can share one and it can change. Records expire after 30 days; deletion may be delayed. Turning this off stops future use but does not delete records already collected or recall events already sent. Ordinary ad tracking continues without it.
      </p>
      <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={consent} onChange={(event) => { setCopyStatus(''); onChange(event.target.checked); }} />
        Allow fingerprinting on this site
      </label>
      {consent && (fingerprint ? (
        <div className="mt-3 max-w-3xl">
          <label htmlFor="current-fingerprint" className="text-xs font-medium">Your current fingerprint (use this to find your records)</label>
          <div className="mt-1 flex flex-wrap gap-2">
            <input id="current-fingerprint" readOnly value={fingerprint} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 font-mono text-xs" />
            <Button type="button" size="sm" variant="outline" onClick={() => {
              if (!navigator.clipboard) { setCopyStatus('Select the fingerprint to copy it.'); return; }
              void navigator.clipboard.writeText(fingerprint).then(() => setCopyStatus('Copied.'), () => setCopyStatus('Select the fingerprint to copy it.'));
            }}>Copy</Button>
          </div>
          <p role="status" className="mt-1 text-xs text-zinc-500">{copyStatus}</p>
        </div>
      ) : <p role="status" className="mt-3 text-xs text-zinc-500">Preparing your fingerprint, or fingerprinting is unavailable in this browser.</p>)}
    </section>
  );
}

function readFingerprintConsent(): boolean {
  try { return localStorage.getItem(fingerprintConsentKey) === 'yes'; } catch { return false; }
}

function App() {
  const initialView = window.location.hash === '#admin' ? 'admin' : window.location.hash === '#publisher' ? 'publisher' : 'stats';
  const [view, setView] = useState<View>(initialView);
  const [refreshKey, setRefreshKey] = useState(0);
  const [campaignId, setCampaignId] = useState('c1');
  const [fingerprintConsent, setFingerprintConsent] = useState(readFingerprintConsent);
  const [theme, setTheme] = useState<ThemePreference>(() => {
    const preference = document.documentElement.dataset.themePreference;
    return preference === 'light' || preference === 'dark' ? preference : 'system';
  });

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === fingerprintConsentKey || event.key === null) setFingerprintConsent(readFingerprintConsent());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function updateFingerprintConsent(value: boolean) {
    try {
      if (value) localStorage.setItem(fingerprintConsentKey, 'yes');
      else localStorage.removeItem(fingerprintConsentKey);
    } catch {}
    setFingerprintConsent(value);
  }

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.documentElement.dataset.themePreference = theme;
      const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      if (themeColor) themeColor.content = dark ? '#111315' : '#fafafa';
    };
    applyTheme();
    media.addEventListener('change', applyTheme);
    try {
      if (theme === 'system') localStorage.removeItem('pulsar-theme');
      else localStorage.setItem('pulsar-theme', theme);
    } catch {}
    return () => media.removeEventListener('change', applyTheme);
  }, [theme]);
  const selectedCampaign = campaigns.find((campaign) => campaign.id === campaignId)!;
  const navItems = [
    { id: 'stats' as const, label: 'Overview', icon: LayoutDashboard },
    { id: 'publisher' as const, label: 'Publisher preview', icon: PanelTop },
    { id: 'admin' as const, label: 'Campaigns', icon: Settings2 },
  ];

  function navigate(next: View) {
    window.history.replaceState(null, '', `#${next}`);
    setView(next);
    if (next === 'stats') setRefreshKey((key) => key + 1);
  }

  return (
    <AdProvider apiUrl={apiUrl} fingerprintConsent={fingerprintConsent}>
      <div className="min-h-screen bg-background text-foreground md:flex">
        <aside className="border-b bg-card md:fixed md:inset-y-0 md:left-0 md:z-10 md:flex md:w-60 md:flex-col md:border-r md:border-b-0">
          <div className="flex h-16 items-center justify-between px-5 md:h-[72px]">
            <a href="#stats" onClick={(event) => { event.preventDefault(); navigate('stats'); }} className="flex items-center gap-2.5 font-semibold tracking-tight text-zinc-950">
              <span className="flex size-8 items-center justify-center rounded-lg bg-zinc-950 text-white"><Sparkles className="size-4" aria-hidden="true" /></span>
              <span>pulsar<span className="text-emerald-600">.</span></span>
            </a>
            <Badge variant="secondary" className="text-[10px] font-medium text-zinc-500">PROTOTYPE</Badge>
          </div>
          <div className="px-3 pb-3 md:pt-4">
            <p className="hidden px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400 md:block">Workspace</p>
            <nav aria-label="Main navigation" className="flex gap-1 overflow-x-auto md:flex-col">
              {navItems.map(({ id, label, icon: Icon }) => (
                <Button key={id} variant="ghost" onClick={() => navigate(id)} aria-current={view === id ? 'page' : undefined} className={`h-10 justify-start gap-3 px-3 text-[13px] ${view === id ? 'bg-zinc-100 font-semibold text-zinc-950' : 'text-zinc-500 hover:text-zinc-950'}`}>
                  <Icon className="size-4" aria-hidden="true" />{label}
                </Button>
              ))}
            </nav>
          </div>
          <div className="hidden flex-1 md:block" />
          <div className="hidden border-t p-4 md:block">
            <div className="flex items-start gap-3 rounded-lg bg-zinc-50 p-3">
              <CircleHelp className="mt-0.5 size-4 shrink-0 text-zinc-400" aria-hidden="true" />
              <div><p className="text-xs font-medium text-zinc-700">A little context</p><p className="mt-1 text-xs leading-5 text-zinc-500">{isLocalApi ? 'Sample history with live local interactions.' : 'Real activity, from request to click. This is a prototype.'}</p></div>
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1 md:ml-60">
          <header className="flex h-16 items-center justify-between gap-3 border-b bg-card px-5 sm:px-8 md:h-[72px] lg:px-10">
            <div className="flex min-w-0 items-center gap-2 text-sm"><span className="hidden text-zinc-400 sm:inline">Workspace</span><ChevronRight className="hidden size-3.5 text-zinc-300 sm:block" aria-hidden="true" /><span className="truncate font-medium text-zinc-700">{navItems.find((item) => item.id === view)?.label}</span></div>
            <div className="flex shrink-0 items-center gap-3">
              <label htmlFor="theme-preference" className="sr-only">Color theme</label>
              <select id="theme-preference" value={theme} onChange={(event) => setTheme(event.target.value as ThemePreference)} className="h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <option value="system">System theme</option>
                <option value="light">Light theme</option>
                <option value="dark">Dark theme</option>
              </select>
              <Badge variant="outline" className="hidden border-zinc-200 px-2.5 py-1 font-normal text-zinc-500 sm:inline-flex">Prototype workspace</Badge>
            </div>
          </header>

          <main className="mx-auto w-full max-w-[1440px] px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
            {isLocalApi && <p className="mb-6 inline-flex rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 dark-sample-notice">Sample history · local only</p>}
            <FingerprintControl consent={fingerprintConsent} onChange={updateFingerprintConsent} />
            {view === 'admin' ? <Admin apiUrl={apiUrl} /> : view === 'publisher' ? <PublisherPreview /> : (
              <>
                <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
                  <div><div className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-500"><BarChart3 className="size-3.5" aria-hidden="true" />ANALYTICS</div><h1 className="text-2xl font-semibold tracking-tight text-zinc-950 sm:text-[28px]">Campaign overview</h1><p className="mt-2 text-sm text-zinc-500">A clear view of how your campaigns are performing.</p></div>
                  <Button variant="outline" onClick={() => setRefreshKey((key) => key + 1)}><RefreshCw />Refresh data</Button>
                </div>
                <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b pb-5">
                  <div className="flex flex-wrap gap-1" role="group" aria-label="Choose campaign">
                    {campaigns.map((campaign) => <Button key={campaign.id} size="sm" variant={campaignId === campaign.id ? 'secondary' : 'ghost'} aria-pressed={campaignId === campaign.id} onClick={() => setCampaignId(campaign.id)} className={campaignId === campaign.id ? 'font-semibold text-zinc-900' : 'text-zinc-500'}>{campaign.label}</Button>)}
                  </div>
                  <span className="flex items-center gap-2 text-xs text-zinc-500"><span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />Last 7 days · UTC</span>
                </div>
                <div className="mb-6 flex items-center gap-3">
                  <img src={`/creatives/${selectedCampaign.artwork}`} className="size-11 rounded-lg border object-cover" alt="" />
                  <div><p className="text-sm font-semibold text-zinc-900">{selectedCampaign.label}</p><p className="mt-1 text-xs text-zinc-500">{selectedCampaign.placement} placement <span className="px-1 text-zinc-300">·</span> {selectedCampaign.id}</p></div>
                </div>
                <DashboardStats apiUrl={apiUrl} campaignId={campaignId} days={7} refreshKey={refreshKey} />
              </>
            )}
            <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-xs text-zinc-400"><span>© Pulsar · Built for better signals</span><span className="flex items-center gap-1.5">Prototype analytics <ExternalLink className="size-3" aria-hidden="true" /></span></footer>
          </main>
        </div>
      </div>
    </AdProvider>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
