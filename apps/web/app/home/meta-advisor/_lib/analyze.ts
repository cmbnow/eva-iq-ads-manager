/**
 * Meta Advisor — deterministic CSV analysis (no AI / no API key needed).
 * Parses a Meta Ads Manager "Export table data" CSV and scores each ad
 * against the Foundry benchmarks from the spec (§13).
 */

export const BENCHMARKS = {
  cppTarget: 8, // cost per purchase target (USD)
  frequencyCeiling: 3.0, // fatigue warning above this
  roasStrong: 10, // ROAS at/above this = strong
  roasWeak: 4, // ROAS below this = underperforming
  scaleSpendCeiling: 50, // "underfunded" if spend below this w/ strong ROAS
  // INTERIM noise filter: trust "scale/winner" advice only at/above this RATE
  // (sales/ad-set/week). A rate is comparable across export windows; a fixed
  // total is not. Kept distinct from PURCHASE_SWITCH_WEEKLY_THRESHOLD (different
  // decision) even though the value matches today.
  // TODO(profit-logic): replace with marginal cost-per-sale vs. per-ticket
  // margin once the margin input exists — "does the next ad dollar return > $1
  // of ticket margin?" is the real test, not a sales count.
  scaleConfidenceWeeklyThreshold: 50,
};

export type Flag = {
  level: 'good' | 'warn' | 'bad';
  text: string;
};

// What the ad set OPTIMIZES on. This is authoritative for how to read the
// "Results" column: in IC mode Results are Initiate-Checkouts; in Purchase mode
// Results are Purchases. Never infer the cost metric from the raw Results count
// without knowing this — that silently turns cost-per-IC into cost-per-purchase.
export type OptimizationMode = 'initiate_checkout' | 'purchase';

export type AdAnalysis = {
  adName: string;
  adSetName: string;
  spend: number;
  purchases: number;
  results: number;
  resultType: string; // e.g. "Initiate Checkout" or "Purchase"
  optimizationMode: OptimizationMode; // authoritative: what THIS ad set optimizes on
  optimizationModeAssumed: boolean; // true if the export didn't state it and we defaulted to IC
  costPerIC: number | null; // cost per Initiate Checkout — ONLY when IC-optimized, else null
  costPerPurchase: number | null; // cost per Purchase (the real purchase CPA) — same as cpp
  roas: number;
  revenue: number;
  cpp: number | null; // cost per purchase
  frequency: number;
  reach: number;
  impressions: number;
  cpm: number;
  qualityRanking: string;
  endsDate: string; // event/ad end date from the "Ends" column
  daysUntilEnd: number | null; // days from today until it ends
  adSetWeeklyPurchases: number; // this ad set's purchases per 7-day window
  icSwitchQualifies: boolean; // ad set clears ~50 purchases/week => Purchase switch ok
  budgetStructure: 'CBO' | 'ABO'; // CBO = campaign budget (Meta distributes); ABO = ad-set budget
  flags: Flag[];
  recommendation: string;
};

// Confirmed threshold: switch an AD SET to Purchase optimization only when it
// individually reaches this many Purchase events per rolling 7-day window.
export const PURCHASE_SWITCH_WEEKLY_THRESHOLD = 50;

export type AccountSummary = {
  totalSpend: number;
  totalRevenue: number;
  totalPurchases: number;
  blendedRoas: number;
  blendedCpp: number | null;
  adCount: number;
  reportStart: string;
  reportEnd: string;
  periodDays: number; // length of the reporting window in days
};

export type AnalysisResult = {
  summary: AccountSummary;
  ads: AdAnalysis[];
  highlights: string[]; // account-level takeaways
};

// ---- CSV parsing (handles quoted fields w/ commas + escaped quotes) ----
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((v) => v.trim() !== '')) rows.push(row);
  }
  return rows;
}

