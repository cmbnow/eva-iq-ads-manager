/**
 * Show Profitability Engine — pure calculation core (UI-agnostic).
 * Implements offer-engine-spec.md §4–§9, §15–§21.
 * Internal math stays decimal; round only for display.
 */

export type OfferStructure =
  | 'straight_guarantee'
  | 'backend'
  | 'hybrid'
  | 'bonus_escalator';

export interface BonusTier {
  from_attendance: number;
  to_attendance: number;
  bonus_paid: number;
}

export interface ShowInputs {
  venue_capacity: number;
  avg_ticket_price: number;
  offer_structure: OfferStructure;
  guarantee?: number;
  backend_promoter_share?: number; // e.g. 0.80
  backend_artist_share?: number; // e.g. 0.20
  fixed_show_expenses: number;
  bonus_tiers?: BonusTier[];
  conservative_attendance: number;
  target_attendance: number;
  sellout_attendance: number;
  baseline_attendance?: number;
  days_remaining: number;
  f_and_b_contribution_per_head?: number;
  net_fee_per_head?: number; // venue-kept booking fee net of processor — rides into TMAV, NOT avg_ticket_price
  historical_cpa?: number;
  // SOURCE OF TRUTH for the blend: the full per-tier ticket structure and the
  // processor globals used. avg_ticket_price / net_fee_per_head above are the
  // computed result; these reproduce them exactly on reload. (TicketTier /
  // TicketPricingGlobals are declared below — TS hoists type references.)
  ticket_tiers?: TicketTier[];
  ticket_pricing_globals?: TicketPricingGlobals;
}

export interface BudgetTier {
  name: string;
  cpa_assumption: number;
  total_budget: number;
  daily_budget: number;
  purchase_budget: number;
  support_budget: number;
}

export interface ScenarioResult {
  attendance: number;
  ticket_revenue: number;
  f_and_b_contribution: number;
  total_revenue: number;
  artist_cost: number;
  fixed_show_expenses: number;
  marketing_budget: number;
  total_cost: number;
  net_profit: number;
}

