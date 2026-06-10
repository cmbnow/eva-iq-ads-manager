/**
 * B1 Walk-up projection. Projects final attendance from tickets-sold-to-date
 * and days-until-show against a sales curve.
 *
 * v1 uses a DEFAULT back-loaded curve (live-music sales concentrate in the final
 * ~2 weeks). C2 will replace DEFAULT_SALES_CURVE with a per-tenant curve learned
 * from real ticket_tailor_orders.ordered_at history. The function signature does
 * not change when that happens — only the curve passed in.
 */

/** Cumulative fraction of final sales expected to be IN by `daysOut` before show. */
export interface SalesCurvePoint {
  daysOut: number;
  cumFraction: number;
}

/**
 * Default back-loaded curve. cumFraction = share of total sales already made by
 * that many days before the show. Monotonic; 0 daysOut = 1.0 (all in).
 * Defensible placeholder, NOT learned — flagged so the UI can say "estimated."
 */
export const DEFAULT_SALES_CURVE: SalesCurvePoint[] = [
  { daysOut: 60, cumFraction: 0.08 },
  { daysOut: 42, cumFraction: 0.15 },
  { daysOut: 28, cumFraction: 0.27 },
  { daysOut: 21, cumFraction: 0.38 },
  { daysOut: 14, cumFraction: 0.55 },
  { daysOut: 10, cumFraction: 0.68 },
  { daysOut: 7, cumFraction: 0.8 },
  { daysOut: 3, cumFraction: 0.92 },
  { daysOut: 1, cumFraction: 0.98 },
  { daysOut: 0, cumFraction: 1.0 },
];

export interface WalkupInput {
  tickets_sold: number; // total_issued to date
  days_remaining: number; // days until show
  target_attendance: number; // the goal (from the show)
  sellout_attendance: number; // cap
  curve?: SalesCurvePoint[]; // omit -> DEFAULT_SALES_CURVE
}

export interface WalkupResult {
  projected_final: number; // projected attendance at show time
  fraction_complete: number; // share of sales expected in by now
  pace_vs_target: 'ahead' | 'on_track' | 'behind' | 'unknown';
  curve_is_estimated: boolean; // true while using DEFAULT (not learned)
  too_early: boolean; // > max curve day -> projection unreliable
}

/** Linear-interpolate cumFraction at a given daysOut against the curve. */
export function fractionComplete(
  daysOut: number,
  curve = DEFAULT_SALES_CURVE,
): number {
  const pts = [...curve].sort((a, b) => b.daysOut - a.daysOut);
  const first = pts[0];
  if (!first) return 1; // empty curve -> assume complete
  if (daysOut >= first.daysOut) return first.cumFraction; // very early
  if (daysOut <= 0) return 1;
  for (let k = 0; k < pts.length - 1; k++) {
    const hi = pts[k]!;
    const lo = pts[k + 1]!;
    if (daysOut <= hi.daysOut && daysOut >= lo.daysOut) {
      const t = (hi.daysOut - daysOut) / (hi.daysOut - lo.daysOut);
      return hi.cumFraction + t * (lo.cumFraction - hi.cumFraction);
    }
  }
  return 1;
}

export function projectWalkup(i: WalkupInput): WalkupResult {
  const curve = i.curve ?? DEFAULT_SALES_CURVE;
  const maxDay = Math.max(...curve.map((p) => p.daysOut));
  const frac = fractionComplete(i.days_remaining, curve);
  const raw = frac > 0 ? i.tickets_sold / frac : i.tickets_sold;
  const projected_final = Math.min(Math.round(raw), i.sellout_attendance);

  // pace band: within 5% of target = on track
  let pace: WalkupResult['pace_vs_target'] = 'unknown';
  if (i.target_attendance > 0) {
    const r = projected_final / i.target_attendance;
    pace = r >= 1.05 ? 'ahead' : r >= 0.95 ? 'on_track' : 'behind';
  }

  return {
    projected_final,
    fraction_complete: frac,
    pace_vs_target: pace,
    curve_is_estimated: !i.curve, // DEFAULT used -> estimated
    too_early: i.days_remaining > maxDay, // before the curve starts
  };
}
