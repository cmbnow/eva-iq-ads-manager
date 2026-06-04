'use server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { AccountSummary, AdAnalysis, AnalysisResult } from './analyze';

export type SnapshotMeta = {
  id: string;
  periodStart: string | null;
  periodEnd: string | null;
  uploadedAt: string;
  blendedRoas: number | null;
  blendedCpp: number | null;
  totalSpend: number | null;
  totalPurchases: number | null;
};

export type SaveResult =
  | { ok: true; previous: SnapshotMeta | null; history: SnapshotMeta[] }
  | { ok: false; error: string };

function toMeta(row: Record<string, unknown>): SnapshotMeta {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: String(row.id),
    periodStart: (row.period_start as string) ?? null,
    periodEnd: (row.period_end as string) ?? null,
    uploadedAt: String(row.uploaded_at),
    blendedRoas: n(row.blended_roas),
    blendedCpp: n(row.blended_cpp),
    totalSpend: n(row.total_spend),
    totalPurchases: n(row.total_purchases),
  };
}

async function firstTenantId(
  supabase: ReturnType<typeof getSupabaseServerClient>,
): Promise<string | null> {
  const { data } = await supabase
    .from('tenants')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1);
  return data?.[0]?.id ?? null;
}

/** Load the saved history for this client (used on page load — always visible). */
export async function getHistory(): Promise<SnapshotMeta[]> {
  const supabase = getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const tenantId = await firstTenantId(supabase);
  if (!tenantId) return [];

  const { data } = await db
    .from('ad_report_snapshots')
    .select(
      'id, period_start, period_end, uploaded_at, blended_roas, blended_cpp, total_spend, total_purchases',
    )
    .eq('tenant_id', tenantId)
    .order('uploaded_at', { ascending: false })
    .limit(24);

  return (data ?? []).map(toMeta);
}

/** Re-open a saved period: returns the stored analysis to render. */
export async function getSnapshotAnalysis(
  id: string,
): Promise<AnalysisResult | null> {
  const supabase = getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data } = await db
    .from('ad_report_snapshots')
    .select('summary, ads')
    .eq('id', id)
    .limit(1);

  const row = data?.[0];
  if (!row) return null;

  const summary = row.summary as AccountSummary;
  const ads = (row.ads as AdAnalysis[]) ?? [];
  return { summary, ads, highlights: [] };
}

export type TrendPoint = {
  period: string;
  roas: number | null;
  cpp: number | null;
  frequency: number | null;
};

/** ROAS / cost-per-purchase / frequency for one ad across all saved periods. */
export async function getTrendSeries(
  adName: string,
  adSetName: string,
): Promise<TrendPoint[]> {
  const supabase = getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const tenantId = await firstTenantId(supabase);
  if (!tenantId) return [];

  const { data } = await db
    .from('ad_report_snapshots')
    .select('period_end, ads')
    .eq('tenant_id', tenantId)
    .order('period_end', { ascending: true })
    .limit(24);

  const points: TrendPoint[] = [];
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const ads = (row.ads as AdAnalysis[]) ?? [];
    const match = ads.find(
      (a) => a.adName === adName && a.adSetName === adSetName,
    );
    if (match) {
      points.push({
        period: String(row.period_end ?? ''),
        roas: match.roas ?? null,
        cpp: match.cpp ?? null,
        frequency: match.frequency ?? null,
      });
    }
  }
  return points;
}

export async function saveAndCompare(input: {
  summary: AccountSummary;
  ads: AdAnalysis[];
  fileName: string | null;
}): Promise<SaveResult> {
  const supabase = getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const tenantId = await firstTenantId(supabase);
  if (!tenantId) {
    return { ok: false, error: 'No client found to attach this report to.' };
  }

  const s = input.summary;
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const { data: recentRaw } = await db
    .from('ad_report_snapshots')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('uploaded_at', { ascending: false })
    .limit(12);

  const recent: Record<string, unknown>[] = recentRaw ?? [];

  const sameAsCurrent = (row: Record<string, unknown>) =>
    (row.period_start as string) === s.reportStart &&
    (row.period_end as string) === s.reportEnd &&
    Number(row.total_purchases) === s.totalPurchases &&
    round2(Number(row.total_spend)) === round2(s.totalSpend);

  const isDuplicate = recent.length > 0 && sameAsCurrent(recent[0]!);
  const previousRow = recent.find((r) => !sameAsCurrent(r)) ?? null;

  if (!isDuplicate) {
    await db.from('ad_report_snapshots').insert({
      tenant_id: tenantId,
      platform: 'meta',
      period_start: s.reportStart,
      period_end: s.reportEnd,
      file_name: input.fileName,
      total_spend: round2(s.totalSpend),
      total_revenue: round2(s.totalRevenue),
      total_purchases: s.totalPurchases,
      blended_roas: s.blendedRoas !== null ? round2(s.blendedRoas) : null,
      blended_cpp: s.blendedCpp !== null ? round2(s.blendedCpp) : null,
      summary: s,
      ads: input.ads,
    });
  }

  const { data: historyRaw } = await db
    .from('ad_report_snapshots')
    .select(
      'id, period_start, period_end, uploaded_at, blended_roas, blended_cpp, total_spend, total_purchases',
    )
    .eq('tenant_id', tenantId)
    .order('uploaded_at', { ascending: false })
    .limit(24);

  return {
    ok: true,
    previous: previousRow ? toMeta(previousRow) : null,
    history: (historyRaw ?? []).map(toMeta),
  };
}
