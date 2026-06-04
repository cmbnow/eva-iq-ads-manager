'use client';

import { useEffect, useState } from 'react';

import { Megaphone, Sparkles } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';

import {
  type AdDraft,
  type CampaignRow,
  generateAdDraft,
  getMetaEnablement,
  listCampaigns,
  saveDraft,
  setCampaignStatus,
} from '../_lib/campaigns';

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'info' | 'secondary'> = {
  draft: 'secondary',
  pending_approval: 'warning',
  approved: 'info',
  published: 'success',
};

export function ComposerClient() {
  const [brief, setBrief] = useState('');
  const [draft, setDraft] = useState<AdDraft | null>(null);
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
    if (res.ok) setDraft(res.draft);
    else setGenErr(res.error);
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
    } else {
      setGenErr(res.error);
    }
  }

  async function onStatus(id: string, status: 'pending_approval' | 'approved' | 'published') {
    setActionErr(null);
    const res = await setCampaignStatus(id, status);
    if (res.ok) listCampaigns().then(setCampaigns).catch(() => {});
    else setActionErr(res.error);
  }

  return (
    <div className={'space-y-6'}>
      <div className={'rounded-md border border-amber-500/30 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300'}>
        {metaEnabled
          ? 'Meta publishing is enabled for this account.'
          : 'Advisor mode: drafts are written and ready to paste into Meta. Live one-click publishing turns on once Meta Advanced Access + this account’s enablement clear. Approvals, spend caps, and an audit log are recorded regardless.'}
      </div>

      {/* Composer */}
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

          {draft ? (
            <div className={'bg-muted space-y-3 rounded-md p-4 text-sm'}>
              <p className={'font-semibold'}>{draft.name}</p>
              <Field label={'Primary text'} value={draft.primaryText} />
              <Field label={'Headlines'} value={draft.headlines.join('  •  ')} />
              <Field label={'Descriptions'} value={draft.descriptions.join('  •  ')} />
              <Field label={'Call to action'} value={draft.cta} />
              <Field label={'Creative brief'} value={draft.creativeBrief} />
              <Field label={'Targeting'} value={draft.targeting} />
              {draft.buildSteps.length ? (
                <div>
                  <p className={'text-muted-foreground text-xs'}>Build steps</p>
                  <ol className={'list-decimal space-y-1 pl-5'}>
                    {draft.buildSteps.map((s, i) => <li key={i}>{s}</li>)}
                  </ol>
                </div>
              ) : null}
              <Button onClick={onSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save as draft'}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Saved campaigns */}
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
                  <Badge variant={STATUS_VARIANT[c.status] ?? 'secondary'}>{c.status.replace('_', ' ')}</Badge>
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className={'text-muted-foreground text-xs'}>{label}</p>
      <p className={'whitespace-pre-wrap'}>{value}</p>
    </div>
  );
}
