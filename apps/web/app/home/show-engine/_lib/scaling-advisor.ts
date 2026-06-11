/**
 * Scaling bridge — connects the live account CPA (from analyze.ts) to the
 * forward TMAV/CPA guardrails (from offer-engine.ts) and returns the §11 action.
 * Handles the Initiate-Checkout state: when an account optimizes on IC (because
 * it lacks Purchase volume), there is NO true purchase CPA to compare to TMAV.
 * We estimate it from an IC→Purchase rate and label it as an estimate, or refuse
 * to give a TMAV-based scale call and govern by cost-per-IC instead.
 */

export type OptimizationMode = 'initiate_checkout' | 'purchase';

export interface ScalingDecision {
  zone: 'aggressive' | 'scale' | 'hold' | 'late' | 'danger' | 'insufficient_data';
  budgetChangePct: number | null; // null = no change / hold / danger
  action: string; // CBO/ABO-aware, exact move
  reason: string;
  caveats: string[];
}

// Frequency reconciliation (with analyze.ts which uses 3.0):
//   3.0 = WARNING  — analyze.ts flags it + advises a creative refresh.
//   3.5 = HARD STOP — here: block ANY budget increase until creative is refreshed.
export const FREQ_WARNING = 3.0;
export const FREQ_HARD_STOP = 3.5;

export function decideScaling(p: {
  tmav: number;
  optimizationMode: OptimizationMode;
  budgetStructure: 'CBO' | 'ABO';
  liveCostPerPurchase?: number | null;
  liveCostPerIC?: number | null;
  estimatedICtoPurchaseRate?: number | null; // e.g. 0.4
  frequency?: number | null;
  // True when `tmav` is the zone-aware marginal value at the show's current ticket
  // count (marginalTmavAtTickets). False/undefined = the flat planning-average TMAV.
  tmavIsZoneAware?: boolean;
}): ScalingDecision {
  const caveats: string[] = [];
  // Name the floor honestly in the reason strings + warn when it's the flat
  // planning average (no live ticket count), which can't see a recoup/bonus step.
  const floorLabel = p.tmavIsZoneAware
    ? 'marginal value at current sales'
    : 'contribution per attendee (planning avg)';
  if (p.tmavIsZoneAware === false)
    caveats.push(
      'Floor is the planning-average contribution per attendee, not the live zone value — no current ticket count was available, so a recoup/bonus-tier step-down may not be reflected. Connect/refresh TicketTailor sales for a true floor.',
    );
  if (
    p.frequency != null &&
    p.frequency >= FREQ_WARNING &&
    p.frequency < FREQ_HARD_STOP
  )
    caveats.push(
      `Frequency ${p.frequency.toFixed(1)} ≥ ${FREQ_WARNING} (warning) — fatigue building; plan a creative refresh.`,
    );

  // Resolve an effective PURCHASE cpa to compare against TMAV.
  let effectiveCPA: number | null = null;
  let estimated = false;
  if (p.optimizationMode === 'purchase' && p.liveCostPerPurchase != null) {
    effectiveCPA = p.liveCostPerPurchase;
  } else if (p.optimizationMode === 'initiate_checkout') {
    if (p.liveCostPerIC != null && p.estimatedICtoPurchaseRate) {
      effectiveCPA = p.liveCostPerIC / p.estimatedICtoPurchaseRate;
      estimated = true;
      caveats.push(
        `Purchase CPA is ESTIMATED ($${effectiveCPA.toFixed(2)}) = cost/IC $${p.liveCostPerIC.toFixed(2)} ÷ ${(p.estimatedICtoPurchaseRate * 100).toFixed(0)}% IC→purchase rate. Verify the rate from TicketTailor before trusting the scale call.`,
      );
    }
  }

  const budgetMove = (pct: string) =>
    p.budgetStructure === 'CBO'
      ? `Raise the CAMPAIGN budget by ${pct} (CBO — do not set an ad-set budget).`
      : `Raise this ad set's budget by ${pct}.`;

  let decision: ScalingDecision;

  if (effectiveCPA == null) {
    decision = {
      zone: 'insufficient_data',
      budgetChangePct: null,
      action:
        p.budgetStructure === 'CBO'
          ? 'Hold campaign budget. Govern by cost-per-IC trend, not contribution per attendee, until Purchase volume or an IC→purchase rate exists.'
          : "Hold this ad set's budget. Govern by cost-per-IC trend until Purchase data exists.",
      reason:
        'On Initiate-Checkout optimization with no purchase CPA and no IC→purchase rate, contribution-per-attendee guardrails cannot be applied — comparing cost-per-IC to attendee value is apples to oranges.',
      caveats,
    };
  } else {
    const ratio = effectiveCPA / p.tmav;
    const tag = estimated ? ' (estimated)' : '';
    if (ratio < 0.6)
      decision = {
        zone: 'aggressive',
        budgetChangePct: 27.5,
        action: budgetMove('25–30%'),
        reason: `CPA${tag} $${effectiveCPA.toFixed(2)} is ${(ratio * 100).toFixed(0)}% of ${floorLabel} ($${p.tmav.toFixed(2)}) — well under target.`,
        caveats,
      };
    else if (ratio < 0.75)
      decision = {
        zone: 'scale',
        budgetChangePct: 15,
        action: budgetMove('15%'),
        reason: `CPA${tag} $${effectiveCPA.toFixed(2)} is ${(ratio * 100).toFixed(0)}% of ${floorLabel} — healthy.`,
        caveats,
      };
    else if (ratio < 0.9)
      decision = {
        zone: 'hold',
        budgetChangePct: null,
        action: 'Hold budget. Optimize creative/audience; do not scale.',
        reason: `CPA${tag} $${effectiveCPA.toFixed(2)} is ${(ratio * 100).toFixed(0)}% of ${floorLabel} — mid zone.`,
        caveats,
      };
    else if (ratio < 1.0)
      decision = {
        zone: 'late',
        budgetChangePct: null,
        action: 'Hold tight, no scaling. Watch closely — approaching the ceiling.',
        reason: `CPA${tag} $${effectiveCPA.toFixed(2)} is ${(ratio * 100).toFixed(0)}% of ${floorLabel} — late zone.`,
        caveats,
      };
    else
      decision = {
        zone: 'danger',
        budgetChangePct: null,
        action: 'Reduce or pause spend. Each new attendee costs ≥ their marginal value.',
        reason: `CPA${tag} $${effectiveCPA.toFixed(2)} ≥ ${floorLabel} ($${p.tmav.toFixed(2)}) — unprofitable on the margin.`,
        caveats,
      };
  }

  // HARD STOP: frequency >= 3.5 blocks ANY budget increase, regardless of CPA.
  if (
    p.frequency != null &&
    p.frequency >= FREQ_HARD_STOP &&
    decision.budgetChangePct != null
  ) {
    return {
      zone: 'hold',
      budgetChangePct: null,
      action:
        p.budgetStructure === 'CBO'
          ? `Hold the CAMPAIGN budget. Frequency ${p.frequency.toFixed(1)} ≥ ${FREQ_HARD_STOP} (hard stop) — refresh creative / expand audience BEFORE adding budget, even though CPA looks scalable.`
          : `Hold this ad set's budget. Frequency ${p.frequency.toFixed(1)} ≥ ${FREQ_HARD_STOP} (hard stop) — refresh creative / expand audience before adding budget.`,
      reason: `${decision.reason} BUT frequency ${p.frequency.toFixed(1)} ≥ ${FREQ_HARD_STOP} — adding budget now just buys more impressions to a fatigued audience.`,
      caveats: decision.caveats,
    };
  }

  return decision;
}

