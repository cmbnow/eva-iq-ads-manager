import { describe, expect, it } from 'vitest';

import { type AdAnalysis, analyzeMetaCsv } from './analyze';

/*
 * Optimization-mode guard for analyze.ts (fix #1). Locks the contract that a
 * Purchase-optimized ad set produces a real cost-per-purchase and NO cost-per-IC,
 * so the IC->purchase rate can never be applied on top of it (the double-divide
 * bug). analyze.ts is intentionally NOT refactored — these tests only fence it.
 *
 * Real Meta-export headers are used (the analyzer matches "Amount spent" and
 * "Purchase ROAS", not bare "Spend"/"ROAS").
 */

const HEADERS_FULL =
  'Ad name,Ad set name,Amount spent,Purchase ROAS,Results,Result indicator,Purchases,Frequency,Reporting starts,Reporting ends,Ad set budget';

// Same headers but WITHOUT the "Result indicator" column (omitted-indicator case).
const HEADERS_NO_INDICATOR =
  'Ad name,Ad set name,Amount spent,Purchase ROAS,Results,Purchases,Frequency,Reporting starts,Reporting ends,Ad set budget';

describe('analyzeMetaCsv — optimization mode + cost-metric labeling', () => {
  it('Purchase-optimized row: mode=purchase, costPerIC null, costPerPurchase = spend/purchases', () => {
    const csv = [
      HEADERS_FULL,
      // spend 120, results 12, purchases 12 → cpp = $10
      'BuyAd,PurchaseSet,120,5,12,actions:offsite_conversion.fb_pixel_purchase,12,2.0,2026-06-01,2026-06-07,Using ad set budget',
    ].join('\n');

    const ad = analyzeMetaCsv(csv).ads[0]!;

    expect(ad.optimizationMode).toBe('purchase');
    expect(ad.optimizationModeAssumed).toBe(false);
    // THE assertion that was missing: no IC path is reachable in purchase mode.
    expect(ad.costPerIC).toBeNull();
    expect(ad.costPerPurchase).toBe(120 / 12);
  });

  it('IC-optimized row: mode=initiate_checkout, costPerIC = spend/results, not assumed', () => {
    const csv = [
      HEADERS_FULL,
      // spend 100, results 20 → costPerIC = $5
      'CartAd,ICSet,100,4,20,actions:offsite_conversion.fb_pixel_initiate_checkout,5,2.0,2026-06-01,2026-06-07,Using ad set budget',
    ].join('\n');

    const ad = analyzeMetaCsv(csv).ads[0]!;

    expect(ad.optimizationMode).toBe('initiate_checkout');
    expect(ad.optimizationModeAssumed).toBe(false);
    expect(ad.costPerIC).toBe(100 / 20);
  });

  it('Omitted-indicator row: defaults to IC, marks assumed, emits the warning flag', () => {
    const csv = [
      HEADERS_NO_INDICATOR,
      'MysteryAd,UnknownSet,100,4,20,5,2.0,2026-06-01,2026-06-07,Using ad set budget',
    ].join('\n');

    const ad = analyzeMetaCsv(csv).ads[0]!;

    expect(ad.optimizationMode).toBe('initiate_checkout');
    expect(ad.optimizationModeAssumed).toBe(true);
    expect(
      ad.flags.some(
        (f) => f.level === 'warn' && /assumed Initiate Checkout/i.test(f.text),
      ),
    ).toBe(true);
  });

  it('Header-collision guard: "Results" and "Result indicator" map to distinct columns', () => {
    // Results (20) differs from Purchases (5); the indicator is text. If the
    // substring matcher collapsed the two headers, num() of the indicator text
    // would be 0 → costPerIC would be null instead of 5, and resultType wrong.
    const csv = [
      HEADERS_FULL,
      'CollideAd,CollideSet,100,4,20,actions:offsite_conversion.fb_pixel_initiate_checkout,5,2.0,2026-06-01,2026-06-07,Using ad set budget',
    ].join('\n');

    const ad = analyzeMetaCsv(csv).ads[0]!;

    expect(ad.results).toBe(20); // from the "Results" column, not the indicator
    expect(ad.purchases).toBe(5); // from "Purchases", not "Results"
    expect(ad.optimizationMode).toBe('initiate_checkout'); // from "Result indicator"
    expect(ad.resultType).toBe('Initiate Checkout');
    expect(ad.costPerIC).toBe(100 / 20); // proves results came from the right column
  });
});

/*
 * Client-level firewall (the actual double-divide guard, meta-advisor-client.tsx
 * ~lines 333-334). The selection is inline JSX there and not importable without a
 * refactor that is explicitly out of scope, so the rule is mirrored here verbatim
 * and asserted against real analyzer output. If the client ever passed an IC cost
 * in purchase mode (or a purchase cost in IC mode), this contract would break.
 */
function clientLiveInputs(ad: AdAnalysis): {
  liveCostPerPurchase: number | null;
  liveCostPerIC: number | null;
} {
  const optimizationMode =
    ad.optimizationMode ??
    (ad.resultType.toLowerCase().includes('purchase')
      ? 'purchase'
      : 'initiate_checkout');
  const costPerIC =
    ad.costPerIC ??
    (optimizationMode === 'initiate_checkout' && ad.results > 0
      ? ad.spend / ad.results
      : null);
  const costPerPurchase = ad.costPerPurchase ?? ad.cpp;
  return {
    liveCostPerPurchase:
      optimizationMode === 'purchase' ? costPerPurchase : null,
    liveCostPerIC: optimizationMode === 'initiate_checkout' ? costPerIC : null,
  };
}

describe('client firewall — modes never cross-feed the scaling advisor', () => {
  it('purchase mode never populates liveCostPerIC', () => {
    const ad = analyzeMetaCsv(
      [
        HEADERS_FULL,
        'BuyAd,PurchaseSet,120,5,12,actions:offsite_conversion.fb_pixel_purchase,12,2.0,2026-06-01,2026-06-07,Using ad set budget',
      ].join('\n'),
    ).ads[0]!;

    const live = clientLiveInputs(ad);
    expect(live.liveCostPerIC).toBeNull();
    expect(live.liveCostPerPurchase).toBe(120 / 12);
  });

  it('IC mode never populates liveCostPerPurchase', () => {
    const ad = analyzeMetaCsv(
      [
        HEADERS_FULL,
        'CartAd,ICSet,100,4,20,actions:offsite_conversion.fb_pixel_initiate_checkout,5,2.0,2026-06-01,2026-06-07,Using ad set budget',
      ].join('\n'),
    ).ads[0]!;

    const live = clientLiveInputs(ad);
    expect(live.liveCostPerPurchase).toBeNull();
    expect(live.liveCostPerIC).toBe(100 / 20);
  });
});
