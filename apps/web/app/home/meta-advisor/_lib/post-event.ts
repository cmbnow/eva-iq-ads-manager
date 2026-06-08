/**
 * Post-Event Analyzer — turns an uploaded CSV analysis (+ optional show
 * economics) into a profit-first wrap-up report. It REUSES the analyzer's
 * outputs (optimization mode, weekly pace, frequency) and the engine's
 * thresholds (frequency warn/stop, IC-first 50/wk, CPA ceiling) — it translates
 * those decisions, it does not re-derive them.
 */
import {
  type AdAnalysis,
  type AnalysisResult,
  PURCHASE_SWITCH_WEEKLY_THRESHOLD,
} from './analyze';
import {
  FREQ_HARD_STOP,
  FREQ_WARNING,
} from '../../show-engine/_lib/scaling-advisor';

export type ShowEconomics = {
  showName: string;
  tmav: number; // CPA ceiling (1.0×)
  cpaLate: number; // 0.9× guardrail
};

export type AudienceType = 'retargeting' | 'lookalike' | 'cold';

export type AdSetRollup = {
  adSetName: string;
  audienceType: AudienceType;
  spend: number;
  purchases: number;
  revenue: number;
  roas: number;
  costPerPurchase: number | null;
  frequency: number; // spend-weighted average
  maxFrequency: number;
  delivery: string; // active / not delivering
  optimizationMode: 'initiate_checkout' | 'purchase';
  weeklyPurchases: number;
  freqFlag: 'none' | 'warn' | 'stop';
  belowGuardrail: boolean; // cost/purchase above the show's CPA ceiling
};

export type PostEventReport = {
  verdict: {
    basis: 'profit' | 'roas';
    level: 'profitable' | 'borderline' | 'over' | 'na';
    headline: string;
    spend: number;
    affordable: number | null;
    gap: number | null; // affordable − spend (positive = headroom)
  };
  summary: {
    spend: number;
    purchases: number;
    roas: number;
    costPerPurchase: number | null;
    revenue: number;
    periodLabel: string;
  };
  adSets: AdSetRollup[];
  frequencyFlags: string[];
  optimizationFlags: string[];
  recommendations: string[];
};

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const money2 = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

function classifyAudience(name: string): AudienceType {
  const n = name.toLowerCase();
  if (/lookalike|\blal\b|1%/.test(n)) return 'lookalike';
  if (/retarget|buyers|seetickets|hive|past|engaged|cart/.test(n))
    return 'retargeting';
  return 'cold';
}

function rollupAdSets(
  ads: AdAnalysis[],
  econ: ShowEconomics | null,
): AdSetRollup[] {
  const groups = new Map<string, AdAnalysis[]>();
  for (const a of ads) {
    const arr = groups.get(a.adSetName) ?? [];
    arr.push(a);
    groups.set(a.adSetName, arr);
  }

  const rollups: AdSetRollup[] = [];
  for (const [adSetName, members] of groups) {
    const spend = members.reduce((s, a) => s + a.spend, 0);
    const purchases = members.reduce((s, a) => s + a.purchases, 0);
    const revenue = members.reduce((s, a) => s + a.revenue, 0);
    const roas = spend > 0 ? revenue / spend : 0;
    const costPerPurchase = purchases > 0 ? spend / purchases : null;
    const frequency =
      spend > 0
        ? members.reduce((s, a) => s + a.frequency * a.spend, 0) / spend
        : 0;
    const maxFrequency = members.reduce((m, a) => Math.max(m, a.frequency), 0);
    // Authoritative optimization mode: take the highest-spend ad's read.
    const lead = [...members].sort((x, y) => y.spend - x.spend)[0]!;
    const delivery = members.some((a) => a.delivery.includes('active'))
      ? 'active'
      : members.every((a) => a.delivery.includes('not_delivering'))
        ? 'not delivering'
        : (lead.delivery ?? 'unknown');

    const freqFlag: 'none' | 'warn' | 'stop' =
      maxFrequency >= FREQ_HARD_STOP
        ? 'stop'
        : maxFrequency >= FREQ_WARNING
          ? 'warn'
          : 'none';

    rollups.push({
      adSetName,
      audienceType: classifyAudience(adSetName),
      spend,
      purchases,
      revenue,
      roas,
      costPerPurchase,
      frequency,
      maxFrequency,
      delivery,
      optimizationMode: lead.optimizationMode,
      weeklyPurchases: lead.adSetWeeklyPurchases,
      freqFlag,
      belowGuardrail:
        econ != null && costPerPurchase != null && costPerPurchase > econ.tmav,
    });
  }

  // Best-to-worst by ROAS.
  rollups.sort((a, b) => b.roas - a.roas);
  return rollups;
}