/**
 * Render the engine's scaling decision as an AUTHORITATIVE prompt block for the
 * AI plan. The AI must REPORT and explain this decision — not re-derive its own
 * scaling verdict from the same numbers (that's how two parts of the tool drift
 * and contradict each other in front of the user). Engine decides; Claude
 * translates. Acceptance: the AI plan's scale/hold/danger stance must match this
 * zone and budget direction, never contradict it.
 */
export function scalingPromptBlock(s: {
  zone: string;
  action: string;
  reason: string;
  budgetChangePct: number | null;
  caveats: string[];
}): string {
  const direction =
    s.budgetChangePct == null
      ? 'DO NOT INCREASE the budget (hold, or reduce if danger).'
      : `Increase the budget by about ${s.budgetChangePct}% (gradually — never reset learning).`;
  return `ENGINE SCALING DECISION (AUTHORITATIVE — this is the single source of truth; report it, do NOT reach your own scaling conclusion):
- Zone: ${s.zone}
- Required action: ${s.action}
- Budget direction: ${direction}
- Why: ${s.reason}${
    s.caveats.length ? `\n- Caveats you must pass on: ${s.caveats.join(' ')}` : ''
  }
Your job is to TRANSLATE this into plain, warm language and concrete next steps for the owner. Your scale/hold/danger stance and your budget direction MUST match the zone and budget direction above. If your own instinct differs, defer to this engine decision and explain it — do not contradict it.`;
}
