import { describe, expect, it } from 'vitest';

import { analyzeMetaCsv } from './analyze';
import { type ShowEconomics, buildPostEventReport } from './post-event';

// The real Foundry export, May 25 – Jun 7 2026 (9 ad rows, 8 ad sets).
const FOUNDRY_CSV = `"Reporting starts","Reporting ends","Ad name","Ad delivery",Results,"Result indicator","Cost per results","Ad set budget","Ad set budget type","Amount spent (USD)",Impressions,Reach,Frequency,"CPM (cost per 1,000 impressions) (USD)",Purchases,Ends,"Attribution setting",Bid,"Bid type","Last significant edit","Quality ranking","Engagement rate ranking","Conversion rate ranking","Ad set name","Purchase ROAS (return on ad spend)"
2026-05-25,2026-06-07,"Andrew Hypes — Grill N Chill — Video — High Intent",not_delivering,38,actions:offsite_conversion.fb_pixel_initiate_checkout,4.19763158,"Using campaign budget",0,159.51,21997,7076,3.108677,7.251443,31,2026-06-05,"7-day click, 1-day view, or 1-day engaged-view",0,ABSOLUTE_OCPM,2026-05-19T15:15:37-0400,-,-,-,"Andrew Hypes — Lookalike 1% — Medium Intent",9.330136
2026-05-25,2026-06-07,"Andrew Hypes — Grill N Chill — Video — High Intent",not_delivering,18,actions:offsite_conversion.fb_pixel_initiate_checkout,6.53666667,"Using campaign budget",0,117.66,15202,4926,3.086074,7.739771,17,2026-06-05,"7-day click, 1-day view, or 1-day engaged-view",0,ABSOLUTE_OCPM,2026-05-19T15:16:54-0400,-,-,-,"Andrew Hypes — Medium Intent — All Tiers",8.626551
2026-05-25,2026-06-07,"Warped Band_0619_ Static Sales Ad",active,7,actions:offsite_conversion.fb_pixel_initiate_checkout,4.62142857,"Using campaign budget",0,32.35,6217,3301,1.883369,5.203474,6,2026-06-22,"7-day click, 1-day view, or 1-day engaged-view",0,ABSOLUTE_OCPM,2026-05-22T01:25:30-0400,"Above average","Above average",Average,"Warped Band_0619_ Sales Ad Set -REVISED",10.355487
2026-05-25,2026-06-07,"Ugly Kid Sales Ad",active,5,actions:offsite_conversion.fb_pixel_initiate_checkout,4.344,"Using campaign budget",0,21.72,4047,2317,1.746655,5.366938,5,2026-09-12,"7-day click, 1-day view, or 1-day engaged-view",0,ABSOLUTE_OCPM,2026-05-22T01:03:02-0400,"Above average","Above average","Above average","Ugly Kid Ad Set -REVISED",22.272099
2026-05-25,2026-06-07,"Andrew Hypes Retargeting - June 5",not_delivering,30,actions:offsite_conversion.fb_pixel_purchase,3.403,"Using campaign budget",0,102.09,14858,3688,4.028742,6.871046,30,2026-06-05,"7-day click, 1-day view, or 1-day engaged-view",0,ABSOLUTE_OCPM,2026-05-26T17:37:22-0400,-,-,-,"Andrew Hypes Retargeting - June 5",13.674209
2026-05-25,2026-06-07,"Warped Band_0619_ SeeTickets Buyers",active,47,actions:offsite_conversion.fb_pixel_initiate_checkout,0.83340426,"Using campaign budget",0,39.17,7534,3304,2.280266,5.199097,31,2026-06-22,"7-day click, 1-day view, or 1-day engaged-view",0,ABSOLUTE_OCPM,2026-05-28T00:10:30-0400,"Above average","Above average",Average,"Warped Band_0619_ SeeTickets Buyers",34.203472
2026-05-25,2026-06-07,"Ugly Kid Sales Ad",active,10,actions:offsite_conversion.fb_pixel_initiate_checkout,1.812,"Using campaign budget",0,18.12,3692,1828,2.019694,4.907909,10,2026-09-12,"7-day click, 1-day view, or 1-day engaged-view",0,ABSOLUTE_OCPM,2026-06-04T18:45:45-0400,Average,"Above average","Above average","Ugly Kid Joe_0911_ SeeTickets Buyers",38.341611
2026-05-25,2026-06-07,"Warped Band_0619_ Hive_Buyers Ad Set",active,13,actions:offsite_conversion.fb_pixel_initiate_checkout,2.99307692,"Using campaign budget",0,38.91,8674,3039,2.854228,4.48582,12,2026-06-22,"7-day click, 1-day view, or 1-day engaged-view",0,ABSOLUTE_OCPM,2026-06-05T00:10:59-0400,"Above average","Above average",Average,"Warped Band_0619_ Hive_Buyers Ad Set",19.59008
2026-05-25,2026-06-07,"Ugly Kid Reel Ad",active,6,actions:offsite_conversion.fb_pixel_initiate_checkout,0.88,"Using campaign budget",0,5.28,879,508,1.730315,6.006826,1,2026-09-12,"7-day click, 1-day view, or 1-day engaged-view",0,ABSOLUTE_OCPM,2026-06-04T18:45:45-0400,-,-,-,"Ugly Kid Joe_0911_ SeeTickets Buyers",8.901515`;

