import { PageBody, PageHeader } from '@kit/ui/page';

import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';

import { MetaAdvisorClient } from './_components/meta-advisor-client';

export default async function MetaAdvisorPage() {
  await requireUserInServerComponent();

  return (
    <>
      <PageHeader
        title={'Meta Advisor'}
        description={
          'Upload a Meta ads export — get an instant benchmark analysis and recommendations'
        }
      />

      <PageBody>
        <MetaAdvisorClient />
      </PageBody>
    </>
  );
}
