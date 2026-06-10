import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FB_PER_HEAD,
  type ShowInputs,
  analyzeShow,
  blendTicketPricing,
} from './offer-engine';

/*
 * F&B planning default is a sourced MARGIN figure (Spec A1):
 *   $25 avg check (Bart, 2025 Toast) × 71% weighted gross margin = $17.75/head.
 * A fresh run with no F&B override must budget off $17.75, not the old sales-
 * shaped $32. It enters TMAV straight as a per-attendee margin dollar amount.
 */
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

describe('F&B planning default — sourced $17.75 margin/head', () => {
  it('DEFAULT_FB_PER_HEAD is 17.75', () => {
    expect(DEFAULT_FB_PER_HEAD).toBe(17.75);
  });

  it('a fresh run with no F&B override uses $17.75 in TMAV (not $32)', () => {
    const inputs: ShowInputs = {
      venue_capacity: 1000,
      avg_ticket_price: 25,
      offer_structure: 'straight_guarantee',
      guarantee: 5000,
      fixed_show_expenses: 1000,
      conservative_attendance: 400,
      target_attendance: 700,
      sellout_attendance: 1000,
      days_remaining: 45,
      // no f_and_b_contribution_per_head -> falls back to the default
    };

    const r = analyzeShow(inputs);

    // Added straight in as a margin dollar amount: TMAV = TMV(25) + F&B(17.75).
    expect(r.fb_per_head).toBe(17.75);
    expect(r.tmav).toBeCloseTo(25 + 17.75, 10); // 42.75
    expect(r.tmav).not.toBeCloseTo(25 + 32, 10); // the old $57 is gone
    // CPA guardrails recompute off the lower TMAV.
    expect(r.cpa_guardrails.early).toBeCloseTo(0.6 * r.tmav, 10);
    expect(r.cpa_guardrails.ceiling).toBeCloseTo(r.tmav, 10);
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
