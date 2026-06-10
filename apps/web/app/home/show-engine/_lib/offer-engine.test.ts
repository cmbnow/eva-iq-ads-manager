import { describe, expect, it } from 'vitest';

import {
  type BonusTier,
  type ShowInputs,
  analyzeShow,
  blendTicketPricing,
  bonusAtTickets,
  gigFixedExpenses,
} from './offer-engine';

/*
 * Opening cost is a per-show FIXED cost (doors/staff/sound/light). It is NOT
 * marginal, so it must stay entirely out of TMAV, the CPA guardrails, and the
 * budget tiers — it only rides through on the result for breakeven/P&L later.
 */
describe('Opening cost — stored, but out of the marginal math', () => {
  const base: ShowInputs = {
    venue_capacity: 1000,
    avg_ticket_price: 25,
    offer_structure: 'straight_guarantee',
    guarantee: 5000,
    fixed_show_expenses: 1000,
    conservative_attendance: 400,
    target_attendance: 700,
    sellout_attendance: 1000,
    days_remaining: 45,
    f_and_b_contribution_per_head: 12,
  };

  it('opening cost 0 vs 1806 gives identical TMAV, guardrails, and tiers', () => {
    const a = analyzeShow({ ...base, opening_cost: 0 });
    const b = analyzeShow({ ...base, opening_cost: 1806 });

    expect(b.tmav).toBe(a.tmav);
    expect(b.mrmc).toBe(a.mrmc);
    expect(b.cpa_guardrails).toEqual(a.cpa_guardrails);
    expect(b.budget_tiers).toEqual(a.budget_tiers);
    // The only difference is the echoed pass-through value.
    expect(a.opening_cost).toBe(0);
    expect(b.opening_cost).toBe(1806);
  });

  it('defaults opening_cost to 0 when unset and is independent of fixed_show_expenses', () => {
    const r = analyzeShow(base); // no opening_cost
    expect(r.opening_cost).toBe(0);
    // Changing fixed_show_expenses must not invent an opening_cost.
    const r2 = analyzeShow({ ...base, fixed_show_expenses: 9999 });
    expect(r2.opening_cost).toBe(0);
  });
});

/*
 * Breakeven attendance (read-only, pre-marketing). Two figures from existing
 * values: #1 F&B margin alone covers the open; #2 full pre-ad breakeven (TMAV
 * covers open + artist/production fixed). Round UP. Must not touch the marginal
 * math (tmav/guardrails/mrmc/tiers).
 */
describe('Breakeven attendance line', () => {
  const base: ShowInputs = {
    venue_capacity: 1000,
    avg_ticket_price: 25, // straight_guarantee -> tmv = 25
    offer_structure: 'straight_guarantee',
    guarantee: 5000,
    fixed_show_expenses: 1000, // gigFixed = 5000 + 1000 = 6000
    conservative_attendance: 400,
    target_attendance: 700,
    sellout_attendance: 1000,
    days_remaining: 45,
    f_and_b_contribution_per_head: 17.75, // tmav = 25 + 17.75 = 42.75
  };

  it('fb-only breakeven = ceil(openCost / fb) = 102 at $1806 / $17.75', () => {
    const r = analyzeShow({ ...base, opening_cost: 1806 });
    expect(r.breakeven_fb_only).toBe(102); // ceil(1806/17.75) = ceil(101.74)
    // full = ceil((1806 + 6000) / 42.75) = ceil(182.6) = 183
    expect(r.breakeven_full).toBe(183);
  });

  it('opening cost 0 -> fb-only 0, full = ceil(gigFixed / tmav), no divide-by-zero', () => {
    const r = analyzeShow({ ...base, opening_cost: 0 });
    expect(r.breakeven_fb_only).toBe(0);
    expect(r.breakeven_full).toBe(141); // ceil(6000/42.75) = ceil(140.35)
    expect(Number.isFinite(r.breakeven_full as number)).toBe(true);
  });

  it('null (not a crash) when F&B margin is 0', () => {
    const r = analyzeShow({
      ...base,
      opening_cost: 1806,
      f_and_b_contribution_per_head: 0,
    });
    expect(r.breakeven_fb_only).toBeNull();
  });

  it('is purely additive — marginal math (tmav/guardrails/mrmc/tiers) is unchanged', () => {
    // Pin the marginal outputs for a fixed input so a regression would trip.
    const noOpen = analyzeShow({ ...base, opening_cost: 0 });
    const withOpen = analyzeShow({ ...base, opening_cost: 1806 });

    expect(withOpen.tmav).toBe(noOpen.tmav);
    expect(withOpen.mrmc).toBe(noOpen.mrmc);
    expect(withOpen.cpa_guardrails).toEqual(noOpen.cpa_guardrails);
    expect(withOpen.budget_tiers).toEqual(noOpen.budget_tiers);
    // Only the breakeven readout moves with opening cost.
    expect(withOpen.breakeven_full).not.toBe(noOpen.breakeven_full);
  });
});

