import { PageBody, PageHeader } from '@kit/ui/page';

import { getTenantContext } from '~/lib/server/ai';
import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';

import { OfferEngineClient } from './_components/offer-engine-client';

export default async function ShowEnginePage() {
  await requireUserInServerComponent();

  // A5: F&B basis is per-tenant config. Pass it as props; the client derives the
  // contribution (check × rate) or, when unset, leaves F&B excluded (no fallback).
  const { tenant } = await getTenantContext();

  return (
    <>
      <PageHeader
        title={'Show Engine'}
        description={
          'Turn a show offer into TMV, CPA guardrails, and exact ad budgets'
        }
      />
      <PageBody>
        <OfferEngineClient
          fbAvgCheckPerHead={tenant?.fb_avg_check_per_head ?? null}
          fbMarginRate={tenant?.fb_margin_rate ?? null}
        />
      </PageBody>
    </>
  );
}
