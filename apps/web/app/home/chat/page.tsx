import { PageBody, PageHeader } from '@kit/ui/page';

import { requireUserInServerComponent } from '~/lib/server/require-user-in-server-component';

import { ChatClient } from './_components/chat-client';

export default async function ChatPage() {
  await requireUserInServerComponent();

  return (
    <>
      <PageHeader
        title={'Chat'}
        description={'Talk to EVA IQ about this client — upload screenshots, ask anything'}
      />
      <PageBody>
        <ChatClient />
      </PageBody>
    </>
  );
}
