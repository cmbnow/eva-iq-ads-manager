'use client';

import { useEffect, useState } from 'react';

import { RefreshCw, Ticket } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';

import {
  type TicketTailorEventRow,
  listTicketTailorEvents,
  syncTicketTailorEvent,
  syncTicketTailorEvents,
} from '~/lib/server/ticket-tailor/sync';

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function TicketTailorEvents() {
  const [rows, setRows] = useState<TicketTailorEventRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    listTicketTailorEvents()
      .then(setRows)
      .catch(() => {});
  }

  useEffect(load, []);

  async function onRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    setErr(null);
    const res = await syncTicketTailorEvents();
    setRefreshing(false);
    if (res.ok) load();
    else setErr(res.error);
  }

  async function onSync(ttEventId: string) {
    if (syncing) return;
    setSyncing(ttEventId);
    setErr(null);
    const res = await syncTicketTailorEvent(ttEventId);
    setSyncing(null);
    if (res.ok) load();
    else setErr(res.error);
  }

  return (
    <Card className={'mt-6'}>
      <CardHeader className={'flex flex-row items-center justify-between'}>
        <CardTitle className={'flex items-center gap-2 text-base'}>
          <Ticket className={'h-4 w-4'} /> TicketTailor events
        </CardTitle>
        <Button size={'sm'} onClick={onRefresh} disabled={refreshing}>
          <RefreshCw
            className={'mr-2 h-3.5 w-3.5 ' + (refreshing ? 'animate-spin' : '')}
          />
          {refreshing ? 'Refreshing…' : 'Refresh events'}
        </Button>
      </CardHeader>
      <CardContent className={'space-y-3 text-sm'}>
        {err ? <p className={'text-destructive'}>{err}</p> : null}

        {rows.length === 0 ? (
          <p className={'text-muted-foreground'}>
            No events yet. Click <strong>Refresh events</strong> to pull them
            from TicketTailor, then <strong>Sync</strong> a row for its ticket
            counts and orders.
          </p>
        ) : (
          <div className={'overflow-x-auto'}>
            <table className={'w-full text-left'}>
              <thead className={'text-muted-foreground text-xs'}>
                <tr className={'border-b'}>
                  <th className={'py-2 pr-3 font-medium'}>Event</th>
                  <th className={'py-2 pr-3 font-medium'}>Date</th>
                  <th className={'py-2 pr-3 font-medium'}>Sold / in</th>
                  <th className={'py-2 pr-3 font-medium'}>Revenue</th>
                  <th className={'py-2 pr-3 font-medium'}>Last synced</th>
                  <th className={'py-2'} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.tt_event_id} className={'border-b last:border-0'}>
                    <td className={'py-2 pr-3 font-medium'}>
                      {r.name ?? r.tt_event_id}
                    </td>
                    <td className={'text-muted-foreground py-2 pr-3'}>
                      {r.event_date ?? '—'}
                    </td>
                    <td className={'py-2 pr-3 whitespace-nowrap'}>
                      {/* The sold-vs-in gap is the walk-up signal. */}
                      <span className={'font-medium'}>{r.total_issued}</span>
                      <span className={'text-muted-foreground'}>
                        {' '}
                        sold / {r.total_checked_in} in
                      </span>
                    </td>
                    <td className={'py-2 pr-3 whitespace-nowrap'}>
                      {money(r.gross_revenue_cents)}
                    </td>
                    <td
                      className={
                        'text-muted-foreground py-2 pr-3 whitespace-nowrap'
                      }
                    >
                      {r.last_synced_at
                        ? new Date(r.last_synced_at).toLocaleString()
                        : 'never'}
                    </td>
                    <td className={'py-2'}>
                      <Button
                        variant={'outline'}
                        size={'sm'}
                        onClick={() => onSync(r.tt_event_id)}
                        disabled={syncing === r.tt_event_id}
                      >
                        {syncing === r.tt_event_id ? 'Syncing…' : 'Sync'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
