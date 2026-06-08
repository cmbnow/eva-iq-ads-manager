'use client';

import { useEffect, useState } from 'react';

import { Copy, ImageIcon, Megaphone, Rocket, Sparkles, ThumbsUp, X } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';

import { StatusPill } from '../../_components/dashboard-ui';
import { type SavedShow, listAnalyses } from '../../show-engine/_lib/offer-actions';
import {
  type AdDraft,
  type CampaignRow,
  generateAdDraft,
  getMetaEnablement,
  listCampaigns,
  saveDraft,
  setCampaignStatus,
} from '../_lib/campaigns';
import {
  type AudienceSpec,
  listCustomAudiences,
  listMetaPages,
  publishCampaign,
} from '../_lib/publish';

const dollars0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

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
  const [pixelId, setPixelId] = useState<string | null>(null);
  const [sac, setSac] = useState('none');
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [shows, setShows] = useState<SavedShow[]>([]);
  const [showId, setShowId] = useState('');

  const show = shows.find((s) => s.id === showId);
  const core = show?.result.budget_tiers[1];
  const showSummary = show
    ? `Show "${show.showName}" (deal score ${show.result.deal_score}): recommended budget ${dollars0(core?.total_budget ?? 0)} total over ${show.inputs.days_remaining} days (~${dollars0(core?.daily_budget ?? 0)}/day), target cost-per-purchase ${dollars0(show.result.cpa_guardrails.early)}–${dollars0(show.result.cpa_guardrails.late)}, TMAV ${dollars0(show.result.tmav)}, first-party audiences`
    : undefined;

  useEffect(() => {
    listCampaigns().then(setCampaigns).catch(() => {});
    getMetaEnablement()
      .then((m) => {
        setMetaEnabled(m.enabled);
        setPixelId(m.pixelId);
        setSac(m.sac);
      })
      .catch(() => {});
    listAnalyses().then(setShows).catch(() => {});
  }, []);

  async function onGenerate() {
    if (!brief.trim() || generating) return;
    setGenerating(true);
    setGenErr(null);
    setDraft(null);
    const res = await generateAdDraft({ brief: brief.trim(), showSummary });
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
    const res = await saveDraft(draft, {
      profitabilityRunId: showId || null,
      budgetDaily: core?.daily_budget ?? null,
    });
    setSaving(false);
    if ('id' in res) {
      setDraft(null);
      setBrief('');
      listCampaigns().then(setCampaigns).catch(() => {});
    } else setGenErr(res.error);
  }

  async function onStatus(
    id: string,
    status: 'pending_approval' | 'approved' | 'published',
    opts?: { override?: boolean; reason?: string },
  ) {
    setActionErr(null);
    const res = await setCampaignStatus(id, status, opts);
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
          <div className={'flex flex-wrap items-center gap-2 text-sm'}>
            <span className={'text-muted-foreground'}>Profitability run:</span>
            <select
              value={showId}
              onChange={(e) => setShowId(e.target.value)}
              className={'border-input bg-background h-8 rounded border px-2 text-sm'}
            >
              <option value={''}>None</option>
              {shows.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.showName} · Deal {s.result.deal_score}
                </option>
              ))}
            </select>
            {shows.length === 0 ? (
              <a href={'/home/show-engine'} className={'text-primary font-medium'}>
                Run one →
              </a>
            ) : null}
          </div>
          {show ? (
            <div className={'rounded-md border border-cyan-500/30 bg-cyan-50 px-3 py-2 text-xs text-cyan-800 dark:bg-cyan-500/10 dark:text-cyan-300'}>
              Budget from this run: <strong>{dollars0(core?.total_budget ?? 0)}</strong> total (~{dollars0(core?.daily_budget ?? 0)}/day) over {show.inputs.days_remaining} days · target cost-per-purchase {dollars0(show.result.cpa_guardrails.early)}–{dollars0(show.result.cpa_guardrails.late)}. The ad will be written to fit this.
            </div>
          ) : null}
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

            {/* API-enabled tenants only: structured audience + one-click publish
                (PAUSED). Advisor-mode tenants keep the copy-to-paste path above. */}
            {metaEnabled ? (
              <PublishPanel
                draft={draft}
                showId={showId}
                budgetDaily={core?.daily_budget ?? null}
                pixelId={pixelId}
                sac={sac}
                onPublished={() => {
                  listCampaigns().then(setCampaigns).catch(() => {});
                }}
              />
            ) : null}
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
            campaigns.map((c) => {
              const run = shows.find((s) => s.id === c.profitabilityRunId);
              return (
                <div key={c.id} className={'rounded-md border p-3 text-sm'}>
                  <div className={'flex flex-wrap items-center justify-between gap-2'}>
                    <div>
                      <p className={'font-medium'}>{c.name}</p>
                      <p className={'text-muted-foreground text-xs'}>{c.objective ?? 'No objective set'}</p>
                    </div>
                    <div className={'flex items-center gap-2'}>
                      <StatusPill label={c.status.replace('_', ' ')} tone={STATUS_TONE[c.status] ?? 'neutral'} />
                      {c.status === 'draft' ? (
                        <Button size={'sm'} variant={'outline'} onClick={() => onStatus(c.id, 'pending_approval')}>Submit for approval</Button>
                      ) : null}
                      {c.status === 'approved' ? (
                        <Button size={'sm'} onClick={() => onStatus(c.id, 'published')}>Publish</Button>
                      ) : null}
                    </div>
                  </div>
                  {c.status === 'pending_approval' ? (
                    <ReviewPanel
                      run={run}
                      onApprove={(opts) => onStatus(c.id, 'approved', opts)}
                    />
                  ) : null}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ReviewPanel({
  run,
  onApprove,
}: {
  run: SavedShow | undefined;
  onApprove: (opts?: { override?: boolean; reason?: string }) => void;
}) {
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');

  if (!run) {
    return (
      <div className={'mt-2 space-y-2 rounded-md border border-red-500/30 bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300'}>
        <p>No profit basis — link a Show Engine run before approving.</p>
        <Button size={'sm'} variant={'outline'} disabled>
          Approve
        </Button>
      </div>
    );
  }

  const recommended = run.result.budget_tiers[1]?.total_budget ?? 0;
  const mrmc = run.result.mrmc ?? 0;
  const ceiling = run.result.cpa_guardrails.ceiling;
  const over = mrmc > 0 && recommended > mrmc;

  return (
    <div className={'mt-2 space-y-2 rounded-md border p-3 text-xs'}>
      <p className={'font-medium'}>Profit review · {run.showName}</p>
      <div className={'flex flex-wrap gap-x-4 gap-y-1'}>
        <span className={over ? 'font-medium text-red-600' : 'font-medium text-green-600'}>
          Budget {dollars0(recommended)} vs MRMC {dollars0(mrmc)}{' '}
          {over ? '⚠ over ceiling' : '✓ within ceiling'}
        </span>
        <span className={'text-muted-foreground'}>Target cost/purchase ≤ {dollars0(ceiling)}</span>
        <span className={'text-muted-foreground'}>Objective: Sales · Initiate Checkout</span>
      </div>
      {over ? (
        <div className={'space-y-1'}>
          <label className={'flex items-center gap-2'}>
            <input type={'checkbox'} checked={override} onChange={(e) => setOverride(e.target.checked)} />
            Approve over ceiling
          </label>
          {override ? (
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={'Reason (required, logged)'}
              className={'border-input bg-background h-7 w-full rounded border px-2'}
            />
          ) : null}
        </div>
      ) : null}
      <Button
        size={'sm'}
        onClick={() => onApprove(over ? { override, reason: reason.trim() } : undefined)}
        disabled={over && override && !reason.trim()}
      >
        Approve
      </Button>
    </div>
  );
}

function PublishPanel({
  draft,
  showId,
  budgetDaily,
  pixelId,
  sac,
  onPublished,
}: {
  draft: AdDraft;
  showId: string;
  budgetDaily: number | null;
  pixelId: string | null;
  sac: string;
  onPublished: () => void;
}) {
  const isSac = sac !== 'none';
  const [pages, setPages] = useState<{ id: string; name: string }[]>([]);
  const [auds, setAuds] = useState<
    { id: string; name: string; subtype: string; approximate_count: number | null }[]
  >([]);
  const [pageId, setPageId] = useState('');
  const [mode, setMode] = useState<'custom' | 'manual'>(isSac ? 'manual' : 'custom');
  const [selAud, setSelAud] = useState<string[]>([]);
  const [lat, setLat] = useState('38.0685');
  const [lng, setLng] = useState('-78.8895');
  const [radius, setRadius] = useState(isSac ? '15' : '25');
  const [ageMin, setAgeMin] = useState('18');
  const [ageMax, setAgeMax] = useState('65');
  const [image, setImage] = useState<{ data: string; preview: string; name: string } | null>(null);
  const [ticketLink, setTicketLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [publishedId, setPublishedId] = useState<string | null>(null);

  useEffect(() => {
    listMetaPages().then(setPages).catch(() => {});
    if (!isSac) listCustomAudiences().then(setAuds).catch(() => {});
  }, [isSac]);

  async function onImg(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
    setImage({ data: btoa(bin), preview: URL.createObjectURL(file), name: file.name });
    e.target.value = '';
  }

  function toggleAud(id: string) {
    setSelAud((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  async function onPublish() {
    setErr(null);
    if (!showId) return setErr('Link a profitability run (above) so the budget is set.');
    if (!pageId) return setErr('Pick a Facebook Page.');
    if (!image) return setErr('Attach a creative image.');
    if (!ticketLink.trim()) return setErr('Add the ticket link.');
    setBusy(true);
    const saved = await saveDraft(draft, { profitabilityRunId: showId, budgetDaily });
    if (!('id' in saved)) {
      setErr(saved.error);
      setBusy(false);
      return;
    }
    const appr = await setCampaignStatus(saved.id, 'approved');
    if (!appr.ok) {
      setErr(appr.error);
      setBusy(false);
      return;
    }
    const spec: AudienceSpec =
      isSac || mode === 'manual'
        ? {
            mode: 'manual',
            lat: Number(lat),
            lng: Number(lng),
            radiusMi: Number(radius),
            ageMin: Number(ageMin),
            ageMax: Number(ageMax),
          }
        : {
            mode: 'custom',
            customAudienceIds: selAud,
            lat: Number(lat),
            lng: Number(lng),
            radiusMi: Number(radius),
          };
    const res = await publishCampaign({
      campaignId: saved.id,
      audience: spec,
      pageId,
      ticketLink: ticketLink.trim(),
      imageB64: image.data,
    });
    setBusy(false);
    if (res.ok) {
      setPublishedId(res.metaCampaignId);
      onPublished();
    } else setErr(res.error);
  }

  if (publishedId) {
    return (
      <Card className={'border-green-500/30'}>
        <CardContent className={'space-y-2 py-4 text-sm'}>
          <p className={'font-semibold text-green-700 dark:text-green-300'}>
            Published to Meta as PAUSED — review in Ads Manager and set it live when ready.
          </p>
          <p className={'text-muted-foreground text-xs'}>Meta campaign id: {publishedId}</p>
          <a
            href={'https://adsmanager.facebook.com/adsmanager/manage/campaigns'}
            target={'_blank'}
            rel={'noreferrer'}
            className={'text-primary font-medium'}
          >
            Open Meta Ads Manager →
          </a>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className={'flex items-center gap-2 text-base'}>
          <Rocket className={'h-4 w-4'} /> Audience &amp; publish
        </CardTitle>
      </CardHeader>
      <CardContent className={'space-y-3 text-sm'}>
        {isSac ? (
          <div className={'rounded-md border border-amber-500/30 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300'}>
            Special Ad Category: targeting is restricted by Meta — lookalikes and narrow
            targeting are disabled (18–65, ≥15&nbsp;mi, no custom audiences).
          </div>
        ) : null}

        {/* Page picker */}
        <label className={'block'}>
          <span className={'text-muted-foreground text-xs'}>Facebook Page</span>
          <select
            value={pageId}
            onChange={(e) => setPageId(e.target.value)}
            className={'border-input bg-background mt-1 h-8 w-full rounded border px-2'}
          >
            <option value={''}>Select a Page…</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>

        {/* Pixel (read-only) */}
        <p className={'text-muted-foreground text-xs'}>
          Pixel:{' '}
          {pixelId ? (
            <span className={'font-mono'}>{pixelId}</span>
          ) : (
            <span className={'text-destructive'}>none on this account — required to publish</span>
          )}
        </p>

        {/* Audience mode */}
        {!isSac ? (
          <div className={'flex gap-2 text-xs'}>
            <button
              onClick={() => setMode('custom')}
              className={'rounded-full border px-3 py-1 ' + (mode === 'custom' ? 'border-primary bg-accent' : 'hover:bg-accent/50')}
            >
              Custom audiences
            </button>
            <button
              onClick={() => setMode('manual')}
              className={'rounded-full border px-3 py-1 ' + (mode === 'manual' ? 'border-primary bg-accent' : 'hover:bg-accent/50')}
            >
              Manual (geo + age)
            </button>
          </div>
        ) : null}

        {!isSac && mode === 'custom' ? (
          <div className={'space-y-1'}>
            <p className={'text-muted-foreground text-xs'}>
              Select audiences (lookalikes tagged):
            </p>
            <div className={'max-h-40 space-y-1 overflow-y-auto rounded-md border p-2'}>
              {auds.length === 0 ? (
                <p className={'text-muted-foreground text-xs'}>No custom audiences found.</p>
              ) : (
                auds.map((a) => (
                  <label key={a.id} className={'flex items-center gap-2 text-xs'}>
                    <input type={'checkbox'} checked={selAud.includes(a.id)} onChange={() => toggleAud(a.id)} />
                    <span className={'flex-1 truncate'}>{a.name}</span>
                    {a.subtype === 'LOOKALIKE' ? (
                      <span className={'rounded bg-cyan-500/15 px-1 text-[10px] text-cyan-700'}>LOOKALIKE</span>
                    ) : null}
                    <span className={'text-muted-foreground'}>{a.approximate_count != null ? `~${a.approximate_count.toLocaleString()}` : ''}</span>
                  </label>
                ))
              )}
            </div>
            <div className={'text-muted-foreground flex flex-wrap items-center gap-2 text-xs'}>
              <span>+ radius around</span>
              <input value={lat} onChange={(e) => setLat(e.target.value)} className={'border-input bg-background h-7 w-24 rounded border px-1'} placeholder={'lat'} />
              <input value={lng} onChange={(e) => setLng(e.target.value)} className={'border-input bg-background h-7 w-24 rounded border px-1'} placeholder={'lng'} />
              <input value={radius} onChange={(e) => setRadius(e.target.value)} className={'border-input bg-background h-7 w-16 rounded border px-1'} /> mi
            </div>
          </div>
        ) : (
          <div className={'text-muted-foreground flex flex-wrap items-center gap-2 text-xs'}>
            <span>lat</span>
            <input value={lat} onChange={(e) => setLat(e.target.value)} className={'border-input bg-background h-7 w-24 rounded border px-1'} />
            <span>lng</span>
            <input value={lng} onChange={(e) => setLng(e.target.value)} className={'border-input bg-background h-7 w-24 rounded border px-1'} />
            <span>radius</span>
            <input value={radius} onChange={(e) => setRadius(e.target.value)} disabled={isSac} className={'border-input bg-background h-7 w-16 rounded border px-1'} /> mi
            <span>age</span>
            <input value={ageMin} onChange={(e) => setAgeMin(e.target.value)} disabled={isSac} className={'border-input bg-background h-7 w-12 rounded border px-1'} />
            –
            <input value={ageMax} onChange={(e) => setAgeMax(e.target.value)} disabled={isSac} className={'border-input bg-background h-7 w-12 rounded border px-1'} />
          </div>
        )}

        {/* Creative image */}
        <div className={'flex items-center gap-2'}>
          {image ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.preview} alt={''} className={'h-10 w-10 rounded object-cover'} />
              <span className={'text-muted-foreground truncate text-xs'}>{image.name}</span>
              <button onClick={() => setImage(null)} className={'text-muted-foreground'}>
                <X className={'h-4 w-4'} />
              </button>
            </>
          ) : (
            <label className={'border-input hover:bg-accent inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-xs'}>
              <ImageIcon className={'h-4 w-4'} /> Attach creative image
              <input type={'file'} accept={'image/*'} className={'hidden'} onChange={onImg} />
            </label>
          )}
        </div>

        {/* Ticket link */}
        <label className={'block'}>
          <span className={'text-muted-foreground text-xs'}>Ticket link</span>
          <input
            value={ticketLink}
            onChange={(e) => setTicketLink(e.target.value)}
            placeholder={'https://…'}
            className={'border-input bg-background mt-1 h-8 w-full rounded border px-2'}
          />
        </label>

        {err ? <p className={'text-destructive text-xs'}>{err}</p> : null}

        <Button
          onClick={onPublish}
          disabled={busy || !pageId || !image || !ticketLink.trim() || !showId}
        >
          <Rocket className={'mr-2 h-4 w-4'} /> {busy ? 'Publishing…' : 'Publish to Meta (PAUSED)'}
        </Button>
        <p className={'text-muted-foreground text-[11px]'}>
          Creates the campaign, ad set, and ad in your Meta account — all PAUSED. Nothing
          spends until you set it live in Ads Manager.
        </p>
      </CardContent>
    </Card>
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
