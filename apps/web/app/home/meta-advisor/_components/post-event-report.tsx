'use client';

import { useEffect, useMemo, useState } from 'react';

import { Copy, Printer } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';

import { type AnalysisResult } from '../_lib/analyze';
import {
  type ShowEconomics,
  buildPostEventReport,
  reportToText,
} from '../_lib/post-event';
import { type SavedShow, listAnalyses } from '../../show-engine/_lib/offer-actions';

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const money2 = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export function PostEventReport({ analysis }: { analysis: AnalysisResult }) {
  const [shows, setShows] = useState<SavedShow[]>([]);
  const [showId, setShowId] = useState('');
  const [actualFb, setActualFb] = useState(''); // ACTUAL F&B/head from sales
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    listAnalyses()
      .then(setShows)
      .catch(() => {});
  }, []);

  const econ: ShowEconomics | null = useMemo(() => {
    const s = shows.find((x) => x.id === showId);
    if (!s) return null;
    // F&B-INDEPENDENT base = ticket marginal value + net booking fee. We do NOT
    // pull the show's planning F&B (the $32 assumption) into the verdict.
    return {
      showName: s.showName,
      ticketPlusFeePerHead: s.result.tmv + (s.result.net_fee_per_head ?? 0),
      actualFbPerHead: actualFb.trim() === '' ? null : Number(actualFb),
    };
  }, [shows, showId, actualFb]);

  const report = useMemo(
    () => buildPostEventReport(analysis, econ),
    [analysis, econ],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(reportToText(report));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  const verdictTone =
    report.verdict.level === 'profitable'
      ? 'border-green-500/30 bg-green-50 text-green-800 dark:bg-green-500/10 dark:text-green-300'
      : report.verdict.level === 'borderline'
        ? 'border-amber-500/30 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300'
        : report.verdict.level === 'over'
          ? 'border-red-500/30 bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300'
          : 'border-blue-500/30 bg-blue-50 text-blue-800 dark:bg-blue-500/10 dark:text-blue-300';

  return (
    <Card className={'print:shadow-none'}>
      <CardHeader>
        <div className={'flex flex-wrap items-center justify-between gap-2'}>
          <CardTitle className={'text-base'}>Post-event report</CardTitle>
          <div className={'flex flex-wrap items-center gap-2 text-xs'}>
            <span className={'text-muted-foreground'}>Show economics:</span>
            <select
              value={showId}
              onChange={(e) => setShowId(e.target.value)}
              className={'border-input bg-background h-7 max-w-[15rem] rounded border px-1'}
            >
              <option value={''}>None (ROAS summary)</option>
              {shows.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.showName} · Deal {s.dealScore}
                </option>
              ))}
            </select>
            {showId ? (
              <span className={'flex items-center gap-1'} title={'Actual F&B revenue per head from POS/sales. Leave blank to exclude F&B — the planning assumption is never used here.'}>
                · actual F&amp;B/head $
                <input
                  type={'number'}
                  value={actualFb}
                  onChange={(e) => setActualFb(e.target.value)}
                  placeholder={'from sales'}
                  className={'border-input bg-background h-7 w-24 rounded border px-2'}
                />
              </span>
            ) : null}
            <Button variant={'outline'} size={'sm'} onClick={copy}>
              <Copy className={'mr-1 h-3.5 w-3.5'} /> {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button
              variant={'outline'}
              size={'sm'}
              onClick={() => window.print()}
            >
              <Printer className={'mr-1 h-3.5 w-3.5'} /> Print
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className={'space-y-5'}>
        <p className={'text-muted-foreground text-xs'}>{report.summary.periodLabel}</p>

        {/* 1. Verdict */}
        <div className={`rounded-md border px-3 py-2 text-sm font-medium ${verdictTone}`}>
          {report.verdict.headline}
        </div>
        {report.verdict.fbNote ? (
          <p className={'text-muted-foreground -mt-3 text-xs'}>{report.verdict.fbNote}</p>
        ) : null}

        {/* 2. Blended summary */}
        <div className={'grid grid-cols-2 gap-3 text-sm sm:grid-cols-5'}>
          <Stat label={'Spend'} value={money(report.summary.spend)} />
          <Stat label={'Sales'} value={String(report.summary.purchases)} />
          <Stat label={'Blended ROAS'} value={`${report.summary.roas.toFixed(1)}x`} />
          <Stat
            label={'Cost / sale'}
            value={report.summary.costPerPurchase !== null ? money2(report.summary.costPerPurchase) : '—'}
          />
          <Stat label={'Revenue'} value={money(report.summary.revenue)} />
        </div>

        {/* 3. Ad-set breakdown */}
        <div>
          <p className={'mb-2 text-sm font-semibold'}>Ad sets — best to worst</p>
          <div className={'overflow-x-auto'}>
            <table className={'w-full text-left text-xs'}>
              <thead className={'text-muted-foreground'}>
                <tr>
                  <th className={'py-1 pr-2'}>Ad set</th>
                  <th className={'px-2'}>Audience</th>
                  <th className={'px-2 text-right'}>Spend</th>
                  <th className={'px-2 text-right'}>ROAS</th>
                  <th className={'px-2 text-right'}>$/sale</th>
                  <th className={'px-2 text-right'}>Freq</th>
                  <th className={'px-2'}>Status</th>
                </tr>
              </thead>
              <tbody>
                {report.adSets.map((a) => (
                  <tr key={a.adSetName} className={'border-t'}>
                    <td className={'max-w-[16rem] truncate py-1 pr-2 font-medium'} title={a.adSetName}>
                      {a.adSetName}
                    </td>
                    <td className={'px-2'}>
                      <Badge variant={a.audienceType === 'retargeting' ? 'info' : a.audienceType === 'lookalike' ? 'success' : 'secondary'}>
                        {a.audienceType}
                      </Badge>
                    </td>
                    <td className={'px-2 text-right tabular-nums'}>{money(a.spend)}</td>
                    <td className={'px-2 text-right font-semibold tabular-nums'}>{a.roas.toFixed(1)}x</td>
                    <td className={`px-2 text-right tabular-nums ${a.belowGuardrail ? 'text-red-600' : ''}`}>
                      {a.costPerPurchase !== null ? money2(a.costPerPurchase) : '—'}
                    </td>
                    <td className={`px-2 text-right tabular-nums ${a.freqFlag === 'stop' ? 'font-semibold text-red-600' : a.freqFlag === 'warn' ? 'text-amber-600' : ''}`}>
                      {a.maxFrequency.toFixed(1)}
                    </td>
                    <td className={'px-2'}>
                      <span className={a.delivery === 'not delivering' ? 'text-muted-foreground' : ''}>
                        {a.delivery}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 4. Frequency flags */}
        {report.frequencyFlags.length ? (
          <FlagBlock title={'Frequency / fatigue flags'} items={report.frequencyFlags} tone={'amber'} />
        ) : null}

        {/* 5. Optimization-mode flags */}
        {report.optimizationFlags.length ? (
          <FlagBlock title={'Optimization-mode check (IC-first rule)'} items={report.optimizationFlags} tone={'blue'} />
        ) : null}

        {/* 6. Next-show recommendations */}
        <div>
          <p className={'mb-2 text-sm font-semibold'}>Next show — do this</p>
          <ul className={'list-disc space-y-1 pl-5 text-sm'}>
            {report.recommendations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className={'text-muted-foreground text-xs'}>{label}</p>
      <p className={'text-lg font-bold'}>{value}</p>
    </div>
  );
}

function FlagBlock({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: 'amber' | 'blue';
}) {
  const cls =
    tone === 'amber'
      ? 'border-amber-500/30 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300'
      : 'border-blue-500/30 bg-blue-50 text-blue-800 dark:bg-blue-500/10 dark:text-blue-300';
  return (
    <div>
      <p className={'mb-2 text-sm font-semibold'}>{title}</p>
      <ul className={`space-y-1 rounded-md border px-3 py-2 text-sm ${cls}`}>
        {items.map((it, i) => (
          <li key={i}>⚠ {it}</li>
        ))}
      </ul>
    </div>
  );
}
