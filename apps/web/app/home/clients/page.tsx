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
import { listAdAccounts } from '~/lib/server/meta/accounts';
import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';

import { AdAccountsPanel } from './_components/ad-accounts-panel';

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

const META_ERRORS: Record<string, string> = {
  config: 'Meta isn’t configured yet (the app credentials are missing). Set them up and try again.',
  denied: 'You canceled the Meta connection — nothing was changed.',
  state: 'The connection link expired or didn’t match. Please click Connect again.',
  missing: 'The connection response was incomplete. Please click Connect again.',
  auth: 'Please sign in, then click Connect again.',
  forbidden: 'You don’t have access to that client.',
  exchange: 'Meta wouldn’t complete the sign-in. Please try Connect again.',
  store: 'Connected, but saving the secure token failed. Please try Connect again.',
};

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ meta?: string; meta_error?: string }>;
}) {
  const sp = await searchParams;
  // Require a logged-in user (redirects to sign-in otherwise).
  await requireUserInServerComponent();

  const supabase = getSupabaseServerClient();

  // RLS ensures we only see clients this login is a member of.
  const [{ data: tenants }, { data: connections }] = await Promise.all([
    supabase
      .from('tenants')
      .select('*')
      .order('created_at', { ascending: true }),
    supabase
      .from('tenant_platform_connections')
      .select(
        'tenant_id, platform, connection_status, is_enabled, capability_tier, external_account_id, external_account_name, connected_at',
      ),
  ]);

  const metaByTenant = new Map(
    (connections ?? [])
      .filter((c) => c.platform === 'meta')
      .map((c) => [c.tenant_id, c]),
  );

  const adAccounts = await listAdAccounts();

  return (
    <>
      <PageHeader
        title={'Clients'}
        description={'The businesses you manage with EVA IQ'}
      />

      <PageBody>
        <div className={'mb-4 flex flex-wrap items-center justify-between gap-3'}>
          <p className={'text-muted-foreground text-sm'}>
            Connect a client&apos;s Meta account to start. You&apos;ll authorize
            on Facebook — you&apos;re never asked to paste a token.
          </p>
          <a
            href={'/api/meta/oauth/start'}
            className={
              'bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center rounded-md px-4 text-sm font-medium'
            }
          >
            Connect Meta account
          </a>
        </div>

        {sp.meta === 'connected' ? (
          <div
            className={
              'mb-4 rounded-md border border-green-500/30 bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-500/10 dark:text-green-300'
            }
          >
            Meta account connected. Next: pick which ad account EVA IQ should
            manage for this client.
          </div>
        ) : null}
        {sp.meta_error ? (
          <div
            className={
              'mb-4 rounded-md border border-orange-500/30 bg-orange-50 px-3 py-2 text-sm text-orange-700 dark:bg-orange-500/10 dark:text-orange-300'
            }
          >
            {META_ERRORS[sp.meta_error] ??
              'Couldn’t complete the Meta connection. Please try again.'}
          </div>
        ) : null}

        <AdAccountsPanel initial={adAccounts} />

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
