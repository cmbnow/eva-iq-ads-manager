'use client';

import { useEffect, useState } from 'react';

import { Check, Copy, Ticket } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';

import {
  getTicketTailorStatus,
  saveTicketTailorKey,
} from '~/lib/server/ticket-tailor/connection';

export function TicketTailorCard() {
  const [connected, setConnected] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function refresh() {
    getTicketTailorStatus()
      .then((s) => {
        setConnected(s.connected);
        setLastSynced(s.lastSyncedAt);
        setWebhookUrl(s.webhookUrl);
      })
      .catch(() => {});
  }

  useEffect(refresh, []);

  async function onSave() {
    if (!key.trim() || busy) return;
    setBusy(true);
    setErr(null);
    const res = await saveTicketTailorKey(key);
    setBusy(false);
    if (res.ok) {
      setKey(''); // never keep the key around
      refresh();
    } else setErr(res.error);
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <Card className={'mt-6'}>
      <CardHeader>
        <CardTitle className={'flex items-center gap-2 text-base'}>
          <Ticket className={'h-4 w-4'} /> TicketTailor
        </CardTitle>
      </CardHeader>
      <CardContent className={'space-y-4 text-sm'}>
        {/* Status */}
        <div className={'flex items-center gap-2'}>
          <span
            className={
              'inline-flex h-2.5 w-2.5 rounded-full ' +
              (connected ? 'bg-green-500' : 'bg-muted-foreground/40')
            }
          />
          {connected ? (
            <span className={'font-medium text-green-700 dark:text-green-300'}>
              Connected
              {lastSynced ? (
                <span className={'text-muted-foreground font-normal'}>
                  {' '}
                  · last synced {new Date(lastSynced).toLocaleString()}
                </span>
              ) : null}
            </span>
          ) : (
            <span className={'text-muted-foreground'}>Not connected</span>
          )}
        </div>

        {/* Key input */}
        <div className={'flex flex-wrap items-center gap-2'}>
          <input
            type={'password'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={connected ? 'Replace API key…' : 'Paste your TicketTailor API key'}
            className={'border-input bg-background h-9 flex-1 rounded-md border px-3 text-sm'}
          />
          <Button onClick={onSave} disabled={busy || !key.trim()}>
            {busy ? 'Verifying…' : 'Save'}
          </Button>
        </div>
        {err ? <p className={'text-destructive text-sm'}>{err}</p> : null}

        {/* Webhook URL */}
        {connected && webhookUrl ? (
          <div className={'space-y-1'}>
            <p className={'text-muted-foreground text-xs'}>
              Webhook URL (paste into TicketTailor):
            </p>
            <div className={'flex items-center gap-2'}>
              <code className={'bg-muted min-w-0 flex-1 truncate rounded px-2 py-1 text-xs'}>
                {webhookUrl}
              </code>
              <Button variant={'outline'} size={'sm'} onClick={copyUrl}>
                {copied ? <Check className={'h-3.5 w-3.5'} /> : <Copy className={'h-3.5 w-3.5'} />}
              </Button>
            </div>
          </div>
        ) : null}

        {/* Instructions */}
        <div className={'bg-muted/40 space-y-1 rounded-md border p-3 text-xs'}>
          <p className={'font-semibold'}>How to connect TicketTailor</p>
          <ol className={'list-decimal space-y-1 pl-4'}>
            <li>
              Log in to TicketTailor and open <strong>Settings → API</strong>.
            </li>
            <li>
              Click <strong>Create API key</strong>, name it &quot;EVA IQ&quot;, and copy the key.
            </li>
            <li>
              Paste it above and click <strong>Save</strong>. We verify it immediately and
              store it encrypted — we never show it again.
            </li>
            <li>
              (Optional, recommended) In TicketTailor <strong>Settings → Webhooks</strong>, add a
              new webhook pointing at the URL above and select the <strong>Order created</strong>{' '}
              event. This keeps your buyer audiences current automatically.
            </li>
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}