describe('post-event report — Foundry May 25–Jun 7', () => {
  const analysis = analyzeMetaCsv(FOUNDRY_CSV);

  it('aggregates to 8 ad sets, ranked best-to-worst by ROAS', () => {
    const r = buildPostEventReport(analysis, null);
    expect(r.adSets).toHaveLength(8);
    for (let i = 1; i < r.adSets.length; i++) {
      expect(r.adSets[i - 1]!.roas).toBeGreaterThanOrEqual(r.adSets[i]!.roas);
    }
  });

  it('flags the frequency-4.0 retargeting set as a hard stop', () => {
    const r = buildPostEventReport(analysis, null);
    const retarget = r.adSets.find(
      (a) => a.adSetName === 'Andrew Hypes Retargeting - June 5',
    )!;
    expect(retarget.maxFrequency).toBeCloseTo(4.03, 1);
    expect(retarget.freqFlag).toBe('stop');
    expect(retarget.audienceType).toBe('retargeting');
    expect(
      r.frequencyFlags.some((f) => f.includes('Andrew Hypes Retargeting')),
    ).toBe(true);
  });

  it('echoes the IC-first rule: Purchase-optimized set under 50/wk is flagged', () => {
    const r = buildPostEventReport(analysis, null);
    const retarget = r.adSets.find(
      (a) => a.adSetName === 'Andrew Hypes Retargeting - June 5',
    )!;
    expect(retarget.optimizationMode).toBe('purchase');
    expect(retarget.weeklyPurchases).toBeCloseTo(15, 0); // 30 over 2 weeks
    expect(
      r.optimizationFlags.some((f) =>
        f.includes('Andrew Hypes Retargeting'),
      ),
    ).toBe(true);
  });

  it('without economics: ROAS basis, no fabricated profit verdict', () => {
    const r = buildPostEventReport(analysis, null);
    expect(r.verdict.basis).toBe('roas');
    expect(r.verdict.level).toBe('na');
    expect(r.verdict.affordable).toBeNull();
  });

  it('with economics, no actual F&B: F&B EXCLUDED, planning assumption never used', () => {
    // ticket margin + booking fee = $40/head; actual F&B unknown.
    const econ: ShowEconomics = {
      showName: 'Test',
      ticketPlusFeePerHead: 40,
      actualFbPerHead: null,
    };
    const r = buildPostEventReport(analysis, econ);
    expect(r.summary.purchases).toBe(143);
    expect(r.verdict.basis).toBe('profit');
    expect(r.verdict.fbBasis).toBe('excluded');
    // affordable = 40 × 143 = 5,720 — NO F&B (and definitely not +$32 assumption).
    expect(r.verdict.affordable).toBeCloseTo(5720, 0);
    expect(r.verdict.level).toBe('profitable');
    expect(r.verdict.fbNote).toMatch(/EXCLUDED/);
  });

  it('with ACTUAL F&B: it is added to the ceiling (assumption still never used)', () => {
    const econ: ShowEconomics = {
      showName: 'Test',
      ticketPlusFeePerHead: 40,
      actualFbPerHead: 10, // real F&B from sales
    };
    const r = buildPostEventReport(analysis, econ);
    // ceiling = 40 + 10 = 50; affordable = 50 × 143 = 7,150. If the $32 planning
    // assumption had leaked in, ceiling would be 72/82 — it must not.
    expect(r.verdict.fbBasis).toBe('actual');
    expect(r.verdict.affordable).toBeCloseTo(7150, 0);
    expect(r.verdict.fbNote).toMatch(/ACTUAL/);
  });

  it('produces 3–5 concrete next-show recommendations', () => {
    const r = buildPostEventReport(analysis, null);
    expect(r.recommendations.length).toBeGreaterThanOrEqual(3);
    expect(r.recommendations.length).toBeLessThanOrEqual(5);
  });
});
