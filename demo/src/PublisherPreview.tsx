import { useState } from 'react';
import { AdSlot } from '@pulsar/react-ads';
import { Monitor, PanelTop, RefreshCw, Smartphone } from 'lucide-react';
import { Button } from './components/ui/button';
import { Card } from './components/ui/card';

export default function PublisherPreview() {
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [generation, setGeneration] = useState(0);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-500"><PanelTop className="size-3.5" aria-hidden="true" />PUBLISHER</div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 sm:text-[28px]">Publisher preview</h1>
          <p className="mt-2 text-sm text-zinc-500">See your placements in context, with real campaigns and real activity.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => setGeneration((value) => value + 1)}><RefreshCw aria-hidden="true" />Refresh ads</Button>
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
        <p className="text-sm text-muted-foreground">Live preview · Loading or refreshing makes real ad requests and records impressions when ads are served. Clicking an ad records a real click.</p>
        <div className="flex shrink-0 items-center gap-1 rounded-md border bg-background p-1" role="group" aria-label="Preview width">
          <Button type="button" size="sm" variant={viewport === 'desktop' ? 'secondary' : 'ghost'} aria-pressed={viewport === 'desktop'} onClick={() => setViewport('desktop')}><Monitor aria-hidden="true" />Desktop</Button>
          <Button type="button" size="sm" variant={viewport === 'mobile' ? 'secondary' : 'ghost'} aria-pressed={viewport === 'mobile'} onClick={() => setViewport('mobile')}><Smartphone aria-hidden="true" />Mobile</Button>
        </div>
      </div>

      <div className="rounded-xl border bg-muted/50 p-3 sm:p-6">
        <Card className={`mx-auto gap-0 overflow-hidden py-0 shadow-sm ${viewport === 'mobile' ? 'max-w-[390px]' : 'max-w-6xl'}`}>
          <div className="flex items-center justify-between gap-4 border-b px-5 py-4 sm:px-8">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">An independent journal</p>
              <p className="mt-1 font-serif text-xl font-semibold tracking-tight">The Pulsar Journal<span className="text-emerald-600">.</span></p>
            </div>
            <span className="text-xs font-medium text-muted-foreground">Ideas for curious minds</span>
          </div>

          <div className="bg-[#eef3ec] px-5 py-10 sm:px-8 sm:py-12">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800/70">Design · Culture · Technology</p>
            <h2 className="mt-4 max-w-xl font-serif text-3xl leading-tight tracking-tight text-[#294333] sm:text-4xl">A little space for something worth discovering.</h2>
            <p className="mt-4 max-w-lg text-sm leading-6 text-[#5b7261]">Thoughtful stories and fresh perspectives for the endlessly curious.</p>
          </div>

          <div className={`flex gap-8 p-5 sm:p-8 ${viewport === 'mobile' ? 'flex-col' : 'flex-wrap'}`}>
            <article className={`min-w-0 ${viewport === 'mobile' ? '' : 'flex-[2_1_420px]'}`}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">The art of paying attention · 6 min read</p>
              <h3 className="mt-3 font-serif text-2xl leading-snug tracking-tight">Finding inspiration in the everyday</h3>
              <p className="mt-4 text-sm leading-7 text-muted-foreground">The best ideas often begin with a closer look. A familiar street, a thoughtful conversation, or a new way of seeing an old problem can open the door to something unexpected.</p>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">Here, we make room for those moments: stories about the people, places, and ideas shaping a more interesting world.</p>
              <div className="mt-7 border-t pt-6">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Sponsored · Banner</p>
                <AdSlot key={`banner-${generation}`} placement="banner" width={728} height={90} />
              </div>
            </article>
            <aside className={`min-w-0 ${viewport === 'mobile' ? '' : 'flex-[1_1_260px]'}`} aria-label="Sidebar">
              <div className="border-t pt-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">From the journal</p>
                <p className="mt-3 font-serif text-lg leading-snug">Good ideas are better shared.</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">A thoughtful read for wherever your day takes you.</p>
              </div>
              <div className="mt-6 border-t pt-5">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Sponsored · Sidebar</p>
                <AdSlot key={`sidebar-${generation}`} placement="sidebar" />
              </div>
            </aside>
          </div>
          <div className="border-t px-5 py-4 text-xs text-muted-foreground sm:px-8">The Pulsar Journal · A sample publisher page</div>
        </Card>
      </div>
    </>
  );
}
