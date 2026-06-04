import Link from 'next/link';

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

const TIER_LABELS: Record<string, string> = {
  advisor: 'Advisor mode',
  managed: 'Managed mode',
  autonomous: 'Autonomous mode',
};

export default async function ClientsPage() {
  // Require a logged-in user (redirects to sign-in otherwise).
  await requireUserInServerComponent();

  const supabase = getSupabaseServerClient();

  // RLS ensures we only see clients this login is a member of.
  const [{ data: tenants }, { data: connections }] = await Promise.all([
    supabase
      .from('tenants')
      .select('*')
      .order('created_at', { ascending: true }),
    supabase.from('tenant_platform_connections').select('*'),
  ]);

  const metaByTenant = new Map(
    (connections ?? [])
      .filter((c) => c.platform === 'meta')
      .map((c) => [c.tenant_id, c]),
  );

  return (
    <>
      <PageHeader
        title={'Clients'}
        description={'The businesses you manage with EVA IQ'}
      />

      <PageBody>
        {!tenants || tenants.length === 0 ? (
          <EmptyState>
            <EmptyStateHeading>No clients yet</EmptyStateHeading>
            <EmptyStateText>
              Your first client (The Foundry) will appear here once it&apos;s
              loaded.
            </EmptyStateText>
          </EmptyState>
        ) : (
          <div className={'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'}>
            {tenants.map((tenant) => {
              const meta = metaByTenant.get(tenant.id);
              const isSac = tenant.special_ad_category !== 'none';

              return (
                <Link key={tenant.id} href={pathsConfig.app.metaAdvisor}>
                <Card className={'hover:border-primary h-full transition-colors'}>
                  <CardHeader>
                    <div className={'flex items-start justify-between gap-2'}>
                      <CardTitle>{tenant.name}</CardTitle>
                      <Badge variant={isSac ? 'warning' : 'success'}>
                        {SAC_LABELS[tenant.special_ad_category] ??
                          tenant.special_ad_category}
                      </Badge>
                    </div>
                    <CardDescription>
                      {tenant.vertical ?? 'Vertical not set'}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className={'space-y-3 text-sm'}>
                    <div className={'flex items-center justify-between'}>
                      <span className={'text-muted-foreground'}>Meta</span>
                      <Badge variant={'info'}>
                        {meta
                          ? (TIER_LABELS[meta.capability_tier] ??
                            meta.capability_tier)
                          : 'Not set up'}
                      </Badge>
                    </div>

                    <div className={'flex items-center justify-between'}>
                      <span className={'text-muted-foreground'}>
                        Platform enabled
                      </span>
                      <span>{meta?.is_enabled ? 'Yes' : 'No (advisor only)'}</span>
                    </div>

                    {meta?.external_account_id ? (
                      <div className={'flex items-center justify-between'}>
                        <span className={'text-muted-foreground'}>
                          Ad account
                        </span>
                        <span className={'font-mono text-xs'}>
                          {meta.external_account_id}
                        </span>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
                </Link>
              );
            })}
          </div>
        )}
      </PageBody>
    </>
  );
}
