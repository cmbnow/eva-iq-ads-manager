'use client';

import { useEffect, useState } from 'react';

import { Copy, ImageIcon, Megaphone, Sparkles, ThumbsUp } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';

import { StatusPill } from '../../_components/dashboard-ui';
import {
  type AdDraft,
  type CampaignRow,
  generateAdDraft,
  getMetaEnablement,
  listCampaigns,
  saveDraft,
  setCampaignStatus,
} from '../_lib/campaigns';

const STATUS_TONE: Record<string, 'good' | 'warn' | 'info' | 'neutral'> = {
  draft: 'neutral',
  pending_approval: 'warn',
  approved: 'info',
  published: 'good',
};

export function ComposerClient() {
  const [brief, setBrief] = useState('');
  const [draft, setDraft] = useState<AdDraft | null>(null);
  const [vh, setVh] = useState(0);
  const [vd, setVd] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [genErr, setGenErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [metaEnabled, setMetaEnabled] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  useEffect(() => {
    listCampaigns().then(setCampaigns).catch(() => {});
    getMetaEnablement().then((m) => setMetaEnabled(m.enabled)).catch(() => {});
  }, []);

  async function onGenerate() {
    if (!brief.trim() || generating) return;
    setGenerating(true);
    setGenErr(null);
    setDraft(null);
    const res = await generateAdDraft({ brief: brief.trim() });
    if (res.ok) {
      setDraft(res.draft);
      setVh(0);
      setVd(0);
    } else setGenErr(res.error);
    setGenerating(false);
  }

  async function onSave() {
    if (!draft) return;
    setSaving(true);
    const res = await saveDraft(draft);
    setSaving(false);
    if ('id' in res) {
      setDraft(null);
      setBrief('');
      listCampaigns().then(setCampaigns).catch(() => {});
    } else setGenErr(res.error);
  }

  async function onStatus(id: string, status: 'pending_approval' | 'approved' | 'published') {
    setActionErr(null);
    const res = await setCampaignStatus(id, status);
    if (res.ok) listCampaigns().then(setCampaigns).catch(() => {});
    else setActionErr(res.error);
  }

  return (
    <div className={'space-y-6'}>
      <div className={'rounded-xl border border-amber-500/30 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300'}>
        {metaEnabled
          ? 'Meta publishing is enabled for this account.'
          : 'Advisor mode: drafts are written and ready to paste into Meta. One-click publishing turns on when Meta Advanced Access clears. Approvals, spend caps, and an audit log are recorded regardless.'}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className={'flex items-center gap-2 text-base'}>
            <Sparkles className={'h-4 w-4'} /> Create a new ad
          </CardTitle>
        </CardHeader>
        <CardContent className={'space-y-3'}>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder={'Describe the ad — e.g. "A sales ad for the Ugly Kid Joe show on Sept 12, targeting our SeeTickets buyers and a 1% lookalike. Energetic, rock crowd."'}
            rows={3}
            className={'border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-1 focus-visible:outline-none'}
          />
          <Button onClick={onGenerate} disabled={generating || !brief.trim()}>
            <Sparkles className={'mr-2 h-4 w-4'} />
            {generating ? 'Writing…' : 'Generate ad'}
          </Button>
          {genErr ? <p className={'text-destructive text-sm'}>{genErr}</p> : null}
        </CardContent>
      </Card>

      {draft ? (
        <div className={'grid gap-4 lg:grid-cols-2'}>
          {/* Live Meta-style preview */}
          <div>
            <p className={'text-muted-foreground mb-2 text-xs font-medium'}>Preview</p>
            <AdPreview draft={draft} hi={vh} di={vd} />
            {draft.headlines.length > 1 ? (
              <Variants label={'Headline'} items={draft.headlines} active={vh} onPick={setVh} />
            ) : null}
            {draft.descriptions.length > 1 ? (
              <Variants label={'Description'} items={draft.descriptions} active={vd} onPick={setVd} />
            ) : null}
          </div>

          {/* Brief + actions */}
          <div className={'space-y-3'}>
            <Card>
              <CardContent className={'space-y-3 py-4 text-sm'}>
                <p className={'font-semibold'}>{draft.name}</p>
                <Copyable label={'Primary text'} value={draft.primaryText} />
                <Copyable label={'Headline'} value={draft.headlines[vh] ?? ''} />
                <Copyable label={'Description'} value={draft.descriptions[vd] ?? ''} />
                <div>
                  <p className={'text-muted-foreground text-xs'}>Creative brief</p>
                  <p>{draft.creativeBrief}</p>
                </div>
                <div>
                  <p className={'text-muted-foreground text-xs'}>Targeting</p>
                  <p>{draft.targeting}</p>
                </div>
                {draft.buildSteps.length ? (
                  <div>
                    <p className={'text-muted-foreground text-xs'}>Build steps</p>
                    <ol className={'list-decimal space-y-1 pl-5'}>
                      {draft.buildSteps.map((s, i) => <li key={i}>{s}</li>)}
                    </ol>
                  </div>
                ) : null}
                <Button onClick={onSave} disabled={saving}>
                  <ThumbsUp className={'mr-2 h-4 w-4'} /> {saving ? 'Saving…' : 'Save as draft'}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className={'flex items-center gap-2 text-base'}>
            <Megaphone className={'h-4 w-4'} /> Ad drafts & campaigns
          </CardTitle>
        </CardHeader>
        <CardContent className={'space-y-2'}>
          {actionErr ? <p className={'text-destructive text-sm'}>{actionErr}</p> : null}
          {campaigns.length === 0 ? (
            <p className={'text-muted-foreground text-sm'}>No ads yet — generate one above.</p>
          ) : (
            campaigns.map((c) => (
              <div key={c.id} className={'flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm'}>
                <div>
                  <p className={'font-medium'}>{c.name}</p>
                  <p className={'text-muted-foreground text-xs'}>{c.objective ?? 'No objective set'}</p>
                </div>
                <div className={'flex items-center gap-2'}>
                  <StatusPill label={c.status.replace('_', ' ')} tone={STATUS_TONE[c.status] ?? 'neutral'} />
                  {c.status === 'draft' ? (
                    <Button size={'sm'} variant={'outline'} onClick={() => onStatus(c.id, 'pending_approval')}>Submit for approval</Button>
                  ) : null}
                  {c.status === 'pending_approval' ? (
                    <Button size={'sm'} variant={'outline'} onClick={() => onStatus(c.id, 'approved')}>Approve</Button>
                  ) : null}
                  {c.status === 'approved' ? (
                    <Button size={'sm'} onClick={() => onStatus(c.id, 'published')}>Publish</Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AdPreview({ draft, hi, di }: { draft: AdDraft; hi: number; di: number }) {
  return (
    <div className={'bg-card mx-auto max-w-sm overflow-hidden rounded-xl border shadow-sm'}>
      {/* header */}
      <div className={'flex items-center gap-2 p-3'}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={'/images/evaiq-logo.svg'} alt={''} className={'h-8 w-8 rounded-full'} />
        <div>
          <p className={'text-sm font-semibold'}>The Foundry</p>
          <p className={'text-muted-foreground text-[11px]'}>Sponsored</p>
        </div>
      </div>
      {/* primary text */}
      <p className={'px-3 pb-2 text-sm whitespace-pre-wrap'}>{draft.primaryText}</p>
      {/* creative placeholder */}
      <div className={'flex aspect-square w-full items-center justify-center bg-gradient-to-br from-cyan-500/20 to-orange-500/20'}>
        <div className={'text-muted-foreground flex flex-col items-center gap-1 px-6 text-center'}>
          <ImageIcon className={'h-8 w-8'} />
          <span className={'text-[11px]'}>{draft.creativeBrief || 'Creative goes here'}</span>
        </div>
      </div>
      {/* link card */}
      <div className={'bg-muted/50 flex items-center justify-between gap-2 p-3'}>
        <div className={'min-w-0'}>
          <p className={'text-muted-foreground text-[10px] uppercase'}>basiccitybeer.com</p>
          <p className={'truncate text-sm font-semibold'}>{draft.headlines[hi] ?? draft.name}</p>
          <p className={'text-muted-foreground truncate text-xs'}>{draft.descriptions[di] ?? ''}</p>
        </div>
        <button className={'bg-foreground text-background shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold'}>
          {draft.cta || 'Get Tickets'}
        </button>
      </div>
    </div>
  );
}

function Variants({ label, items, active, onPick }: { label: string; items: string[]; active: number; onPick: (i: number) => void }) {
  return (
    <div className={'mt-2'}>
      <p className={'text-muted-foreground mb-1 text-xs'}>{label} variants</p>
      <div className={'flex flex-wrap gap-1.5'}>
        {items.map((it, i) => (
          <button
            key={i}
            onClick={() => onPick(i)}
            title={it}
            className={
              'max-w-[12rem] truncate rounded-full border px-2.5 py-1 text-xs ' +
              (i === active ? 'border-primary bg-accent' : 'hover:bg-accent/50')
            }
          >
            {it}
          </button>
        ))}
      </div>
    </div>
  );
}

function Copyable({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className={'flex items-center justify-between'}>
        <p className={'text-muted-foreground text-xs'}>{label}</p>
        <button
          onClick={() => navigator.clipboard?.writeText(value)}
          className={'text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[11px]'}
        >
          <Copy className={'h-3 w-3'} /> copy
        </button>
      </div>
      <p className={'whitespace-pre-wrap'}>{value}</p>
    </div>
  );
}
