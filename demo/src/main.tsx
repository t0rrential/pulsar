import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AdProvider, AdSlot, AdStats } from '@pulsar/react-ads';
import './style.css';

const apiUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '');
const campaigns = [
  { id: 'c1', label: 'Weekend escapes', placement: 'Sidebar', artwork: 'escape.svg' },
  { id: 'c2', label: 'Outside every day', placement: 'Sidebar', artwork: 'outside.svg' },
  { id: 'c3', label: 'Find your next adventure', placement: 'Banner', artwork: 'explore.svg' },
];

function App() {
  const [view, setView] = useState<'publisher' | 'stats'>(window.location.hash === '#stats' ? 'stats' : 'publisher');
  const [adGeneration, setAdGeneration] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [campaignId, setCampaignId] = useState('c1');
  const selectedCampaign = campaigns.find((campaign) => campaign.id === campaignId)!;

  function navigate(next: 'publisher' | 'stats') {
    window.history.replaceState(null, '', `#${next}`);
    setView(next);
    if (next === 'stats') setRefreshKey((key) => key + 1);
  }

  return (
    <AdProvider apiUrl={apiUrl}>
      <div className="shell">
        <header className="topbar">
          <a className="wordmark" href="#publisher" onClick={(event) => { event.preventDefault(); navigate('publisher'); }}>
            <span className="mark" aria-hidden="true">✳</span> pulsar<span className="badge">prototype</span>
          </a>
          <nav aria-label="Demo views">
            <button className={view === 'publisher' ? 'active' : ''} onClick={() => navigate('publisher')}>Publisher</button>
            <button className={view === 'stats' ? 'active' : ''} onClick={() => navigate('stats')}>Campaign stats</button>
          </nav>
        </header>
        <main>
          <div className="eyebrow">{view === 'publisher' ? 'AD PLATFORM / PHASE 01' : 'PULSAR ANALYTICS / CAMPAIGNS'}</div>
          <section className="intro">
            <div>
              <h1>{view === 'publisher' ? 'Small placements. Real signals.' : 'Good things are getting noticed.'}</h1>
              <p>{view === 'publisher' ? 'A publisher demo powered by the React ad package. Ads are selected by placement and campaign weight.' : 'A clearer picture of your campaigns. Real activity, useful context, and every interaction in one place.'}</p>
            </div>
            <button className="action" onClick={() => view === 'publisher' ? setAdGeneration((key) => key + 1) : setRefreshKey((key) => key + 1)}>
              {view === 'publisher' ? 'Load new ads ↗' : 'Refresh stats ↻'}
            </button>
          </section>
          {view === 'publisher' ? (
            <div className="publisher-grid" key={adGeneration}>
              <article className="story">
                <div className="story-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><span>Ideas in<br />good company.</span><div className="art-caption">THE PULSAR JOURNAL · VOL. 01</div></div>
                <div className="story-body">
                  <div className="eyebrow">DESIGN & TECHNOLOGY · DEMO CONTENT</div>
                  <h2>A little space for something worth discovering.</h2>
                  <p>This is a sample publisher page. The sponsored placements beside and below this article are live components, not hard-coded campaign cards.</p>
                  <p>Each slot requests an eligible campaign from the API. Rendering records an impression; following the ad records a click. Campaign stats show the resulting daily totals.</p>
                </div>
                <section className="banner-placement" aria-label="Banner advertisement">
                  <div className="placement-label">SPONSORED <span>banner</span></div>
                  <AdSlot placement="banner" />
                </section>
              </article>
              <aside className="sidebar">
                <section className="placement" aria-label="First sidebar advertisement"><div className="placement-label">SPONSORED <span>sidebar / 01</span></div><AdSlot placement="sidebar" /></section>
                <section className="placement" aria-label="Second sidebar advertisement"><div className="placement-label">SPONSORED <span>sidebar / 02</span></div><AdSlot placement="sidebar" /></section>
                <div className="note"><span className="status-dot" />Live API data<p>No fill? The slot stays empty. Network errors are shown by the package.</p></div>
              </aside>
            </div>
          ) : (
            <div className="campaign-dashboard">
              <div className="dashboard-toolbar">
                <div className="campaign-switcher" role="group" aria-label="Choose campaign">
                  {campaigns.map((campaign) => (
                    <button key={campaign.id} aria-pressed={campaignId === campaign.id} onClick={() => setCampaignId(campaign.id)}>
                      <span className="campaign-switcher-dot" aria-hidden="true" />{campaign.label}
                    </button>
                  ))}
                </div>
                <span className="report-window">Last 7 days <span>UTC</span></span>
              </div>
              <section className="campaign-heading" aria-labelledby="selected-campaign-name">
                <img src={`/creatives/${selectedCampaign.artwork}`} width="60" height="60" alt="" />
                <div><div className="eyebrow">CAMPAIGN OVERVIEW</div><h2 id="selected-campaign-name">{selectedCampaign.label}</h2><p>{selectedCampaign.placement} placement <span aria-hidden="true">·</span> <code>{selectedCampaign.id}</code></p></div>
                <span className="campaign-data-note"><span className="status-dot" aria-hidden="true" />Recorded API activity</span>
              </section>
              <AdStats campaignId={campaignId} days={7} refreshKey={refreshKey} />
            </div>
          )}
        </main>
        <footer><span>Pulsar · Prototype, not production analytics</span><span className="api-address">API <code>{apiUrl}</code></span></footer>
      </div>
    </AdProvider>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
