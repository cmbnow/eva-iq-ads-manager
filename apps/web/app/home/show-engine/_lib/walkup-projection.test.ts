import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SALES_CURVE,
  type WalkupInput,
  fractionComplete,
  projectWalkup,
} from './walkup-projection';

/*
 * B1 walk-up projection — pure module. Projects final attendance from
 * tickets-sold-to-date and days-until-show against a back-loaded sales curve.
 * (Run under `node --experimental-strip-types` to confirm it's runner-agnostic.)
 */
const base: Omit<WalkupInput, 'tickets_sold' | 'days_remaining'> = {
  target_attendance: 350,
  sellout_attendance: 500,
};

describe('B1 walk-up projection', () => {
  it('half of target sold at 14 days out (curve 0.55) projects ~sold/0.55', () => {
    const r = projectWalkup({ ...base, tickets_sold: 175, days_remaining: 14 });
    expect(fractionComplete(14)).toBeCloseTo(0.55, 10);
    expect(r.fraction_complete).toBeCloseTo(0.55, 10);
    expect(r.projected_final).toBe(Math.round(175 / 0.55)); // 318
    expect(r.projected_final).toBeLessThanOrEqual(base.sellout_attendance);
  });

  it('caps the projection at sellout', () => {
    // 300 sold at 14 days -> 300/0.55 ≈ 545 -> capped to 500
    const r = projectWalkup({ ...base, tickets_sold: 300, days_remaining: 14 });
    expect(r.projected_final).toBe(500);
  });

  it('pace bands: on_track 95–105%, behind <95%, ahead >105%', () => {
    // days_remaining 0 -> fraction 1 -> projected_final = min(sold, sellout)
    const onTrack = projectWalkup({
      ...base,
      tickets_sold: 350,
      days_remaining: 0,
      sellout_attendance: 1000,
    });
    expect(onTrack.projected_final).toBe(350);
    expect(onTrack.pace_vs_target).toBe('on_track'); // 350/350 = 1.00

    const behind = projectWalkup({
      ...base,
      tickets_sold: 330,
      days_remaining: 0,
      sellout_attendance: 1000,
    });
    expect(behind.pace_vs_target).toBe('behind'); // 330/350 = 0.943

    const ahead = projectWalkup({
      ...base,
      tickets_sold: 380,
      days_remaining: 0,
      sellout_attendance: 1000,
    });
    expect(ahead.pace_vs_target).toBe('ahead'); // 380/350 = 1.086
  });

  it('too_early when days_remaining is beyond the max curve day', () => {
    const maxDay = Math.max(...DEFAULT_SALES_CURVE.map((p) => p.daysOut)); // 60
    const r = projectWalkup({
      ...base,
      tickets_sold: 20,
      days_remaining: maxDay + 5,
    });
    expect(r.too_early).toBe(true);
  });

  it('flags the default curve as estimated; not too_early inside the window', () => {
    const r = projectWalkup({ ...base, tickets_sold: 100, days_remaining: 21 });
    expect(r.curve_is_estimated).toBe(true);
    expect(r.too_early).toBe(false);
  });

  it('a provided curve is not flagged estimated', () => {
    const r = projectWalkup({
      ...base,
      tickets_sold: 100,
      days_remaining: 10,
      curve: DEFAULT_SALES_CURVE,
    });
    expect(r.curve_is_estimated).toBe(false);
  });

  it('fractionComplete interpolates linearly and clamps at the ends', () => {
    // between 14d (0.55) and 10d (0.68): at 12d -> 0.55 + 0.5*0.13 = 0.615
    expect(fractionComplete(12)).toBeCloseTo(0.615, 10);
    expect(fractionComplete(0)).toBe(1); // show day
    expect(fractionComplete(100)).toBeCloseTo(0.08, 10); // before the curve starts
  });
});