/*
 * A5: F&B contribution per head is sourced per-tenant (gross avg check × margin
 * rate), passed into the engine. There is NO fabricated default. When absent,
 * F&B is excluded (treated as 0) and flagged — never assumed.
 */
describe('A5 — F&B basis from config, no fabricated default', () => {
  const base: ShowInputs = {
    venue_capacity: 1000,
    avg_ticket_price: 25,
    offer_structure: 'straight_guarantee',
    guarantee: 5000,
    fixed_show_expenses: 1000,
    conservative_attendance: 400,
    target_attendance: 700,
    sellout_attendance: 1000,
    days_remaining: 45,
    f_and_b_contribution_per_head: 26, // caller derived check 40 × 0.65 = 26
  };

  it('present basis rides into TMAV as check × rate', () => {
    const r = analyzeShow({ ...base, f_and_b_contribution_per_head: 26 });
    expect(r.fb_basis_missing).toBe(false);
    expect(r.tmav).toBeCloseTo(base.avg_ticket_price + 26, 10); // 25 + 26 = 51
  });

  it('absent basis excludes F&B (=0) and flags it — no assumed number', () => {
    const noFb: ShowInputs = { ...base };
    delete noFb.f_and_b_contribution_per_head; // optional -> truly unset
    const r = analyzeShow(noFb);

    expect(r.fb_basis_missing).toBe(true);
    expect(r.fb_per_head).toBe(0);
    expect(r.scenarios.target.f_and_b_contribution).toBe(0);
    // Breakeven is tickets-only, NOT computed off any fabricated 17.75.
    expect(r.breakeven_fb_only).toBeNull();
    expect(r.tmav).toBeCloseTo(base.avg_ticket_price, 10); // ticket-only floor
  });
});

/*
 * Fee precision guard (cleanup batch). A $0-fee tier still incurs the processor
 * cost, so the venue's net fee per ticket is sub-dollar NEGATIVE. The UI used to
 * round it to a whole dollar ("net fee $-1"); the internal TMAV math must use the
 * FULL decimal (-1.025), never the rounded -1.
 */
describe('blendTicketPricing / analyzeShow — $0-fee tier net fee precision', () => {
  // GA tier, $0 booking fee, default processor globals (matches the UI defaults).
  const tiers = [
    {
      name: 'GA',
      face_price: 25,
      fee: 0,
      fee_recipient: 'venue' as const,
      capacity: 1000,
    },
  ];
  const globals = {
    processor_pct: 0.029,
    processor_flat: 0.3,
    avg_tickets_per_order: 1,
  };

  // processor_cost = 0.029*25 + 0.30/1 = 1.025  ->  net fee = 0 - 1.025 = -1.025
  const EXPECTED_NET_FEE = 0 - (0.029 * 25 + 0.3 / 1); // -1.025

  it('blends the FULL decimal net fee (-1.025), not a whole-dollar -1', () => {
    const blended = blendTicketPricing(tiers, globals);

    expect(blended.net_fee_per_head).toBeCloseTo(EXPECTED_NET_FEE, 10);
    expect(blended.net_fee_per_head).toBeCloseTo(-1.025, 10);

    // The rounding the OLD readout did would collapse this to -1 — prove we don't.
    expect(Math.round(blended.net_fee_per_head)).toBe(-1);
    expect(blended.net_fee_per_head).not.toBe(-1);
  });

  it('TMAV consumes the full decimal net fee (tmv + fb - 1.025), not -1', () => {
    const blended = blendTicketPricing(tiers, globals);

    const inputs: ShowInputs = {
      venue_capacity: 1000,
      avg_ticket_price: blended.avg_ticket_price, // 25 (face only)
      net_fee_per_head: blended.net_fee_per_head, // -1.025
      offer_structure: 'straight_guarantee',
      guarantee: 5000,
      fixed_show_expenses: 1000,
      conservative_attendance: 400,
      target_attendance: 700,
      sellout_attendance: 1000,
      days_remaining: 45,
      f_and_b_contribution_per_head: 12,
    };

    const r = analyzeShow(inputs);

    // Carried through unrounded.
    expect(r.net_fee_per_head).toBeCloseTo(-1.025, 10);
    // TMAV = TMV(25) + F&B(12) + netFee(-1.025) = 35.975 — the decimal, not 36.
    expect(r.tmav).toBeCloseTo(r.tmv + r.fb_per_head + EXPECTED_NET_FEE, 10);
    expect(r.tmav).toBeCloseTo(35.975, 10);
    // If the math had used the rounded -1 it would be 36 — confirm it does NOT.
    expect(r.tmav).not.toBeCloseTo(36, 5);
  });
});

