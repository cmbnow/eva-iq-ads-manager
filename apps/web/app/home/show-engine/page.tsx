import { PageBody, PageHeader } from '@kit/ui/page';

import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';

import { OfferEngineClient } from './_components/offer-engine-client';

export default async function ShowEnginePage() {
  await requireUserInServerComponent();

  return (
    <>
      <PageHeader
        title={'Show Engine'}
        description={'Turn a show offer into TMV, CPA guardrails, and exact ad budgets'}
      />
      <PageBody>
        <OfferEngineClient />
      </PageBody>
    </>
  );
}
