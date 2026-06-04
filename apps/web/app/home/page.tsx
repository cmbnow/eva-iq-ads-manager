import Link from 'next/link';

import { ArrowRight, Building2 } from 'lucide-react';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { Badge } from '@kit/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import {
  EmptyState,
  EmptyStateHeading,
  EmptyStateText,
} from '@kit/ui/empty-state';
import { PageBody, PageHeader } from '@kit/ui/page';

import pathsConfig from '~/config/paths.config';
import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';

const SAC_LABELS: Record<string, string> = {
  none: 'Standard',
  housing: 'SAC · Housing',
  employment: 'SAC · Employment',
  credit: 'SAC · Credit',
  financial: 'SAC · Financial',
};

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export default async function HomePage() {
  await requireUserInServerComponent();
  const supabase = getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const [{ data: tenants }, { data: conns }, { data: snaps }, { data: usage }] =
    await Promise.all([
      supabase
        .from('tenants')
        .select('id, name, vertical, special_ad_category')
        .order('created_at', { ascending: true }),
      supabase
        .from('tenant_platform_connections')
        .select('tenant_id, platform, capability_tier, is_enabled'),
      db
        .from('ad_report_snapshots')
        .select(
          'tenant_id, blended_roas, blended_cpp, total_purchases, period_start, period_end, uploaded_at',
        )
        .order('uploaded_at', { ascending: false }),
      db.from('usage_events').select('tokens_in, tokens_out, created_at'),
    ]);

  const latestByTenant = new Map<string, Record<string, unknown>>();
  for (const s of (snaps ?? []) as Record<string, unknown>[]) {
    const tid = String(s.tenant_id);
    if (!latestByTenant.has(tid)) latestByTenant.set(tid, s);
  }
  const metaByTenant = new Map(
    (conns ?? [])
      .filter((c) => c.platform === 'meta')
      .map((c) => [c.tenant_id, c]),
  );

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const tokensThisMonth = ((usage ?? []) as Record<string, unknown>[])
    .filter((u) => new Date(String(u.created_at)) >= monthStart)
    .reduce(
      (sum, u) => sum + Number(u.tokens_in ?? 0) + Number(u.tokens_out ?? 0),
      0,
    );

  return (
    <>
      <PageHeader title={'Your clients'} description={'Every account at a glance'} />

      <PageBody>
        {!tenants || tenants.length === 0 ? (
          <EmptyState>
            <EmptyStateHeading>No clients yet</EmptyStateHeading>
            <EmptyStateText>Add a client to get started.</EmptyStateText>
          </EmptyState>
        ) : (
          <div className={'space-y-6'}>
            <div className={'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'}>
              {tenants.map((t) => {
                const latest = latestByTenant.get(t.id);
                const meta = metaByTenant.get(t.id);
                const isSac = t.special_ad_category !== 'none';
                const roas =
                  latest?.blended_roas != null ? Number(latest.blended_roas) : null;
                const cpp =
                  latest?.blended_cpp != null ? Number(latest.blended_cpp) : null;
                return (
                  <Link key={t.id} href={pathsConfig.app.metaAdvisor}>
                    <Card className={'hover:border-primary h-full transition-colors'}>
                      <CardHeader>
                        <div className={'flex items-start justify-between gap-2'}>
                          <CardTitle className={'text-base'}>{t.name}</CardTitle>
                          <Badge variant={isSac ? 'warning' : 'success'}>
                            {SAC_LABELS[t.special_ad_category] ?? t.special_ad_category}
                          </Badge>
                        </div>
                        <CardDescription>
                          {t.vertical ?? 'Vertical not set'} ·{' '}
                          {meta
                            ? `Meta: ${meta.capability_tier}${meta.is_enabled ? '' : ' (advisor)'}`
                            : 'Meta not set up'}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className={'text-sm'}>
                        {latest ? (
                          <div className={'flex flex-wrap gap-x-5 gap-y-1'}>
                            <Stat label={'Latest ROAS'} value={roas !== null ? `${roas.toFixed(1)}x` : '—'} />
                            <Stat label={'Cost/purchase'} value={cpp !== null ? money(cpp) : '—'} />
                            <Stat label={'Purchases'} value={String(latest.total_purchases ?? '—')} />
                          </div>
                        ) : (
                          <p className={'text-muted-foreground'}>No reports uploaded yet.</p>
                        )}
                        <div className={'text-primary mt-3 flex items-center gap-1 text-xs font-medium'}>
                          Open Meta Advisor <ArrowRight className={'h-3 w-3'} />
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>

            <Card>
              <CardContent className={'flex flex-wrap items-center gap-x-8 gap-y-2 py-4 text-sm'}>
                <span className={'flex items-center gap-2 font-medium'}>
                  <Building2 className={'h-4 w-4'} /> {tenants.length} client{tenants.length === 1 ? '' : 's'}
                </span>
                <span className={'text-muted-foreground'}>
                  AI usage this month: <strong className={'text-foreground'}>{tokensThisMonth.toLocaleString()}</strong> tokens
                </span>
              </CardContent>
            </Card>
          </div>
        )}
      </PageBody>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className={'text-muted-foreground text-xs'}>{label}</p>
      <p className={'font-semibold'}>{value}</p>
    </div>
  );
}