/*
 * A3-revise — the gig model keyed to how the venue actually deals (Prism):
 * ticket-sold threshold bonuses (incremental / only-one) and itemized
 * planned/actual gig expenses. Validated against the real Fozzy settlement.
 */
describe('A3 — gig model: threshold bonuses + itemized expenses (Fozzy)', () => {
  const fozzy: ShowInputs = {
    venue_capacity: 1000,
    avg_ticket_price: 30,
    offer_structure: 'bonus_escalator',
    guarantee: 7000,
    bonus_mode: 'incremental',
    bonus_tiers: [500, 550, 600, 650, 700, 750, 800, 850].map((n) => ({
      at_tickets: n,
      bonus: 500,
    })),
    gig_expenses: [
      { label: 'Production Manager', planned: 250 },
      { label: 'Equipment Maintenance', planned: 90 },
      { label: 'LD', planned: 275 },
      { label: 'Catering', planned: 40 },
      { label: 'Security', planned: 750 },
      { label: 'Box Office Staff', planned: 100 },
      { label: 'Marketing', planned: 800 },
      { label: 'Hospitality', planned: 400 },
    ], // = 2705
    fixed_show_expenses: 0,
    conservative_attendance: 300,
    target_attendance: 600,
    sellout_attendance: 1000,
    days_remaining: 30,
  };

  it('reproduces the Prism settlement: 434 sold => gig cost 9705, gig profit $4,920', () => {
    expect(gigFixedExpenses(fozzy)).toBe(2705);
    // at 434 sold, lowest tier (500) not met -> bonus 0
    const bonus = bonusAtTickets(434, fozzy.bonus_tiers!, fozzy.bonus_mode);
    expect(bonus).toBe(0);
    const gigCost = (fozzy.guarantee ?? 0) + bonus + gigFixedExpenses(fozzy);
    expect(gigCost).toBe(9705); // 7000 + 0 + 2705
    const GIG_GROSS = 14625; // Prism settlement gross (artist-deal P&L only)
    expect(GIG_GROSS - gigCost).toBe(4920); // matches Prism exactly
  });

  it('incremental vs only_one at 600 sold', () => {
    // met thresholds: 500, 550, 600
    expect(bonusAtTickets(600, fozzy.bonus_tiers!, 'incremental')).toBe(1500);
    expect(bonusAtTickets(600, fozzy.bonus_tiers!, 'only_one')).toBe(500);
  });

  it('legacy from_attendance/bonus_paid tiers still read (normalized)', () => {
    const legacy: BonusTier[] = [
      {
        from_attendance: 500,
        to_attendance: 750,
        bonus_paid: 1000,
      } as BonusTier,
    ];
    expect(bonusAtTickets(600, legacy, 'incremental')).toBe(1000);
    expect(bonusAtTickets(400, legacy, 'incremental')).toBe(0);
  });

  it('artistCost (via analyzeShow) keys the bonus on tickets_sold, not scenario attendance', () => {
    const r = analyzeShow({ ...fozzy, tickets_sold: 434 });
    // target scenario attendance is 600, but tickets_sold 434 drives the bonus -> 0.
    expect(r.scenarios.target.artist_cost).toBe(7000); // guarantee + 0
    // itemized expenses flow into the scenario's fixed cost.
    expect(r.scenarios.target.fixed_show_expenses).toBe(2705);
  });
});
