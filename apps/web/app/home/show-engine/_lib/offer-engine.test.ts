import { describe, expect, it } from 'vitest';

import {
  type ShowInputs,
  analyzeShow,
  blendTicketPricing,
} from './offer-engine';

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