export function buildPostEventReport(
  analysis: AnalysisResult,
  econ: ShowEconomics | null,
): PostEventReport {
  const s = analysis.summary;
  const adSets = rollupAdSets(analysis.ads, econ);

  // ---- 1. Headline verdict (profit-first) ----
  let verdict: PostEventReport['verdict'];
  if (econ && s.totalPurchases > 0) {
    const affordable = econ.tmav * s.totalPurchases;
    const gap = affordable - s.totalSpend;
    const level: 'profitable' | 'borderline' | 'over' =
      s.totalSpend <= 0.9 * affordable
        ? 'profitable'
        : s.totalSpend <= affordable
          ? 'borderline'
          : 'over';
    const head =
      level === 'profitable'
        ? `This show's ads were PROFITABLE — ${money(s.totalSpend)} spent against ${money(affordable)} affordable (TMAV ${money(econ.tmav)} × ${s.totalPurchases} sales). ${money(gap)} to spare.`
        : level === 'borderline'
          ? `Borderline — ${money(s.totalSpend)} spent against ${money(affordable)} affordable; only ${money(gap)} of headroom.`
          : `OVER BUDGET — ${money(s.totalSpend)} spent vs ${money(affordable)} affordable; ${money(Math.abs(gap))} past what the show could bear.`;
    verdict = { basis: 'profit', level, headline: head, spend: s.totalSpend, affordable, gap };
  } else {
    verdict = {
      basis: 'roas',
      level: 'na',
      headline: `Show economics weren't entered, so this is a performance (ROAS) summary, not a profit verdict: blended ROAS ${s.blendedRoas.toFixed(1)}x on ${money(s.totalSpend)} spend${s.blendedCpp !== null ? `, ${money2(s.blendedCpp)}/sale` : ''}. Enter the show in the Show Engine to get the profit verdict.`,
      spend: s.totalSpend,
      affordable: null,
      gap: null,
    };
  }

  // ---- 4. Frequency / fatigue flags ----
  const frequencyFlags: string[] = [];
  for (const a of adSets) {
    if (a.freqFlag === 'none') continue;
    const tag = a.freqFlag === 'stop' ? `≥ ${FREQ_HARD_STOP} hard stop` : `≥ ${FREQ_WARNING} warning`;
    const small = a.audienceType === 'retargeting' ? ' (a small retargeting audience saturates fast)' : '';
    frequencyFlags.push(
      `"${a.adSetName}" ran at frequency ${a.maxFrequency.toFixed(1)} (${tag})${small} — at this frequency you're paying to re-show the ad to people who already decided. Cap its budget or refresh creative.`,
    );
  }

  // ---- 5. Optimization-mode check (echo the engine's IC-first rule) ----
  const optimizationFlags: string[] = [];
  for (const a of adSets) {
    if (
      a.optimizationMode === 'purchase' &&
      a.weeklyPurchases < PURCHASE_SWITCH_WEEKLY_THRESHOLD
    ) {
      optimizationFlags.push(
        `"${a.adSetName}" ran on Purchase optimization at ~${a.weeklyPurchases.toFixed(0)} sales/week (under ${PURCHASE_SWITCH_WEEKLY_THRESHOLD}/week) — the IC-first rule says it should have stayed on Initiate Checkout until it cleared that volume.`,
      );
    }
  }

  // ---- 6. Next-show recommendations (from this show's data) ----
  const recommendations: string[] = [];
  // Fatigued winners first.
  for (const a of adSets) {
    if (a.freqFlag === 'stop' && a.roas >= 8) {
      recommendations.push(
        `"${a.adSetName}" hit ${a.roas.toFixed(1)}x but frequency reached ${a.maxFrequency.toFixed(1)} — cap its budget or refresh creative earlier next time.`,
      );
    }
  }
  // Reliable cold/lookalike workhorse.
  const workhorse = adSets.find(
    (a) => (a.audienceType === 'lookalike' || a.audienceType === 'cold') && a.roas >= 6 && a.freqFlag !== 'stop',
  );
  if (workhorse) {
    recommendations.push(
      `"${workhorse.adSetName}" (${workhorse.audienceType}) held ${workhorse.roas.toFixed(1)}x — your reliable cold-audience workhorse; fund it first next show.`,
    );
  }
  // Underperformers that ate spend.
  const dud = adSets
    .filter((a) => a.spend >= 20 && (a.belowGuardrail || a.roas < 4 || a.delivery === 'not delivering'))
    .sort((x, y) => y.spend - x.spend)[0];
  if (dud) {
    const why = dud.belowGuardrail
      ? `cost/sale ${dud.costPerPurchase !== null ? money2(dud.costPerPurchase) : '—'} above the show's ceiling`
      : dud.delivery === 'not delivering'
        ? 'it stopped delivering yet still spent'
        : `only ${dud.roas.toFixed(1)}x`;
    recommendations.push(
      `"${dud.adSetName}" spent ${money(dud.spend)} (${why}) — cut or rework it before the next flight.`,
    );
  }
  // Optimization discipline.
  if (optimizationFlags.length) {
    recommendations.push(
      `Keep ad sets on Initiate Checkout until one individually clears ~${PURCHASE_SWITCH_WEEKLY_THRESHOLD} purchases/week before switching to Purchase.`,
    );
  }
  // Profit cap if over budget.
  if (verdict.level === 'over' && verdict.affordable != null) {
    recommendations.push(
      `Total spend exceeded what the show could afford — set a hard cap near ${money(verdict.affordable)} next time and pause once cost/sale crosses ${money(econ!.tmav)}.`,
    );
  }
  // Always give at least a couple of bullets.
  if (recommendations.length < 3) {
    const top = adSets[0];
    if (top) {
      recommendations.push(
        `Your best ad set was "${top.adSetName}" at ${top.roas.toFixed(1)}x — scale it gradually (≤~30%/step) and seed a fresh 1% lookalike from its buyers.`,
      );
    }
    recommendations.push(
      'Capture this show’s buyers as a first-party seed for the next event’s lookalike.',
    );
  }

  return {
    verdict,
    summary: {
      spend: s.totalSpend,
      purchases: s.totalPurchases,
      roas: s.blendedRoas,
      costPerPurchase: s.blendedCpp,
      revenue: s.totalRevenue,
      periodLabel: `${s.reportStart} → ${s.reportEnd}`,
    },
    adSets,
    frequencyFlags,
    optimizationFlags,
    recommendations: recommendations.slice(0, 5),
  };
}

