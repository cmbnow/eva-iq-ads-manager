import { describe, expect, it } from 'vitest';

import {
  type ShowInputs,
  analyzeShow,
  marginalTmavAtTickets,
} from './offer-engine';
import { type ScalingDecision, decideScaling } from './scaling-advisor';

/*
 * Wire-into-scaling acceptance. The live decision must compare CPA against the
 * zone-aware marginal floor (marginalTmavAtTickets), not the flat planning
 * result.tmav — otherwise it cannot see the contribution step-down past recoup.
 *
 * Backend split = g(2000) + E(1120) + P(156) = 3276 -> ~96.6 tickets at $33.90,
 * artist share 0.70 (venue keep 0.30). No F&B/fee, so the floors are ticket-only:
 *   flat planning TMAV (band 50->200, straddles split)  ~= $17.54
 *   marginal past split (500 sold)                        = $33.90 x 0.30 = $10.17
 */
const backend: ShowInputs = {
  venue_capacity: 1000,
  avg_ticket_price: 33.9,
  offer_structure: 'backend',
  guarantee: 2000,
  promoter_profit: 156,
  backend_artist_share: 0.7,
  fixed_show_expenses: 1120,
  conservative_attendance: 50,
  target_attendance: 200,
  sellout_attendance: 1000,
  days_remaining: 45,
};

// Conservativeness order of the CPA zones (low = aggressive, high = danger).
const RANK: Record<ScalingDecision['zone'], number> = {
  aggressive: 0,
  scale: 1,
  hold: 2,
  late: 3,
  danger: 4,
  insufficient_data: -1,
};

const PLANNING_CAVEAT = 'planning-average TMAV';

describe('decideScaling — zone-aware floor drives a more conservative call', () => {
  const flatTmav = analyzeShow(backend).tmav; // ~17.54
  const zoneTmav = marginalTmavAtTickets(500, backend); // 10.17 (past split)
  const CPA = 12; // 68% of flat (scale) but 118% of the marginal floor (danger)

  it('past recoup, the marginal floor is lower than the flat planning TMAV', () => {
    expect(zoneTmav).toBeLessThan(flatTmav);
  });

  it('feeding the zone-aware value yields a MORE conservative zone on the same CPA', () => {
    const flat = decideScaling({
      tmav: flatTmav,
      optimizationMode: 'purchase',
      budgetStructure: 'ABO',
      liveCostPerPurchase: CPA,
    });
    const zone = decideScaling({
      tmav: zoneTmav,
      optimizationMode: 'purchase',
      budgetStructure: 'ABO',
      liveCostPerPurchase: CPA,
      tmavIsZoneAware: true,
    });
    expect(RANK[zone.zone]).toBeGreaterThan(RANK[flat.zone]);
    expect(flat.zone).toBe('scale');
    expect(zone.zone).toBe('danger');
  });

  it('zone-aware decision names the right basis and carries no fallback caveat', () => {
    const zone = decideScaling({
      tmav: zoneTmav,
      optimizationMode: 'purchase',
      budgetStructure: 'ABO',
      liveCostPerPurchase: CPA,
      tmavIsZoneAware: true,
    });
    expect(zone.reason).toContain('marginal value at current sales');
    expect(zone.caveats.some((c) => c.includes(PLANNING_CAVEAT))).toBe(false);
  });
});

describe('decideScaling — fallback path (no live ticket count)', () => {
  const flatTmav = analyzeShow(backend).tmav;

  it('uses the flat TMAV and pushes the planning-average caveat', () => {
    const d = decideScaling({
      tmav: flatTmav,
      optimizationMode: 'purchase',
      budgetStructure: 'ABO',
      liveCostPerPurchase: 12,
      tmavIsZoneAware: false,
    });
    // flat value still drives the zone (68% -> scale), labelled honestly as TMAV
    expect(d.zone).toBe('scale');
    expect(d.reason).toContain('TMAV');
    expect(d.reason).not.toContain('marginal value at current sales');
    // and the caveat names exactly why the floor may be wrong
    expect(d.caveats.some((c) => c.includes(PLANNING_CAVEAT))).toBe(true);
  });
});