function num(v: string | undefined): number {
  if (!v) return 0;
  const n = parseFloat(v.replace(/[$,%]/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function prettyResultType(indicator: string): string {
  if (!indicator) return 'Result';
  if (indicator.includes('initiate_checkout')) return 'Initiate Checkout';
  if (indicator.includes('purchase')) return 'Purchase';
  if (indicator.includes('lead')) return 'Lead';
  const last = indicator.split('.').pop() ?? indicator;
  return last.replace(/_/g, ' ');
}

// Map a header name (loose) to its column index.
function headerIndex(headers: string[], ...candidates: string[]): number {
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const cand of candidates) {
    const idx = lower.findIndex((h) => h.includes(cand.toLowerCase()));
    if (idx !== -1) return idx;
  }
  return -1;
}

// Exact header match (e.g. "Ends" must NOT match "Reporting ends").
function exactHeaderIndex(headers: string[], name: string): number {
  return headers.findIndex(
    (h) => h.trim().toLowerCase() === name.toLowerCase(),
  );
}

export function analyzeMetaCsv(text: string): AnalysisResult {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    throw new Error(
      'That file does not look like a Meta ads export — no data rows found.',
    );
  }

  const headers = rows[0]!;
  const col = {
    adName: headerIndex(headers, 'ad name'),
    adSet: headerIndex(headers, 'ad set name'),
    spend: headerIndex(headers, 'amount spent'),
    impressions: headerIndex(headers, 'impressions'),
    reach: headerIndex(headers, 'reach'),
    frequency: headerIndex(headers, 'frequency'),
    cpm: headerIndex(headers, 'cpm'),
    purchases: headerIndex(headers, 'purchases'),
    roas: headerIndex(headers, 'purchase roas', 'roas'),
    results: headerIndex(headers, 'results'),
    resultIndicator: headerIndex(headers, 'result indicator'),
    quality: headerIndex(headers, 'quality ranking'),
    start: headerIndex(headers, 'reporting starts'),
    end: headerIndex(headers, 'reporting ends'),
    ends: exactHeaderIndex(headers, 'ends'), // event/ad end date column
    adSetBudget: headerIndex(headers, 'ad set budget'), // "Using campaign budget" => CBO
  };

  if (col.spend === -1 || col.roas === -1) {
    throw new Error(
      'Could not find the expected columns (Amount spent / Purchase ROAS). Is this a Meta ads export?',
    );
  }

  const ads: AdAnalysis[] = [];

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]!;
    const get = (i: number) => (i >= 0 ? (cells[i] ?? '') : '');

    const spend = num(get(col.spend));
    const purchases = num(get(col.purchases));
    const roas = num(get(col.roas));
    const frequency = num(get(col.frequency));
    const results = num(get(col.results));
    const revenue = spend * roas;
    const cpp = purchases > 0 ? spend / purchases : null;
    const quality = get(col.quality) || '-';

    const adSetBudgetRaw = get(col.adSetBudget);
    const budgetStructure: 'CBO' | 'ABO' = adSetBudgetRaw
      .toLowerCase()
      .includes('campaign')
      ? 'CBO'
      : 'ABO';

    // Optimization mode is AUTHORITATIVE — read it from the explicit "Result
    // indicator" event, NOT from the generic Results count. Meta exports don't
    // always carry it; when absent, default to Initiate Checkout (this account's
    // baseline) and mark it assumed so the UI can say so.
    const indicatorRaw = get(col.resultIndicator).toLowerCase();
    let optimizationMode: OptimizationMode;
    let optimizationModeAssumed = false;
    if (indicatorRaw.includes('purchase')) {
      optimizationMode = 'purchase';
    } else if (indicatorRaw.includes('initiate_checkout')) {
      optimizationMode = 'initiate_checkout';
    } else {
      optimizationMode = 'initiate_checkout';
      optimizationModeAssumed = true;
    }
    // Label the cost metric by the mode. costPerPurchase is always the true
    // purchase CPA (spend/purchases). costPerIC exists ONLY in IC mode, where the
    // Results column counts Initiate-Checkouts. In Purchase mode there is no IC
    // count, so costPerIC is null — never reuse spend/results as if it were IC.
    const costPerPurchase = cpp;
    const costPerIC =
      optimizationMode === 'initiate_checkout' && results > 0
        ? spend / results
        : null;

    const endsDate = get(col.ends);
    let daysUntilEnd: number | null = null;
    if (endsDate) {
      const d = new Date(endsDate);
      if (!Number.isNaN(d.getTime())) {
        daysUntilEnd = Math.ceil((d.getTime() - Date.now()) / 86400000);
      }
    }

    const flags: Flag[] = [];
    if (optimizationModeAssumed) {
      flags.push({
        level: 'warn',
        text: 'Optimization goal not in this export — assumed Initiate Checkout. Confirm in Ads Manager (matters once an ad set switches to Purchase).',
      });
    }
    if (frequency >= BENCHMARKS.frequencyCeiling) {
      flags.push({
        level: 'warn',
        text: `Frequency ${frequency.toFixed(2)} (≥ ${BENCHMARKS.frequencyCeiling}) — fatigue risk`,
      });
    }
    if (cpp !== null && cpp > BENCHMARKS.cppTarget) {
      flags.push({
        level: 'warn',
        text: `Cost/purchase $${cpp.toFixed(2)} (> $${BENCHMARKS.cppTarget} target)`,
      });
    }
    if (cpp !== null && cpp <= BENCHMARKS.cppTarget) {
      flags.push({
        level: 'good',
        text: `Cost/purchase $${cpp.toFixed(2)} (≤ $${BENCHMARKS.cppTarget})`,
      });
    }
    if (roas >= BENCHMARKS.roasStrong) {
      flags.push({ level: 'good', text: `ROAS ${roas.toFixed(1)}x (strong)` });
    } else if (roas > 0 && roas < BENCHMARKS.roasWeak) {
      flags.push({
        level: 'bad',
        text: `ROAS ${roas.toFixed(1)}x (below ${BENCHMARKS.roasWeak}x)`,
      });
    }
    if (quality.toLowerCase().includes('below')) {
      flags.push({ level: 'bad', text: `Quality ranking: ${quality}` });
    }

    // Budget advice must respect CBO (campaign-level) vs ABO (ad-set-level).
    const budgetVerb = (action: 'raise' | 'trim') =>
      budgetStructure === 'CBO'
        ? `${action} the CAMPAIGN budget (CBO — don't touch the ad set)`
        : `${action} this ad set's budget`;

    // Base recommendation (non-scale cases only). The SCALE/WINNER decision keys
    // on the weekly sales RATE (adSetWeeklyPurchases), which is not known until
    // the post-aggregation pass below — so it is applied there, not here.
    let recommendation = 'Holding steady — monitor.';
    if (frequency >= BENCHMARKS.frequencyCeiling && roas < BENCHMARKS.roasStrong) {
      recommendation = `Frequency ${frequency.toFixed(2)} with softening ROAS — refresh creative or cap frequency before fatigue spreads.`;
    } else if (frequency >= BENCHMARKS.frequencyCeiling) {
      recommendation = `Strong ROAS but frequency ${frequency.toFixed(2)} — queue a creative refresh to protect it.`;
    } else if (cpp !== null && cpp > BENCHMARKS.cppTarget) {
      recommendation = `Cost/purchase above target — tighten creative/audience or ${budgetVerb('trim')}.`;
    }

    // Time-to-end overrides everything: no point building new creative for an
    // event that's basically over.
    if (daysUntilEnd !== null && daysUntilEnd <= 3) {
      recommendation =
        daysUntilEnd <= 0
          ? `Event has ended (or ends today) — stop spend. Save these ${purchases} buyers as a first-party seed for the next lookalike.`
          : `Ends in ${daysUntilEnd} day(s) — no time for new creative. Push budget to whatever's converting best right now, ride it to the finish, and capture these buyers as a first-party seed.`;
      flags.unshift({
        level: 'warn',
        text: `Ends in ${daysUntilEnd <= 0 ? '~0' : daysUntilEnd} day(s)`,
      });
    }

    ads.push({
      adName: get(col.adName) || `Ad ${r}`,
      adSetName: get(col.adSet),
      spend,
      purchases,
      results,
      resultType: prettyResultType(get(col.resultIndicator)),
      optimizationMode,
      optimizationModeAssumed,
      costPerIC,
      costPerPurchase,
      roas,
      revenue,
      cpp,
      frequency,
      reach: num(get(col.reach)),
      impressions: num(get(col.impressions)),
      cpm: num(get(col.cpm)),
      qualityRanking: quality,
      endsDate,
      daysUntilEnd,
      adSetWeeklyPurchases: 0,
      icSwitchQualifies: false,
      budgetStructure,
      flags,
      recommendation,
    });
  }

  // sort by spend desc for display
  ads.sort((a, b) => b.spend - a.spend);

  const totalSpend = ads.reduce((s, a) => s + a.spend, 0);
  const totalRevenue = ads.reduce((s, a) => s + a.revenue, 0);
  const totalPurchases = ads.reduce((s, a) => s + a.purchases, 0);
  const blendedRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const blendedCpp = totalPurchases > 0 ? totalSpend / totalPurchases : null;

  const reportStart = ads.length ? (rows[1]?.[col.start] ?? '') : '';
  const reportEnd = ads.length ? (rows[1]?.[col.end] ?? '') : '';
  let periodDays = 1;
  if (reportStart && reportEnd) {
    const ds = new Date(reportStart);
    const de = new Date(reportEnd);
    if (!Number.isNaN(ds.getTime()) && !Number.isNaN(de.getTime())) {
      periodDays = Math.max(1, Math.round((de.getTime() - ds.getTime()) / 86400000) + 1);
    }
  }

  // Initiate-Checkout vs Purchase: a Purchase switch is justified ONLY for an
  // ad set that individually clears ~50 purchases per 7-day window. Aggregate by
  // ad set (NEVER account-wide) and compute the per-week pace.
  const adSetPurchases = new Map<string, number>();
  for (const a of ads) {
    adSetPurchases.set(
      a.adSetName,
      (adSetPurchases.get(a.adSetName) ?? 0) + a.purchases,
    );
  }
  const weeksInPeriod = periodDays / 7;
  for (const a of ads) {
    const setTotal = adSetPurchases.get(a.adSetName) ?? a.purchases;
    a.adSetWeeklyPurchases =
      weeksInPeriod > 0 ? setTotal / weeksInPeriod : setTotal;
    a.icSwitchQualifies =
      a.adSetWeeklyPurchases >= PURCHASE_SWITCH_WEEKLY_THRESHOLD;

    // Scale-confidence gate (INTERIM): only trust "scale/winner" advice when this
    // ad set delivers >=50 sales/week. Below that, ROAS is noise — keep funded,
    // don't scale. The time-to-end override (<=3 days) still wins over this.
    const meetsScaleConfidence =
      a.adSetWeeklyPurchases >= BENCHMARKS.scaleConfidenceWeeklyThreshold;
    const imminentEnd = a.daysUntilEnd !== null && a.daysUntilEnd <= 3;
    if (
      !imminentEnd &&
      a.roas >= BENCHMARKS.roasStrong &&
      a.frequency < BENCHMARKS.frequencyCeiling
    ) {
      const verb =
        a.budgetStructure === 'CBO'
          ? 'raise the CAMPAIGN budget (CBO — do not set an ad-set budget)'
          : "raise this ad set's budget";
      if (meetsScaleConfidence && a.spend < BENCHMARKS.scaleSpendCeiling) {
        a.recommendation = `Proven at volume (${a.adSetWeeklyPurchases.toFixed(0)} sales/wk, ROAS ${a.roas.toFixed(1)}x on $${a.spend.toFixed(0)}) — ${verb} in small steps (≤~30% so you don't reset learning).`;
      } else if (meetsScaleConfidence) {
        a.recommendation = `Proven at volume (${a.adSetWeeklyPurchases.toFixed(0)} sales/wk, ROAS ${a.roas.toFixed(1)}x) — keep funded; consider a fresh 1% lookalike off this seed (expect a brief learning reset).`;
      } else {
        a.recommendation = `High ROAS (${a.roas.toFixed(1)}x) but only ~${a.adSetWeeklyPurchases.toFixed(0)} sales/wk (under ${BENCHMARKS.scaleConfidenceWeeklyThreshold}/wk) — too few to trust. Promising, not proven. Keep funded, stay on Initiate Checkout, do not scale yet.`;
      }
    }

    // Long-runway underpacing: budget spread so thin over a long flight that the
    // ad set can't gather enough events to exit Meta's learning phase.
    const learningLimited =
      a.adSetWeeklyPurchases < PURCHASE_SWITCH_WEEKLY_THRESHOLD;
    if (learningLimited && a.daysUntilEnd !== null && a.daysUntilEnd > 21) {
      a.flags.unshift({
        level: 'warn',
        text: `~${a.adSetWeeklyPurchases.toFixed(0)} conv/wk over a ${a.daysUntilEnd}-day runway — likely stuck in learning. Concentrate budget toward the event window; don't run flat.`,
      });
      a.recommendation += ` Likely learning-limited: ~${a.adSetWeeklyPurchases.toFixed(0)} conv/wk across ${a.daysUntilEnd} days — concentrate budget toward the event window rather than spreading it flat.`;
    }
  }

  const summary: AccountSummary = {
    totalSpend,
    totalRevenue,
    totalPurchases,
    blendedRoas,
    blendedCpp,
    adCount: ads.length,
    reportStart,
    reportEnd,
    periodDays,
  };

  // Account-level highlights
  const highlights: string[] = [];
  const byRoas = [...ads].sort((a, b) => b.roas - a.roas);
  const topRoas = byRoas[0];
  if (topRoas) {
    highlights.push(
      `Top ROAS: "${topRoas.adName}" at ${topRoas.roas.toFixed(1)}x` +
        (topRoas.spend < BENCHMARKS.scaleSpendCeiling
          ? ` — but only $${topRoas.spend.toFixed(0)} spent. Scale candidate.`
          : '.'),
    );
  }
  const fatigued = ads.filter((a) => a.frequency >= BENCHMARKS.frequencyCeiling);
  if (fatigued.length) {
    highlights.push(
      `${fatigued.length} ad(s) over frequency ${BENCHMARKS.frequencyCeiling} (${fatigued
        .map((a) => `"${a.adName}"`)
        .join(', ')}) — watch for fatigue.`,
    );
  }
  const scalers = ads.filter(
    (a) =>
      a.roas >= BENCHMARKS.roasStrong &&
      a.spend < BENCHMARKS.scaleSpendCeiling &&
      a.frequency < BENCHMARKS.frequencyCeiling,
  );
  if (scalers.length) {
    highlights.push(
      `${scalers.length} underfunded winner(s) ready to scale: ${scalers
        .map((a) => `"${a.adName}" (${a.roas.toFixed(1)}x)`)
        .join(', ')}.`,
    );
  }
  if (blendedCpp !== null) {
    highlights.push(
      `Blended ROAS ${blendedRoas.toFixed(2)}x and cost/purchase $${blendedCpp.toFixed(2)} ` +
        (blendedCpp <= BENCHMARKS.cppTarget
          ? `(under the $${BENCHMARKS.cppTarget} target ✓).`
          : `(above the $${BENCHMARKS.cppTarget} target).`),
    );
  }

  // Audience overlap: multiple ad sets on the same first-party seed compete
  // against each other (self-cannibalization).
  for (const token of ['seetickets', 'hive', 'lookalike']) {
    const sets = [
      ...new Set(
        ads
          .filter((a) => a.adSetName.toLowerCase().includes(token))
          .map((a) => a.adSetName),
      ),
    ];
    if (sets.length >= 2) {
      highlights.push(
        `Possible audience overlap: ${sets.length} ad sets target the "${token}" seed (${sets.map((s) => `"${s}"`).join(', ')}) — they may compete against each other. Consider consolidating or adding exclusions.`,
      );
    }
  }

  return { summary, ads, highlights };
}
