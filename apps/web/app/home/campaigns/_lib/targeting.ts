/**
 * Pure Meta targeting builder + SAC mapping (no 'use server' so it can export
 * non-async helpers and be unit-tested). Consumed by publish.ts.
 */

export type AudienceSpec =
  | {
      mode: 'manual';
      lat: number;
      lng: number;
      radiusMi: number;
      ageMin: number;
      ageMax: number;
      genders?: number[];
    }
  | {
      mode: 'custom';
      customAudienceIds: string[];
      lat?: number;
      lng?: number;
      radiusMi?: number;
    };

// Build Meta targeting JSON, enforcing SAC rules when sac !== 'none'.
export function buildTargeting(spec: AudienceSpec, sac: string): object {
  const isSac = sac !== 'none';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t: any = { geo_locations: {} };

  // SAC: force broad — 18–65, ≥15mi radius, no custom-audience narrowing, no lookalikes.
  if (spec.mode === 'manual' || isSac) {
    const radius = Math.max(
      spec.mode === 'manual' ? spec.radiusMi : (spec.radiusMi ?? 15),
      isSac ? 15 : 1,
    );
    t.geo_locations.custom_locations = [
      {
        latitude: spec.lat,
        longitude: spec.lng,
        radius,
        distance_unit: 'mile',
      },
    ];
    t.age_min = isSac ? 18 : spec.mode === 'manual' ? spec.ageMin : 18;
    t.age_max = isSac ? 65 : spec.mode === 'manual' ? spec.ageMax : 65;
    if (!isSac && spec.mode === 'manual' && spec.genders?.length)
      t.genders = spec.genders;
  }
  if (spec.mode === 'custom' && !isSac) {
    t.custom_audiences = spec.customAudienceIds.map((id) => ({ id }));
    if (spec.lat && spec.lng) {
      t.geo_locations.custom_locations = [
        {
          latitude: spec.lat,
          longitude: spec.lng,
          radius: spec.radiusMi ?? 25,
          distance_unit: 'mile',
        },
      ];
    } else {
      t.geo_locations = { countries: ['US'] };
    }
    t.age_min = 18;
    t.age_max = 65;
  }
  return t;
}

/**
 * Map our special_ad_category enum to Meta's special_ad_categories values.
 * [] for 'none'. NOTE: 'financial' → FINANCIAL_PRODUCTS_SERVICES (the correct
 * Meta value for financial products/insurance; the spec's parenthetical listed
 * ISSUES_ELECTIONS_POLITICS, which is a different category we don't model).
 */
export function mapSac(sac: string): string[] {
  switch (sac) {
    case 'housing':
      return ['HOUSING'];
    case 'employment':
      return ['EMPLOYMENT'];
    case 'credit':
      return ['CREDIT'];
    case 'financial':
      return ['FINANCIAL_PRODUCTS_SERVICES'];
    default:
      return [];
  }
}