export interface AnalysisResult {
  tmv: number;
  tmav: number;
  fb_per_head: number;
  net_fee_per_head: number;
  cpa_guardrails: { early: number; mid: number; late: number; ceiling: number };
  incremental_attendees: number;
  mrmc: number;
  budget_tiers: BudgetTier[];
  scenarios: {
    conservative: ScenarioResult;
    target: ScenarioResult;
    sellout: ScenarioResult;
  };
  risk_flags: string[];
  deal_score: 'A' | 'B' | 'C' | 'D';
  executive_recommendation: string;
  // Campaign build plan (IC-first reconciliation flagged here)
  campaign_plan: {
    optimization_note: string;
    purchase_budget_share: number;
    support_budget_share: number;
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Forward PLANNING assumption for F&B gross-margin contribution per attendee.
 * Used only for budgeting a show BEFORE it happens. Post-event measurement must
 * use ACTUAL F&B from real sales — never substitute this assumption into a
 * profit verdict. Assumption for planning, actuals for measuring.
 */
export const DEFAULT_FB_PER_HEAD = 32;
const artistShare = (i: ShowInputs) =>
  i.backend_artist_share ??
  (i.backend_promoter_share != null ? 1 - i.backend_promoter_share : 0.2);
const promoterShare = (i: ShowInputs) =>
  i.backend_promoter_share ??
  (i.backend_artist_share != null ? 1 - i.backend_artist_share : 0.8);

/** Bonus paid to the artist at a given attendance (additive per tier crossed). */
function bonusAtAttendance(attendance: number, tiers: BonusTier[]): number {
  return tiers
    .filter((t) => attendance > t.from_attendance)
    .reduce((sum, t) => sum + (t.bonus_paid ?? 0), 0);
}

function artistCost(attendance: number, i: ShowInputs): number {
  const ticketRevenue = attendance * i.avg_ticket_price;
  const guarantee = i.guarantee ?? 0;
  switch (i.offer_structure) {
    case 'straight_guarantee':
      return guarantee;
    case 'backend':
    case 'hybrid': {
      const splitPoint = guarantee + i.fixed_show_expenses;
      const above = Math.max(0, ticketRevenue - splitPoint);
      return guarantee + above * artistShare(i);
    }
    case 'bonus_escalator':
      return guarantee + bonusAtAttendance(attendance, i.bonus_tiers ?? []);
    default:
      return guarantee;
  }
}

/** Per-tier marginal ticket value for bonus/escalator deals (§5.4). */
export function tierTMVs(
  i: ShowInputs,
): { tier: BonusTier; tier_TMV: number }[] {
  // Ignore degenerate zero-width tiers (e.g. a parsed "1000–1000" row).
  const tiers = (i.bonus_tiers ?? []).filter(
    (t) => t.to_attendance > t.from_attendance,
  );
  return tiers.map((t) => {
    const size = Math.max(1, t.to_attendance - t.from_attendance);
    const revenue = size * i.avg_ticket_price;
    return { tier: t, tier_TMV: (revenue - (t.bonus_paid ?? 0)) / size };
  });
}

export function calculateTMV(i: ShowInputs): number {
  const fb = i.f_and_b_contribution_per_head ?? DEFAULT_FB_PER_HEAD;
  switch (i.offer_structure) {
    case 'straight_guarantee':
      return i.avg_ticket_price;
    case 'backend':
      return i.avg_ticket_price * promoterShare(i);
    case 'hybrid': {
      // Weighted across the incremental tickets, pre- vs post-split.
      const lower = i.baseline_attendance ?? i.conservative_attendance;
      const totalIncr = Math.max(0, i.target_attendance - lower);
      if (totalIncr === 0) return i.avg_ticket_price;
      const splitTickets =
        ((i.guarantee ?? 0) + i.fixed_show_expenses) / i.avg_ticket_price;
      const preTickets = Math.max(0, Math.min(i.target_attendance, splitTickets) - lower);
      const postTickets = Math.max(0, totalIncr - preTickets);
      const tmvPre = i.avg_ticket_price;
      const tmvPost = i.avg_ticket_price * promoterShare(i);
      return (preTickets * tmvPre + postTickets * tmvPost) / totalIncr;
    }
    case 'bonus_escalator': {
      const tts = tierTMVs(i);
      const target = i.target_attendance;
      let weighted = 0;
      let totalAnalyzed = 0;
      for (const { tier, tier_TMV } of tts) {
        if (target <= tier.from_attendance) continue;
        const reached = Math.min(target, tier.to_attendance) - tier.from_attendance;
        if (reached <= 0) continue;
        weighted += reached * tier_TMV;
        totalAnalyzed += reached;
      }
      // Any attendance below the first tier earns full ticket value.
      const firstFrom = tts.length ? tts[0]!.tier.from_attendance : 0;
      if (firstFrom > 0 && target > 0) {
        const baseReached = Math.min(target, firstFrom);
        weighted += baseReached * fb * 0 + baseReached * i.avg_ticket_price;
        totalAnalyzed += baseReached;
      }
      return totalAnalyzed > 0 ? weighted / totalAnalyzed : i.avg_ticket_price;
    }
    default:
      return i.avg_ticket_price;
  }
}

function modelScenario(
  attendance: number,
  i: ShowInputs,
  marketingBudget: number,
): ScenarioResult {
  const fb = i.f_and_b_contribution_per_head ?? DEFAULT_FB_PER_HEAD;
  const netFee = i.net_fee_per_head ?? 0;
  const ticket_revenue = attendance * i.avg_ticket_price;
  const f_and_b_contribution = attendance * fb;
  // Booking fee is real venue revenue, parallel to F&B. artistCost() below uses
  // avg_ticket_price (face only), so the artist never shares the fee.
  const fee_revenue = attendance * netFee;
  const total_revenue = ticket_revenue + f_and_b_contribution + fee_revenue;
  const cost = artistCost(attendance, i);
  const total_cost = cost + i.fixed_show_expenses + marketingBudget;
  return {
    attendance,
    ticket_revenue,
    f_and_b_contribution,
    total_revenue,
    artist_cost: cost,
    fixed_show_expenses: i.fixed_show_expenses,
    marketing_budget: marketingBudget,
    total_cost,
    net_profit: total_revenue - total_cost,
  };
}

function detectRiskFlags(i: ShowInputs, tmv: number, tmav: number): string[] {
  const flags: string[] = [];
  const fb = i.f_and_b_contribution_per_head ?? DEFAULT_FB_PER_HEAD;

  if (i.offer_structure === 'bonus_escalator') {
    for (const { tier, tier_TMV } of tierTMVs(i)) {
      if (tier_TMV < 5)
        flags.push(
          `Bonus cliff: tier ${tier.from_attendance}–${tier.to_attendance} has marginal ticket value of only $${round2(tier_TMV)}.`,
        );
    }
  }
  if (tmv < fb)
    flags.push(
      `F&B dependency: marginal ticket value ($${round2(tmv)}) is below F&B/head ($${fb}) — profit leans on food & beverage.`,
    );
  if (i.offer_structure === 'backend' || i.offer_structure === 'hybrid') {
    const splitPoint = (i.guarantee ?? 0) + i.fixed_show_expenses;
    const expectedTicketRev = i.target_attendance * i.avg_ticket_price;
    if (splitPoint > expectedTicketRev * 0.9)
      flags.push(
        `Backend risk: split point ($${Math.round(splitPoint)}) is high vs expected ticket revenue ($${Math.round(expectedTicketRev)}).`,
      );
  }
  if (i.historical_cpa != null && i.historical_cpa >= tmav)
    flags.push(
      `Marketing ceiling: historical CPA ($${round2(i.historical_cpa)}) is at/above TMAV ($${round2(tmav)}) — paid acquisition is unprofitable at past efficiency.`,
    );
  if (i.target_attendance > i.conservative_attendance * 2)
    flags.push(
      `Attendance risk: target (${i.target_attendance}) is more than double the conservative case (${i.conservative_attendance}).`,
    );
  if (!i.fixed_show_expenses || i.fixed_show_expenses === 0)
    flags.push('Expense uncertainty: fixed show expenses defaulted to $0 — model is incomplete.');

  return flags;
}

function calculateDealScore(
  i: ShowInputs,
  tmv: number,
  tmav: number,
  flags: string[],
  conservative: ScenarioResult,
  target: ScenarioResult,
  sellout: ScenarioResult,
): 'A' | 'B' | 'C' | 'D' {
  const fb = i.f_and_b_contribution_per_head ?? DEFAULT_FB_PER_HEAD;
  const fbDependent = tmv < fb;
  const bonusCliff = flags.some((f) => f.startsWith('Bonus cliff'));
  const profitConservative = conservative.net_profit >= 0;
  const profitTarget = target.net_profit >= 0;
  const profitSellout = sellout.net_profit >= 0;
  const cpaRoom =
    i.historical_cpa == null || i.historical_cpa <= 0.75 * tmav;

  if (profitConservative && profitTarget && !fbDependent && !bonusCliff && cpaRoom)
    return 'A';
  if (profitTarget && !fbDependent && !bonusCliff)
    return 'B';
  if (profitTarget || profitSellout)
    return 'C';
  return 'D';
}

function buildExecutiveRecommendation(
  score: 'A' | 'B' | 'C' | 'D',
  i: ShowInputs,
  tmav: number,
  tiers: BudgetTier[],
): string {
  const t1 = Math.round(tiers[0]!.total_budget);
  const t2 = Math.round(tiers[1]!.total_budget);
  const t3 = Math.round(tiers[2]!.total_budget);

  if (i.historical_cpa != null && i.historical_cpa >= tmav)
    return `Historical CPA ($${round2(i.historical_cpa)}) is at/above TMAV ($${round2(tmav)}). Do NOT scale paid spend at past efficiency — fix tracking/creative first or pass.`;

  switch (score) {
    case 'A':
      return `Strong economics. Scale with the Aggressive ($${t1}) or Core ($${t2}) tier. Healthy CPA room — push budget while cost/purchase stays under the early target.`;
    case 'B':
      return `Good deal, manageable risk. Run the Core plan ($${t2}). Hold budget once CPA reaches the mid target; only scale if it stays in the healthy zone.`;
    case 'C':
      return `Thin but workable. Use the Defense tier ($${t3}) and watch CPA tightly — pause if it approaches the ceiling ($${round2(tmav)}).`;
    case 'D':
    default:
      return `Poor/dangerous economics. Renegotiate the offer or pass unless there's strategic value worth a planned loss. Do not deploy aggressive paid spend.`;
  }
}

export function analyzeShow(inputs: ShowInputs): AnalysisResult {
  const fb = inputs.f_and_b_contribution_per_head ?? DEFAULT_FB_PER_HEAD;
  const netFee = inputs.net_fee_per_head ?? 0;
  const tmv = calculateTMV(inputs);
  const tmav = tmv + fb + netFee; // booking fee adds to TMAV, parallel to F&B

  const conservative = modelScenario(inputs.conservative_attendance, inputs, 0);
  const target = modelScenario(inputs.target_attendance, inputs, 0);
  const sellout = modelScenario(inputs.sellout_attendance, inputs, 0);

  let incremental_attendees =
    inputs.baseline_attendance != null
      ? inputs.target_attendance - inputs.baseline_attendance
      : inputs.target_attendance - inputs.conservative_attendance;
  if (incremental_attendees < 0) incremental_attendees = 0;

  const mrmc = incremental_attendees * tmav;
  const days = Math.max(1, inputs.days_remaining);

  const budget_tiers: BudgetTier[] = (
    [
      ['Aggressive Scale', 0.6],
      ['Core Plan', 0.75],
      ['Defense / Margin Protection', 0.9],
    ] as [string, number][]
  ).map(([name, rate]) => {
    const cpa = rate * tmav;
    const total = Math.min(mrmc, incremental_attendees * cpa);
    return {
      name,
      cpa_assumption: cpa,
      total_budget: total,
      daily_budget: total / days,
      purchase_budget: total * 0.8,
      support_budget: total * 0.2,
    };
  });

  const risk_flags = detectRiskFlags(inputs, tmv, tmav);
  const deal_score = calculateDealScore(
    inputs,
    tmv,
    tmav,
    risk_flags,
    conservative,
    target,
    sellout,
  );

  return {
    tmv,
    tmav,
    fb_per_head: fb,
    net_fee_per_head: netFee,
    cpa_guardrails: {
      early: 0.6 * tmav,
      mid: 0.75 * tmav,
      late: 0.9 * tmav,
      ceiling: tmav,
    },
    incremental_attendees,
    mrmc,
    budget_tiers,
    scenarios: { conservative, target, sellout },
    risk_flags,
    deal_score,
    executive_recommendation: buildExecutiveRecommendation(
      deal_score,
      inputs,
      tmav,
      budget_tiers,
    ),
    campaign_plan: {
      // IC-FIRST RECONCILIATION (overrides offer-spec §10/§13 "Purchase").
      optimization_note:
        'Optimize on INITIATE CHECKOUT first (single-show campaigns rarely reach Purchase volume). Switch an ad set to Purchase optimization only once it individually paces ~50 purchases per 7-day window. Lookalikes off first-party seeds remain valid; the 100-purchase lookalike threshold from the offer spec does not gate single shows.',
      purchase_budget_share: 0.8,
      support_budget_share: 0.2,
    },
  };
}

/* ===========================================================================
 * Ticket tier pricing + booking-fee handling (ticket-tier-input-spec).
 * FACE price -> avg_ticket_price (feeds the artist deal). Booking fee (net of
 * processor) -> net_fee_per_head, which rides into TMAV like F&B. The fee is
 * ALWAYS the venue's — never shared with the artist or promoter.
 * ======================================================================== */

export interface TicketTier {
  name: string;
  face_price: number;
  fee: number;
  fee_recipient: 'venue' | 'pass_through'; // fee is ALWAYS the venue's — never the artist's
  capacity: number;
  expected_mix_pct?: number; // 0..1
}

export interface TicketPricingGlobals {
  processor_pct?: number; // default 0.029
  processor_flat?: number; // default 0.30
  avg_tickets_per_order?: number; // default 1
}

export interface BlendedPricing {
  avg_ticket_price: number; // FACE only, capacity/mix-weighted -> feeds artist deal
  net_fee_per_head: number; // venue-kept fee net of processor, weighted -> adds to TMAV
  per_tier: {
    name: string;
    face_price: number;
    fee: number;
    processor_cost: number;
    venue_net_fee: number; // what the venue actually keeps from the fee (can be negative)
    weight: number; // share used in the blend
  }[];
  warnings: string[];
}

export function blendTicketPricing(
  tiers: TicketTier[],
  g: TicketPricingGlobals = {},
): BlendedPricing {
  const pct = g.processor_pct ?? 0.029;
  const flat = g.processor_flat ?? 0.3;
  const basket = Math.max(1, g.avg_tickets_per_order ?? 1);
  const warnings: string[] = [];

  if (tiers.length === 0) {
    return { avg_ticket_price: 0, net_fee_per_head: 0, per_tier: [], warnings };
  }

  // weights: explicit mix if given, else by capacity
  const haveMix = tiers.every((t) => t.expected_mix_pct != null);
  const capTotal = tiers.reduce((s, t) => s + Math.max(0, t.capacity), 0);
  const rawWeights = tiers.map((t) =>
    haveMix
      ? (t.expected_mix_pct as number)
      : capTotal > 0
        ? Math.max(0, t.capacity) / capTotal
        : 1 / tiers.length,
  );
  const wSum = rawWeights.reduce((s, w) => s + w, 0) || 1;
  const weights = rawWeights.map((w) => w / wSum);

  const per_tier = tiers.map((t, i) => {
    const gross = t.face_price + t.fee;
    const processor_cost = pct * gross + flat / basket;
    // The fee is always the venue's. 'venue' = keep remainder after the processor.
    // 'pass_through' = the fee only offsets processing, so the venue keeps ~0.
    // The artist NEVER receives any of the fee under either option.
    let venue_net_fee = 0;
    if (t.fee_recipient === 'venue') venue_net_fee = t.fee - processor_cost;
    else if (t.fee_recipient === 'pass_through') venue_net_fee = 0;

    if (t.fee_recipient === 'venue' && venue_net_fee < 0)
      warnings.push(
        `Tier "${t.name}": fee $${t.fee.toFixed(2)} does not cover the processor cost ($${processor_cost.toFixed(2)}) — you lose $${(-venue_net_fee).toFixed(2)}/ticket on the fee.`,
      );

    return {
      name: t.name,
      face_price: t.face_price,
      fee: t.fee,
      processor_cost,
      venue_net_fee,
      weight: weights[i]!,
    };
  });

  const avg_ticket_price = per_tier.reduce(
    (s, t) => s + t.face_price * t.weight,
    0,
  );
  const net_fee_per_head = per_tier.reduce(
    (s, t) => s + t.venue_net_fee * t.weight,
    0,
  );

  return { avg_ticket_price, net_fee_per_head, per_tier, warnings };
}
