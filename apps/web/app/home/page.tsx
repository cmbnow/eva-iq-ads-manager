import Link from 'next/link';

import { ArrowRight } from 'lucide-react';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import {
  EmptyState,
  EmptyStateHeading,
  EmptyStateText,
} from '@kit/ui/empty-state';
import { PageBody, PageHeader } from '@kit/ui/page';

import pathsConfig from '~/config/paths.config';
import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';

import {
  ACCENT_2,
  MetricTile,
  MiniSparkline,
  PerfChart,
  type Point,
  StatusPill,
} from './_components/dashboard-ui';

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

type Snap = {
  tenant_id: string;
  period_end: string | null;
  blended_roas: number | null;
  blended_cpp: number | null;
  total_spend: number | null;
  total_revenue: number | null;
  total_purchases: number | null;
};

export default async function HomePage() {
  await requireUserInServerComponent();
  const supabase = getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const [{ data: tenants }, { data: conns }, { data: snapsRaw }, { data: usage }] =
    await Promise.all([
      supabase.from('tenants').select('id, name, vertical, special_ad_category').order('created_at', { ascending: true }),
      supabase.from('tenant_platform_connections').select('tenant_id, platform, capability_tier, is_enabled'),
      db
        .from('ad_report_snapshots')
        .select('tenant_id, period_end, blended_roas, blended_cpp, total_spend, total_revenue, total_purchases')
        .order('period_end', { ascending: true }),
      db.from('usage_events').select('tokens_in, tokens_out, created_at'),
    ]);

  const snaps = (snapsRaw ?? []) as Snap[];
  const metaByTenant = new Map((conns ?? []).filter((c) => c.platform === 'meta').map((c) => [c.tenant_id, c]));

  const byTenant = new Map<string, Snap[]>();
  for (const s of snaps) {
    const arr = byTenant.get(s.tenant_id) ?? [];
    arr.push(s);
    byTenant.set(s.tenant_id, arr);
  }

  const num = (v: number | null | undefined) => (v == null ? 0 : Number(v));
  const series = (arr: Snap[], key: keyof Snap): Point[] =>
    arr.map((s) => ({ label: (s.period_end ?? '').slice(5), v: num(s[key] as number | null) }));

  // Account-wide headline = sum across each client's latest snapshot.
  let spend = 0, revenue = 0, purchases = 0;
  for (const arr of byTenant.values()) {
    const latest = arr[arr.length - 1];
    if (latest) {
      spend += num(latest.total_spend);
      revenue += num(latest.total_revenue);
      purchases += num(latest.total_purchases);
    }
  }
  const blendedRoas = spend > 0 ? revenue / spend : 0;

  // Trend series (single primary client today; combined for sparklines).
  const roasSeries = series(snaps, 'blended_roas');
  const spendSeries = series(snaps, 'total_spend');
  const revSeries = series(snaps, 'total_revenue');
  const cppSeries = series(snaps, 'blended_cpp');

  const delta = (s: Point[]) => {
    if (s.length < 2) return null;
    const a = s[s.length - 1]!.v;
    const b = s[s.length - 2]!.v;
    return { diff: a - b, up: a > b };
  };
  const dRoas = delta(roasSeries);
  const dCpp = delta(cppSeries);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const tokens = ((usage ?? []) as Record<string, unknown>[])
    .filter((u) => new Date(String(u.created_at)) >= monthStart)
    .reduce((t, u) => t + Number(u.tokens_in ?? 0) + Number(u.tokens_out ?? 0), 0);

  const hasData = snaps.length > 0;

  return (
    <>
      <PageHeader title={'Dashboard'} description={'Your ad performance across every client'} />

      <PageBody>
        {!tenants || tenants.length === 0 ? (
          <EmptyState>
            <EmptyStateHeading>No clients yet</EmptyStateHeading>
            <EmptyStateText>Add a client to get started.</EmptyStateText>
          </EmptyState>
        ) : (
          <div className={'space-y-6'}>
            {/* KPI tiles */}
            <div className={'grid grid-cols-2 gap-4 lg:grid-cols-4'}>
              <MetricTile
                label={'Blended ROAS'}
                value={hasData ? `${blendedRoas.toFixed(1)}x` : '—'}
                delta={dRoas ? `${dRoas.up ? '▲' : '▼'} ${Math.abs(dRoas.diff).toFixed(1)}x` : undefined}
                deltaGood={dRoas?.up}
                series={roasSeries}
              />
              <MetricTile
                label={'Cost / purchase'}
                value={purchases > 0 ? money(spend / purchases) : '—'}
                delta={dCpp ? `${dCpp.up ? '▲' : '▼'} ${money(Math.abs(dCpp.diff))}` : undefined}
                deltaGood={dCpp ? !dCpp.up : undefined}
                series={cppSeries}
                accent={ACCENT_2}
              />
              <MetricTile label={'Spend'} value={hasData ? money(spend) : '—'} series={spendSeries} accent={ACCENT_2} />
              <MetricTile label={'Revenue'} value={hasData ? money(revenue) : '—'} series={revSeries} />
            </div>

            {/* Performance chart */}
            {roasSeries.length > 1 ? (
              <div className={'bg-card rounded-xl border p-4 shadow-sm'}>
                <p className={'mb-2 text-sm font-semibold'}>Blended ROAS over time</p>
                <PerfChart series={roasSeries} />
              </div>
            ) : null}

            {/* Client cards */}
            <div>
              <p className={'mb-3 text-sm font-semibold'}>Clients</p>
              <div className={'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'}>
                {tenants.map((t) => {
                  const arr = byTenant.get(t.id) ?? [];
                  const latest = arr[arr.length - 1];
                  const meta = metaByTenant.get(t.id);
                  const isSac = t.special_ad_category !== 'none';
                  return (
                    <Link key={t.id} href={pathsConfig.app.metaAdvisor}>
                      <div className={'bg-card hover:border-primary h-full rounded-xl border p-4 shadow-sm transition-colors'}>
                        <div className={'flex items-start justify-between gap-2'}>
                          <p className={'font-semibold'}>{t.name}</p>
                          <StatusPill label={isSac ? 'SAC' : 'Standard'} tone={isSac ? 'warn' : 'good'} />
                        </div>
                        <p className={'text-muted-foreground text-xs'}>
                          {t.vertical ?? 'Vertical not set'} ·{' '}
                          {meta ? `${meta.capability_tier}${meta.is_enabled ? '' : ' (advisor)'}` : 'Meta not set up'}
                        </p>
                        {latest ? (
                          <>
                            <div className={'mt-3 flex items-end justify-between'}>
                              <div>
                                <p className={'text-2xl font-bold'}>{num(latest.blended_roas).toFixed(1)}x</p>
                                <p className={'text-muted-foreground text-xs'}>ROAS · {money(num(latest.total_spend))} spend</p>
                              </div>
                              <div className={'w-24'}>
                                <MiniSparkline series={series(arr, 'blended_roas')} />
                              </div>
                            </div>
                          </>
                        ) : (
                          <p className={'text-muted-foreground mt-3 text-sm'}>No reports yet.</p>
                        )}
                        <div className={'text-primary mt-3 flex items-center gap-1 text-xs font-medium'}>
                          Open advisor <ArrowRight className={'h-3 w-3'} />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>

            <p className={'text-muted-foreground text-xs'}>AI usage this month: {tokens.toLocaleString()} tokens</p>
          </div>
        )}
      </PageBody>
    </>
  );
}
