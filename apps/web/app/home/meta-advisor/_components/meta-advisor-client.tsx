'use client';

import { useEffect, useRef, useState } from 'react';

import { History, Send, Sparkles, Upload } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent } from '@kit/ui/card';
import { cn } from '@kit/ui/utils';

import { type AdAnalysis, type AnalysisResult, analyzeMetaCsv } from '../_lib/analyze';
import {
  type ChatMessage,
  type PlanStep,
  askAdvisor,
  getPlan,
} from '../_lib/advisor-chat';
import {
  type SnapshotMeta,
  type TrendPoint,
  getHistory,
  getSnapshotAnalysis,
  getTrendSeries,
  saveAndCompare,
} from '../_lib/snapshots';
import { ACCENT_2, MetricTile, PerfChart } from '../../_components/dashboard-ui';
import { type SavedShow, listAnalyses } from '../../show-engine/_lib/offer-actions';
import { decideScaling } from '../../show-engine/_lib/scaling-advisor';
import { PostEventReport } from './post-event-report';

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

// Explicit, documented badge logic (§7.4). Each badge states the exact rule
// that produced it so the user can trust acting on it (shown on hover).
function statusFor(ad: AdAnalysis): {
  label: string;
  variant: 'success' | 'warning' | 'info';
  reason: string;
} {
  const cpp = ad.cpp;
  const cppTxt = cpp !== null ? `$${cpp.toFixed(2)}` : '—';

  if (ad.daysUntilEnd !== null && ad.daysUntilEnd <= 3) {
    return {
      label: ad.daysUntilEnd <= 0 ? 'Ended' : `Ends ${ad.daysUntilEnd}d`,
      variant: 'warning',
      reason:
        ad.daysUntilEnd <= 0
          ? 'Event has ended — stop spend and capture the buyers as a seed.'
          : `Event ends in ${ad.daysUntilEnd} day(s): final-push window. No time for new creative — ride budget on what converts.`,
    };
  }
  if (
    ad.roas >= 10 &&
    ad.frequency < 3 &&
    (cpp === null || cpp <= 8) &&
    (ad.daysUntilEnd === null || ad.daysUntilEnd > 7)
  ) {
    return {
      label: 'Scale',
      variant: 'success',
      reason: `Scale = ROAS ${ad.roas.toFixed(1)}x (≥10) AND frequency ${ad.frequency.toFixed(2)} (<3.0) AND cost/purchase ${cppTxt} (≤$8) AND runway >7 days. Fund it more — gradually (≤~30–40%/step).`,
    };
  }
  if (ad.frequency >= 3) {
    return {
      label: 'Refresh',
      variant: 'warning',
      reason: `Refresh = frequency ${ad.frequency.toFixed(2)} (≥3.0). The same people are seeing it too often — refresh creative or cap frequency.`,
    };
  }
  if (cpp !== null && cpp > 8) {
    return {
      label: 'Watch',
      variant: 'warning',
      reason: `Watch = cost/purchase ${cppTxt} (>$8 target). Tighten audience/creative or trim budget.`,
    };
  }
  return {
    label: 'Healthy',
    variant: 'info',
    reason: `Healthy = ROAS ${ad.roas.toFixed(1)}x, frequency ${ad.frequency.toFixed(2)} (<3.0), cost/purchase ${cppTxt}. Steady — keep it running.`,
  };
}

