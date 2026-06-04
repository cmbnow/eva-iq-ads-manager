import { PageBody, PageHeader } from '@kit/ui/page';

import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';

import { ComposerClient } from './_components/composer-client';

export default async function CampaignsPage() {
  await requireUserInServerComponent();

  return (
    <>
      <PageHeader
        title={'Ad Composer'}
        description={'Write a complete new ad — ready to build in Meta, with approval + audit'}
      />
      <PageBody>
        <ComposerClient />
      </PageBody>
    </>
  );
}