/** Plain-text version for copy/share (client builds the on-screen view). */
export function reportToText(r: PostEventReport): string {
  const L: string[] = [];
  L.push('POST-EVENT AD REPORT');
  L.push(r.summary.periodLabel);
  L.push('');
  L.push('VERDICT: ' + r.verdict.headline);
  L.push('');
  L.push(
    `Summary: ${money(r.summary.spend)} spend · ${r.summary.purchases} sales · ${r.summary.roas.toFixed(1)}x ROAS · ${r.summary.costPerPurchase !== null ? money2(r.summary.costPerPurchase) : '—'}/sale · ${money(r.summary.revenue)} revenue`,
  );
  L.push('');
  L.push('AD SETS (best → worst):');
  for (const a of r.adSets) {
    L.push(
      `  • ${a.adSetName} [${a.audienceType}] — ${a.roas.toFixed(1)}x · ${money(a.spend)} · ${a.costPerPurchase !== null ? money2(a.costPerPurchase) : '—'}/sale · freq ${a.maxFrequency.toFixed(1)} · ${a.delivery}${a.freqFlag !== 'none' ? ` · FREQ ${a.freqFlag.toUpperCase()}` : ''}${a.belowGuardrail ? ' · OVER CEILING' : ''}`,
    );
  }
  if (r.frequencyFlags.length) {
    L.push('');
    L.push('FREQUENCY FLAGS:');
    r.frequencyFlags.forEach((f) => L.push('  • ' + f));
  }
  if (r.optimizationFlags.length) {
    L.push('');
    L.push('OPTIMIZATION FLAGS:');
    r.optimizationFlags.forEach((f) => L.push('  • ' + f));
  }
  L.push('');
  L.push('NEXT SHOW:');
  r.recommendations.forEach((f) => L.push('  • ' + f));
  return L.join('\n');
}