export function MetaAdvisorClient() {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [previous, setPrevious] = useState<SnapshotMeta | null>(null);
  const [history, setHistory] = useState<SnapshotMeta[]>([]);
  const [saving, setSaving] = useState(false);
  const [viewingSaved, setViewingSaved] = useState(false);
  const [showReport, setShowReport] = useState(false);

  // On open: load history AND auto-open the most recent report so the page is
  // never blank — you land on graphs, ad list, and trends immediately.
  useEffect(() => {
    getHistory()
      .then((list) => {
        setHistory(list);
        const latest = list[0];
        if (latest) {
          getSnapshotAnalysis(latest.id)
            .then((a) => {
              if (a) {
                setResult(a);
                setViewingSaved(true);
                setFileName(`Latest report · ${latest.periodStart} → ${latest.periodEnd}`);
              }
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setSelected(null);
    setPrevious(null);
    setViewingSaved(false);
    file
      .text()
      .then((text) => {
        const analysis = analyzeMetaCsv(text);
        setResult(analysis);
        setSaving(true);
        saveAndCompare({ summary: analysis.summary, fileName: file.name, ads: analysis.ads })
          .then((res) => {
            if (res.ok) {
              setPrevious(res.previous);
              setHistory(res.history);
            }
          })
          .catch(() => {})
          .finally(() => setSaving(false));
      })
      .catch((err) => {
        setResult(null);
        setError(err instanceof Error ? err.message : 'Could not read that file.');
      });
  }

  function openSaved(snap: SnapshotMeta) {
    getSnapshotAnalysis(snap.id)
      .then((a) => {
        if (!a) return;
        setResult(a);
        setSelected(null);
        setPrevious(null);
        setViewingSaved(true);
        setFileName(`Saved report · ${snap.periodStart} → ${snap.periodEnd}`);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      })
      .catch(() => {});
  }

  return (
    <div className={'space-y-5'}>
      <Card>
        <CardContent className={'flex flex-wrap items-center gap-3 py-4'}>
          <label
            className={
              'border-input bg-background hover:bg-accent inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium'
            }
          >
            <Upload className={'h-4 w-4'} />
            {result ? 'Upload a newer CSV' : 'Upload Meta ads CSV'}
            <input type={'file'} accept={'.csv,text/csv'} className={'hidden'} onChange={onFile} />
          </label>
          <p className={'text-muted-foreground text-xs'}>
            {fileName ?? 'Export from Meta Ads Manager → Reports → Export table data (.csv). Nothing leaves your browser.'}
          </p>
          {error ? <p className={'text-destructive text-sm'}>{error}</p> : null}
        </CardContent>
      </Card>

      {result ? (
        <>
          {viewingSaved ? (
            <div className={'flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'}>
              <History className={'h-4 w-4'} /> Showing your most recent report. Upload a newer CSV to add a new period.
            </div>
          ) : null}

          {(() => {
            const chron = [...history].reverse();
            const roasSeries = chron.map((h) => ({ label: (h.periodEnd ?? '').slice(5), v: h.blendedRoas ?? 0 }));
            const cppSeries = chron.map((h) => ({ label: (h.periodEnd ?? '').slice(5), v: h.blendedCpp ?? 0 }));
            const spendSeries = chron.map((h) => ({ label: (h.periodEnd ?? '').slice(5), v: h.totalSpend ?? 0 }));
            return (
              <div className={'space-y-4'}>
                <p className={'text-muted-foreground text-xs'}>{result.summary.reportStart} → {result.summary.reportEnd}</p>
                <div className={'grid grid-cols-2 gap-3 lg:grid-cols-4'}>
                  <MetricTile label={'Blended ROAS'} value={`${result.summary.blendedRoas.toFixed(1)}x`} series={roasSeries} />
                  <MetricTile label={'Cost / purchase'} value={result.summary.blendedCpp !== null ? money(result.summary.blendedCpp) : '—'} series={cppSeries} accent={ACCENT_2} />
                  <MetricTile label={'Spend'} value={money(result.summary.totalSpend)} series={spendSeries} accent={ACCENT_2} />
                  <MetricTile label={'Purchases'} value={String(result.summary.totalPurchases)} />
                </div>
                {roasSeries.length > 1 ? (
                  <div className={'bg-card rounded-xl border p-4 shadow-sm'}>
                    <p className={'mb-2 text-sm font-semibold'}>Blended ROAS over time</p>
                    <PerfChart series={roasSeries} height={180} />
                  </div>
                ) : null}
              </div>
            );
          })()}

          {previous ? (
            <ComparisonBar current={result.summary} previous={previous} />
          ) : saving ? (
            <p className={'text-muted-foreground text-sm'}>Saving & comparing to your last upload…</p>
          ) : null}

          <div className={'flex justify-end'}>
            <Button variant={'outline'} size={'sm'} onClick={() => setShowReport((v) => !v)}>
              {showReport ? 'Hide post-event report' : '📊 Post-event report'}
            </Button>
          </div>
          {showReport ? <PostEventReport analysis={result} /> : null}

          <div className={'grid gap-4 lg:grid-cols-3'}>
            <div className={'min-w-0 space-y-2 lg:col-span-1'}>
              <p className={'text-sm font-semibold'}>Your ads — pick one</p>
              {result.ads.map((ad, i) => {
                const status = statusFor(ad);
                const active = selected === i;
                return (
                  <button
                    key={i}
                    onClick={() => setSelected(i)}
                    className={cn(
                      'w-full rounded-lg border p-3 text-left transition-colors',
                      active ? 'border-primary bg-accent' : 'hover:bg-accent/50',
                    )}
                  >
                    <div className={'flex items-start justify-between gap-2'}>
                      <span className={'line-clamp-2 text-sm font-medium'}>{ad.adName}</span>
                      <Badge variant={status.variant} className={'shrink-0'} title={status.reason}>{status.label}</Badge>
                    </div>
                    {ad.adSetName ? (
                      <p className={'text-muted-foreground line-clamp-1 text-xs'}>{ad.adSetName}</p>
                    ) : null}
                    <div className={'text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs'}>
                      <span>{ad.roas.toFixed(1)}x ROAS</span>
                      <span>{money(ad.spend)}</span>
                      <span>freq {ad.frequency.toFixed(1)}</span>
                      {ad.daysUntilEnd !== null ? (
                        <span className={ad.daysUntilEnd <= 3 ? 'text-orange-500' : ''}>
                          {ad.daysUntilEnd <= 0 ? 'ended' : `ends ${ad.daysUntilEnd}d`}
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className={'min-w-0 lg:col-span-2'}>
              {selected !== null ? (
                <AdvisorPanel key={selected} ad={result.ads[selected]!} account={result.summary} />
              ) : (
                <Card>
                  <CardContent className={'text-muted-foreground flex h-full items-center justify-center py-16 text-center text-sm'}>
                    Pick an ad on the left to open its dashboard — performance, a step-by-step checklist, and a chat with EVA IQ.
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </>
      ) : history.length === 0 ? (
        <p className={'text-muted-foreground text-sm'}>
          Upload a Meta ads export to get started. Each upload is saved so you can track progress over time.
        </p>
      ) : null}

      {/* History — always visible once you have any */}
      {history.length > 0 ? <HistoryList history={history} onOpen={openSaved} /> : null}
    </div>
  );
}

function AdvisorPanel({ ad, account }: { ad: AdAnalysis; account: AnalysisResult['summary'] }) {
  const dailySpend = account.periodDays > 0 ? ad.spend / account.periodDays : ad.spend;

  const budgetKey = `evaiq-budget-${ad.adSetName}`;
  const [campaignBudget, setCampaignBudget] = useState('');
  const [budgetPeriod, setBudgetPeriod] = useState<'daily' | 'lifetime'>('lifetime');

  const [shows, setShows] = useState<SavedShow[]>([]);
  const [selectedShowId, setSelectedShowId] = useState('');
  const [icRate, setIcRate] = useState(''); // IC→purchase rate (%), optional
  const selectedShow = shows.find((s) => s.id === selectedShowId);
  const showCtx = selectedShow
    ? {
        name: selectedShow.showName,
        tmav: selectedShow.result.tmav,
        cpaEarly: selectedShow.result.cpa_guardrails.early,
        cpaMid: selectedShow.result.cpa_guardrails.mid,
        cpaLate: selectedShow.result.cpa_guardrails.late,
        mrmc: selectedShow.result.mrmc,
        coreTotal: selectedShow.result.budget_tiers[1]?.total_budget ?? 0,
        coreDaily: selectedShow.result.budget_tiers[1]?.daily_budget ?? 0,
        aggressiveTotal: selectedShow.result.budget_tiers[0]?.total_budget ?? 0,
        defenseTotal: selectedShow.result.budget_tiers[2]?.total_budget ?? 0,
        daysRemaining: selectedShow.inputs.days_remaining,
        dealScore: selectedShow.result.deal_score,
      }
    : undefined;

  // Scaling bridge: live CPA (or cost-per-IC) vs the show's TMAV → §11 action.
  // optimizationMode comes from analyze.ts (authoritative). Fallback only covers
  // OLD saved snapshots from before this field existed.
  const optimizationMode: 'initiate_checkout' | 'purchase' =
    ad.optimizationMode ??
    (ad.resultType.toLowerCase().includes('purchase')
      ? 'purchase'
      : 'initiate_checkout');
  // Use the analyzer's labeled metrics. In Purchase mode costPerIC is null, so we
  // never divide a purchase CPA by the IC→purchase rate (the event-type-blind bug).
  const costPerIC =
    ad.costPerIC ??
    (optimizationMode === 'initiate_checkout' && ad.results > 0
      ? ad.spend / ad.results
      : null);
  const costPerPurchase = ad.costPerPurchase ?? ad.cpp;
  const scaling = showCtx
    ? decideScaling({
        tmav: showCtx.tmav,
        optimizationMode,
        budgetStructure: ad.budgetStructure ?? 'ABO',
        liveCostPerPurchase: optimizationMode === 'purchase' ? costPerPurchase : null,
        liveCostPerIC: optimizationMode === 'initiate_checkout' ? costPerIC : null,
        estimatedICtoPurchaseRate: icRate ? Number(icRate) / 100 : null,
        frequency: ad.frequency,
      })
    : null;

  const adCtx = {
    adName: ad.adName,
    adSet: ad.adSetName,
    spend: ad.spend,
    dailySpend,
    purchases: ad.purchases,
    roas: ad.roas,
    costPerPurchase: ad.cpp,
    frequency: ad.frequency,
    optimizingFor: ad.resultType,
    recommendation: ad.recommendation,
    endsDate: ad.endsDate,
    daysUntilEnd: ad.daysUntilEnd,
    adSetWeeklyPurchases: ad.adSetWeeklyPurchases ?? 0,
    icSwitchQualifies: ad.icSwitchQualifies ?? false,
    budgetStructure: ad.budgetStructure ?? 'ABO',
    campaignBudget: campaignBudget ? Number(campaignBudget) : undefined,
    budgetPeriod,
    show: showCtx,
    // Fix 3: the engine's scaling verdict travels into the AI plan so the plan
    // reports it instead of deriving a parallel (possibly contradictory) one.
    scaling: scaling
      ? {
          zone: scaling.zone,
          action: scaling.action,
          reason: scaling.reason,
          budgetChangePct: scaling.budgetChangePct,
          caveats: scaling.caveats,
        }
      : undefined,
  };
  const accountCtx = {
    period: `${account.reportStart} → ${account.reportEnd}`,
    blendedRoas: account.blendedRoas,
    blendedCostPerPurchase: account.blendedCpp,
    totalSpend: account.totalSpend,
  };

  const [steps, setSteps] = useState<PlanStep[] | null>(null);
  const [bottomLine, setBottomLine] = useState('');
  const [planErr, setPlanErr] = useState<string | null>(null);
  const [done, setDone] = useState<boolean[]>([]);
  const storageKey = `evaiq-plan-${account.reportStart}-${account.reportEnd}-${ad.adName}-${ad.adSetName}`;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [input, setInput] = useState('');
  const [chatErr, setChatErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const [trend, setTrend] = useState<TrendPoint[]>([]);
  useEffect(() => {
    getTrendSeries(ad.adName, ad.adSetName)
      .then(setTrend)
      .catch(() => {});
    listAnalyses().then(setShows).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showInit = useRef(false);
  useEffect(() => {
    if (!showInit.current) {
      showInit.current = true;
      return;
    }
    // Reload when the linked run changes OR the engine's scaling zone flips, so
    // the AI plan always reports the current engine decision (Fix 3 alignment).
    reloadPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedShowId, scaling?.zone]);

  function reloadPlan(overrideAmt?: string, overridePeriod?: 'daily' | 'lifetime') {
    const amt = overrideAmt ?? campaignBudget;
    const ctx = {
      ...adCtx,
      campaignBudget: amt ? Number(amt) : undefined,
      budgetPeriod: overridePeriod ?? budgetPeriod,
    };
    setSteps(null);
    setPlanErr(null);
    void getPlan({ ad: ctx, account: accountCtx }).then((res) => {
      if (res.ok) {
        setSteps(res.steps);
        setBottomLine(res.bottomLine);
        try {
          const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
          setDone(
            Array.isArray(saved) && saved.length === res.steps.length
              ? saved
              : new Array(res.steps.length).fill(false),
          );
        } catch {
          setDone(new Array(res.steps.length).fill(false));
        }
      } else {
        setPlanErr(res.error);
      }
    });
  }

  function applyBudget() {
    try {
      localStorage.setItem(budgetKey, JSON.stringify({ amount: campaignBudget, period: budgetPeriod }));
    } catch {
      /* ignore */
    }
    reloadPlan();
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let amt: string | undefined;
    let period: 'daily' | 'lifetime' | undefined;
    try {
      const saved = JSON.parse(localStorage.getItem(budgetKey) ?? 'null');
      if (saved && saved.amount) {
        amt = String(saved.amount);
        period = saved.period ?? 'lifetime';
        setCampaignBudget(amt);
        setBudgetPeriod(period ?? 'lifetime');
      }
    } catch {
      /* ignore */
    }
    reloadPlan(amt, period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, chatBusy]);

  function toggle(i: number) {
    setDone((prev) => {
      const next = [...prev];
      next[i] = !next[i];
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  async function onSend() {
    const text = input.trim();
    if (!text || chatBusy) return;
    setInput('');
    const history = [...messages, { role: 'user' as const, content: text }];
    setMessages(history);
    setChatBusy(true);
    setChatErr(null);
    const doneTitles = (steps ?? []).filter((_, i) => done[i]).map((s) => s.title);
    const res = await askAdvisor({ ad: adCtx, account: accountCtx, messages: history, doneSteps: doneTitles });
    if (res.ok) setMessages([...history, { role: 'assistant', content: res.reply }]);
    else setChatErr(res.error);
    setChatBusy(false);
  }

  const doneCount = done.filter(Boolean).length;

  return (
    <Card className={'flex min-w-0 flex-col overflow-hidden'}>
      <div className={'border-b p-4'}>
        <p className={'font-semibold'}>{ad.adName}</p>
        <p className={'text-muted-foreground text-xs'}>{ad.adSetName}</p>
        <div className={'text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs'}>
          <span>{ad.purchases} purchases</span>
          <span>~{money(dailySpend)}/day</span>
          {ad.daysUntilEnd !== null ? (
            <span className={ad.daysUntilEnd <= 3 ? 'font-medium text-orange-500' : ''}>
              {ad.daysUntilEnd <= 0 ? 'event ended' : `ends in ${ad.daysUntilEnd} day${ad.daysUntilEnd === 1 ? '' : 's'}`}
            </span>
          ) : null}
        </div>
        <p className={'mt-2 text-xs'}>
          Optimizing for <strong>{ad.resultType || 'conversions'}</strong> · this ad set paces ~{(ad.adSetWeeklyPurchases ?? 0).toFixed(1)}/week —{' '}
          {ad.icSwitchQualifies ? (
            <span className={'font-medium text-green-600'}>clears 50/wk → Purchase switch OK</span>
          ) : (
            <span className={'text-muted-foreground'}>hold on Initiate Checkout (needs ~50/wk to switch)</span>
          )}
        </p>
        <p className={'mt-1 text-xs'}>
          Budget:{' '}
          {(ad.budgetStructure ?? 'ABO') === 'CBO' ? (
            <span className={'font-medium text-cyan-600'}>Campaign budget (CBO) — adjust at the campaign level; Meta distributes it</span>
          ) : (
            <span className={'text-muted-foreground'}>Ad-set budget (ABO) — set this ad set&apos;s budget directly</span>
          )}
        </p>
        <div className={'mt-2 flex flex-wrap items-center gap-2 text-xs'}>
          <span className={'text-muted-foreground'}>
            Tell EVA IQ the {(ad.budgetStructure ?? 'ABO') === 'CBO' ? 'campaign' : 'ad set'} budget: $
          </span>
          <input
            type={'number'}
            value={campaignBudget}
            onChange={(e) => setCampaignBudget(e.target.value)}
            placeholder={'e.g. 250'}
            className={'border-input bg-background h-7 w-20 rounded border px-2'}
          />
          <select
            value={budgetPeriod}
            onChange={(e) => setBudgetPeriod(e.target.value as 'daily' | 'lifetime')}
            className={'border-input bg-background h-7 rounded border px-1'}
          >
            <option value={'lifetime'}>lifetime</option>
            <option value={'daily'}>daily</option>
          </select>
          <button onClick={applyBudget} className={'text-primary font-medium'}>
            Apply →
          </button>
        </div>
        <div className={'mt-2 flex flex-wrap items-center gap-2 text-xs'}>
          <span className={'text-muted-foreground'}>Profitability run:</span>
          <select
            value={selectedShowId}
            onChange={(e) => setSelectedShowId(e.target.value)}
            className={'border-input bg-background h-7 max-w-[16rem] rounded border px-1'}
          >
            <option value={''}>None (advisor asks for budget)</option>
            {shows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.showName} · Deal {s.dealScore}
              </option>
            ))}
          </select>
          {shows.length === 0 ? (
            <a href={'/home/show-engine'} className={'text-primary font-medium'}>
              Run one →
            </a>
          ) : selectedShow ? (
            <span className={'font-medium text-cyan-600'}>Budget calculated from this run ✓</span>
          ) : null}
          {selectedShow ? (
            <span className={'flex items-center gap-1'}>
              · IC→purchase rate
              <input
                type={'number'}
                value={icRate}
                onChange={(e) => setIcRate(e.target.value)}
                placeholder={'opt. e.g. 40'}
                className={'border-input bg-background h-7 w-20 rounded border px-2'}
              />
              %
            </span>
          ) : null}
        </div>

        {scaling ? (
          <div className={'mt-2 rounded-md border p-3 text-xs'}>
            <div className={'flex items-center justify-between'}>
              <span className={'font-semibold'}>Scaling decision (vs TMAV {money(showCtx!.tmav)})</span>
              <Badge
                variant={
                  scaling.zone === 'aggressive' || scaling.zone === 'scale'
                    ? 'success'
                    : scaling.zone === 'hold' || scaling.zone === 'late'
                      ? 'warning'
                      : scaling.zone === 'danger'
                        ? 'destructive'
                        : 'secondary'
                }
              >
                {scaling.zone.replace('_', ' ')}
              </Badge>
            </div>
            <p className={'mt-1 font-medium'}>{scaling.action}</p>
            <p className={'text-muted-foreground'}>{scaling.reason}</p>
            {scaling.caveats.map((c, i) => (
              <p key={i} className={'text-orange-500'}>⚠ {c}</p>
            ))}
          </div>
        ) : null}
      </div>

      <div className={'space-y-3 border-b p-4'}>
        <p className={'text-sm font-semibold'}>Performance at a glance</p>
        <Bar label={'ROAS'} value={`${ad.roas.toFixed(1)}x`} fill={Math.min(ad.roas / 20, 1)} good={ad.roas >= 10} caption={'target 10x+'} />
        <Bar label={'Cost / purchase'} value={ad.cpp !== null ? money(ad.cpp) : '—'} fill={ad.cpp !== null ? Math.min(ad.cpp / 16, 1) : 0} good={ad.cpp !== null && ad.cpp <= 8} caption={'target under $8'} />
        <Bar label={'Frequency'} value={ad.frequency.toFixed(2)} fill={Math.min(ad.frequency / 5, 1)} good={ad.frequency < 3} caption={'keep under 3.0'} />
      </div>

      {trend.length >= 2 ? (
        <div className={'space-y-2 border-b p-4'}>
          <p className={'text-sm font-semibold'}>ROAS over time</p>
          <TrendChart data={trend} />
          <p className={'text-muted-foreground text-[11px]'}>Across {trend.length} saved periods for this ad.</p>
        </div>
      ) : null}

      <div className={'border-b p-4'}>
        <div className={'mb-3 flex items-center justify-between'}>
          <p className={'flex items-center gap-2 text-sm font-semibold'}>
            <Sparkles className={'h-4 w-4'} /> Action plan
          </p>
          {steps ? <span className={'text-muted-foreground text-xs'}>{doneCount} of {steps.length} done</span> : null}
        </div>

        {planErr ? <p className={'text-destructive text-sm'}>{planErr}</p> : null}
        {!steps && !planErr ? (
          <p className={'text-muted-foreground flex items-center gap-2 text-sm'}>
            <Sparkles className={'h-4 w-4 animate-pulse'} /> EVA IQ is building your step-by-step plan…
          </p>
        ) : null}

        {steps ? (
          <div className={'space-y-2'}>
            {steps.map((s, i) => (
              <label
                key={i}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors',
                  done[i] ? 'bg-muted/60 border-green-500/40' : 'hover:bg-accent/40',
                )}
              >
                <input type={'checkbox'} checked={done[i] ?? false} onChange={() => toggle(i)} className={'mt-0.5 h-4 w-4 shrink-0'} />
                <span className={'min-w-0'}>
                  <span className={cn('font-medium', done[i] ? 'text-muted-foreground line-through' : '')}>{s.title}</span>
                  <span className={'text-muted-foreground block text-xs'}>{s.detail}</span>
                </span>
              </label>
            ))}
            {bottomLine ? <p className={'text-muted-foreground pt-1 text-sm italic'}>{bottomLine}</p> : null}
          </div>
        ) : null}
      </div>

      <div className={'flex flex-col'}>
        <div ref={scrollRef} className={'max-h-72 space-y-3 overflow-y-auto p-4'}>
          {messages.length === 0 ? (
            <p className={'text-muted-foreground text-sm'}>
              Ask EVA IQ anything about this ad — e.g. “write me a new headline”, “what exact budget should I move here?”, “why is frequency a problem?”
            </p>
          ) : null}
          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
                m.role === 'user' ? 'bg-primary text-primary-foreground ml-auto' : 'bg-muted',
              )}
            >
              {m.content}
            </div>
          ))}
          {chatBusy ? <p className={'text-muted-foreground text-xs'}>EVA IQ is typing…</p> : null}
          {chatErr ? <p className={'text-destructive text-sm'}>{chatErr}</p> : null}
        </div>
        <div className={'flex items-center gap-2 border-t p-3'}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSend();
            }}
            placeholder={'Ask a question or give feedback…'}
            className={
              'border-input bg-background focus-visible:ring-ring flex-1 rounded-md border px-3 py-2 text-sm focus-visible:ring-1 focus-visible:outline-none'
            }
            disabled={chatBusy}
          />
          <Button size={'icon'} onClick={onSend} disabled={chatBusy || !input.trim()}>
            <Send className={'h-4 w-4'} />
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Bar({ label, value, fill, good, caption }: { label: string; value: string; fill: number; good: boolean; caption: string }) {
  return (
    <div className={'min-w-0'}>
      <div className={'mb-1 flex items-center justify-between gap-2 text-xs'}>
        <span className={'font-medium'}>{label}</span>
        <span className={cn('shrink-0 tabular-nums', good ? 'text-green-600' : 'text-orange-500')}>{value}</span>
      </div>
      <div className={'bg-muted h-2 w-full overflow-hidden rounded-full'}>
        <div className={cn('h-full rounded-full', good ? 'bg-green-500' : 'bg-orange-500')} style={{ width: `${Math.max(4, Math.min(100, fill * 100))}%` }} />
      </div>
      <p className={'text-muted-foreground mt-0.5 text-[11px]'}>{caption}</p>
    </div>
  );
}

function TrendChart({ data }: { data: TrendPoint[] }) {
  const chartData = data.map((d) => ({
    name: d.period ? d.period.slice(5) : '',
    ROAS: d.roas ?? 0,
  }));
  return (
    <ResponsiveContainer width={'100%'} height={140}>
      <LineChart data={chartData} margin={{ top: 5, right: 8, left: -22, bottom: 0 }}>
        <XAxis dataKey={'name'} fontSize={10} tickLine={false} axisLine={false} />
        <YAxis fontSize={10} tickLine={false} axisLine={false} width={30} />
        <Tooltip formatter={(v: number) => [`${Number(v).toFixed(1)}x`, 'ROAS']} />
        <Line type={'monotone'} dataKey={'ROAS'} stroke={'#16a34a'} strokeWidth={2} dot />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ComparisonBar({ current, previous }: { current: AnalysisResult['summary']; previous: SnapshotMeta }) {
  return (
    <Card>
      <CardContent className={'py-4'}>
        <p className={'mb-3 text-sm font-semibold'}>
          Since your last upload{' '}
          <span className={'text-muted-foreground font-normal'}>({previous.periodStart} → {previous.periodEnd})</span>
        </p>
        <div className={'grid grid-cols-2 gap-4 sm:grid-cols-4'}>
          <Delta label={'Blended ROAS'} cur={current.blendedRoas} prev={previous.blendedRoas} fmt={(n) => `${n.toFixed(1)}x`} higherIsBetter />
          <Delta label={'Cost / purchase'} cur={current.blendedCpp} prev={previous.blendedCpp} fmt={money} higherIsBetter={false} />
          <Delta label={'Spend'} cur={current.totalSpend} prev={previous.totalSpend} fmt={money} neutral />
          <Delta label={'Purchases'} cur={current.totalPurchases} prev={previous.totalPurchases} fmt={(n) => String(Math.round(n))} higherIsBetter />
        </div>
      </CardContent>
    </Card>
  );
}

function Delta({ label, cur, prev, fmt, higherIsBetter, neutral }: { label: string; cur: number | null; prev: number | null; fmt: (n: number) => string; higherIsBetter?: boolean; neutral?: boolean }) {
  const hasBoth = cur !== null && prev !== null;
  const diff = hasBoth ? cur - prev : 0;
  const up = diff > 0.0001;
  const down = diff < -0.0001;
  const good = neutral ? false : higherIsBetter ? up : down;
  const bad = neutral ? false : higherIsBetter ? down : up;
  const color = good ? 'text-green-600' : bad ? 'text-red-600' : 'text-muted-foreground';

  return (
    <div>
      <p className={'text-muted-foreground text-xs'}>{label}</p>
      <p className={'text-xl font-bold'}>{cur !== null ? fmt(cur) : '—'}</p>
      {hasBoth && (up || down) ? (
        <p className={cn('text-xs font-medium', color)}>{up ? '▲' : '▼'} {fmt(Math.abs(diff))} vs {fmt(prev)}</p>
      ) : (
        <p className={'text-muted-foreground text-xs'}>{hasBoth ? 'no change' : 'first upload'}</p>
      )}
    </div>
  );
}

function HistoryList({ history, onOpen }: { history: SnapshotMeta[]; onOpen: (s: SnapshotMeta) => void }) {
  return (
    <Card>
      <CardContent className={'py-4'}>
        <p className={'mb-1 flex items-center gap-2 text-sm font-semibold'}>
          <History className={'h-4 w-4'} /> Upload history
        </p>
        <p className={'text-muted-foreground mb-3 text-xs'}>Click any period to re-open its full report.</p>
        <div className={'divide-y'}>
          {history.map((h) => (
            <button
              key={h.id}
              onClick={() => onOpen(h)}
              className={'hover:bg-accent/50 flex w-full flex-wrap items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors'}
            >
              <span className={'font-medium'}>{h.periodStart} → {h.periodEnd}</span>
              <span className={'text-muted-foreground flex flex-wrap gap-x-3 text-xs'}>
                <span>{h.blendedRoas !== null ? `${h.blendedRoas.toFixed(1)}x ROAS` : ''}</span>
                <span>{h.blendedCpp !== null ? `${money(h.blendedCpp)}/purch` : ''}</span>
                <span>{h.totalPurchases ?? ''} purchases</span>
                <span>{new Date(h.uploadedAt).toLocaleDateString()}</span>
              </span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
