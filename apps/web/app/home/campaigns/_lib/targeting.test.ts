import { describe, expect, it } from 'vitest';

import { buildTargeting, mapSac } from './targeting';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const T = (x: object) => x as any;

describe('buildTargeting — SAC enforcement', () => {
  it('SAC forces broad 18–65, ≥15mi, and DROPS custom audiences', () => {
    const t = T(
      buildTargeting(
        { mode: 'custom', customAudienceIds: ['aud_1', 'aud_2'], lat: 38, lng: -78, radiusMi: 5 },
        'housing',
      ),
    );
    expect(t.age_min).toBe(18);
    expect(t.age_max).toBe(65);
    expect(t.custom_audiences).toBeUndefined(); // narrowing removed under SAC
    expect(t.geo_locations.custom_locations[0].radius).toBeGreaterThanOrEqual(15);
    expect(t.geo_locations.custom_locations[0].distance_unit).toBe('mile');
  });

  it('SAC raises a too-small manual radius to ≥15', () => {
    const t = T(
      buildTargeting(
        { mode: 'manual', lat: 38, lng: -78, radiusMi: 3, ageMin: 25, ageMax: 40 },
        'financial',
      ),
    );
    expect(t.geo_locations.custom_locations[0].radius).toBeGreaterThanOrEqual(15);
    expect(t.age_min).toBe(18);
    expect(t.age_max).toBe(65);
  });
});

describe('buildTargeting — non-SAC', () => {
  it('custom mode keeps the selected custom audiences', () => {
    const t = T(
      buildTargeting(
        { mode: 'custom', customAudienceIds: ['aud_1', 'aud_2'], lat: 38, lng: -78, radiusMi: 25 },
        'none',
      ),
    );
    expect(t.custom_audiences).toEqual([{ id: 'aud_1' }, { id: 'aud_2' }]);
    expect(t.age_min).toBe(18);
    expect(t.age_max).toBe(65);
    expect(t.geo_locations.custom_locations[0].radius).toBe(25);
  });

  it('manual mode honors the operator age + radius + gender', () => {
    const t = T(
      buildTargeting(
        { mode: 'manual', lat: 38, lng: -78, radiusMi: 10, ageMin: 21, ageMax: 45, genders: [1] },
        'none',
      ),
    );
    expect(t.age_min).toBe(21);
    expect(t.age_max).toBe(45);
    expect(t.genders).toEqual([1]);
    expect(t.geo_locations.custom_locations[0].radius).toBe(10);
    expect(t.custom_audiences).toBeUndefined();
  });
});

describe('mapSac', () => {
  it('maps our enum to Meta special_ad_categories', () => {
    expect(mapSac('none')).toEqual([]);
    expect(mapSac('housing')).toEqual(['HOUSING']);
    expect(mapSac('employment')).toEqual(['EMPLOYMENT']);
    expect(mapSac('credit')).toEqual(['CREDIT']);
    expect(mapSac('financial')).toEqual(['FINANCIAL_PRODUCTS_SERVICES']);
  });
});
