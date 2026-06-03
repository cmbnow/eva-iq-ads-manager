'use server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { AccountSummary } from './analyze';

export type SlimAd = {
  adName: string;
  adSetName: string;
  spend: number;
  purchases: number;
  roas: number;
  cpp: number | null;
  frequency: number;
  daysUntilEnd: number | null;
  recommendation: string;
};

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

export async function saveAndCompare(input: {
  summary: AccountSummary;
  ads: SlimAd[];
  fileName: string | null;
}): Promise<SaveResult> {
  // Untyped client for the snapshots table (kept out of generated types).
  const supabase = getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Which client (tenant) is this for? RLS returns only the user's tenants.
  const { data: tenants, error: tErr } = await supabase
    .from('tenants')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1);

  if (tErr || !tenants || tenants.length === 0) {
    return { ok: false, error: 'No client found to attach this report to.' };
  }
  const tenantId = tenants[0]!.id;

  const s = input.summary;
  const round2 = (n: number) => Math.round(n * 100) / 100;

  // Pull recent snapshots BEFORE inserting (to find the comparison target).
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

  // The "since last upload" target = most recent snapshot that's a DIFFERENT report.
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

  // History (after insert), newest first.
  const { data: historyRaw } = await db
    .from('ad_report_snapshots')
    .select(
      'id, period_start, period_end, uploaded_at, blended_roas, blended_cpp, total_spend, total_purchases',
    )
    .eq('tenant_id', tenantId)
    .order('uploaded_at', { ascending: false })
    .limit(12);

  return {
    ok: true,
    previous: previousRow ? toMeta(previousRow) : null,
    history: (historyRaw ?? []).map(toMeta),
  };
}
