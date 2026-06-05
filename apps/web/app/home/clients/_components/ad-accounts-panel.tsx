'use client';

import { useState, useTransition } from 'react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';

import {
  type DiscoveredAccount,
  discoverAdAccounts,
  selectAdAccount,
} from '~/lib/server/meta/accounts';

export function AdAccountsPanel({ initial }: { initial: DiscoveredAccount[] }) {
  const [accounts, setAccounts] = useState<DiscoveredAccount[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = accounts.find((a) => a.is_selected) ?? null;

  function onDiscover() {
    setError(null);
    startTransition(async () => {
      const res = await discoverAdAccounts();
      if (res.ok) setAccounts(res.accounts);
      else setError(res.error);
    });
  }

  function onSelect(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await selectAdAccount(id);
      if (res.ok) {
        setAccounts((prev) =>
          prev.map((a) => ({
            ...a,
            is_selected: a.id === id,
            data_path: a.id === id ? res.account.data_path : a.data_path,
          })),
        );
      } else setError(res.error);
    });
  }

  return (
    <Card className={'mb-4'}>
      <CardHeader>
        <div className={'flex flex-wrap items-center justify-between gap-2'}>
          <CardTitle className={'text-base'}>Meta ad accounts</CardTitle>
          <Button
            variant={'outline'}
            size={'sm'}
            onClick={onDiscover}
            disabled={pending}
          >
            {pending
              ? 'Working…'
              : accounts.length
                ? 'Re-check accounts'
                : 'Discover ad accounts'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className={'space-y-3'}>
        {error ? (
          <p className={'text-destructive text-sm'}>{error}</p>
        ) : null}

        {accounts.length === 0 ? (
          <p className={'text-muted-foreground text-sm'}>
            After connecting Meta, click <strong>Discover ad accounts</strong> to
            list the accounts you can manage, then pick the one EVA IQ runs for
            this client.
          </p>
        ) : (
          <div className={'space-y-2'}>
            {accounts.map((a) => (
              <div
                key={a.id}
                className={
                  'flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm'
                }
              >
                <div className={'min-w-0'}>
                  <p className={'font-medium'}>{a.name ?? a.meta_account_id}</p>
                  <p className={'text-muted-foreground font-mono text-xs'}>
                    {a.meta_account_id}
                    {a.is_queryable ? '' : ' · inactive'}
                  </p>
                </div>
                <div className={'flex items-center gap-2'}>
                  {a.is_selected ? (
                    <>
                      <Badge variant={a.data_path === 'mcp' ? 'success' : 'info'}>
                        {a.data_path === 'mcp' ? 'Live (MCP)' : 'CSV path'}
                      </Badge>
                      <Badge variant={'success'}>Managing</Badge>
                    </>
                  ) : (
                    <Button
                      variant={'outline'}
                      size={'sm'}
                      onClick={() => onSelect(a.id)}
                      disabled={pending}
                    >
                      Manage this account
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {selected ? <BranchNote account={selected} /> : null}
      </CardContent>
    </Card>
  );
}

function BranchNote({ account }: { account: DiscoveredAccount }) {
  if (account.data_path === 'mcp') {
    return (
      <div
        className={
          'rounded-md border border-green-500/30 bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-500/10 dark:text-green-300'
        }
      >
        Live access is enabled for this account — EVA IQ can pull insights
        directly. Next: confirm the pixel and optimization event.
      </div>
    );
  }
  return (
    <div
      className={
        'space-y-2 rounded-md border border-blue-500/30 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:bg-blue-500/10 dark:text-blue-300'
      }
    >
      <p>
        Meta hasn’t enabled live API access for this account yet, so EVA IQ runs
        on a <strong>CSV export</strong> (no dead ends — everything still works).
        In Meta Ads Manager → <strong>Reports → Export table data (.csv)</strong>,
        include these columns:
      </p>
      <p className={'text-xs'}>
        Ad name · Ad set name · Amount spent · Purchase ROAS · Results · Result
        indicator · Purchases · Frequency · Reach · Impressions · CPM · Quality
        ranking · Reporting starts · Reporting ends · Ends · Ad set budget
      </p>
      <p className={'text-xs'}>
        Use the event’s full flight as the date range. Then upload it on the{' '}
        <a className={'font-medium underline'} href={'/home/meta-advisor'}>
          Meta Advisor
        </a>{' '}
        page.
      </p>
    </div>
  );
}
