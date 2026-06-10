import { describe, expect, it } from 'vitest';

import {
  isCountRefreshEvent,
  isEventMetaEvent,
  pickEventMeta,
  pickWebhookEventId,
  secretsMatch,
} from './parse';

/*
 * D2a webhook decision logic (the regression-prone surface): which payload field
 * holds the event id, which event types trigger a count re-pull, and the secret
 * gate. Pure — no DB, no session.
 */
describe('D2a — webhook secret gate', () => {
  it('matches identical secrets, rejects mismatches and length diffs', () => {
    expect(secretsMatch('s3cr3t', 's3cr3t')).toBe(true);
    expect(secretsMatch('s3cr3t', 'wrong!')).toBe(false); // same length, diff
    expect(secretsMatch('short', 'longer-secret')).toBe(false); // length diff
    expect(secretsMatch('', '')).toBe(true);
  });
});

describe('D2a — which webhook events refresh the count', () => {
  it('order.* and issued_ticket.* trigger a count re-pull', () => {
    expect(isCountRefreshEvent('order.created')).toBe(true);
    expect(isCountRefreshEvent('order.updated')).toBe(true);
    expect(isCountRefreshEvent('issued_ticket.created')).toBe(true);
    expect(isCountRefreshEvent('issued_ticket.updated')).toBe(true);
  });

  it('event.* and junk do NOT trigger a count re-pull', () => {
    expect(isCountRefreshEvent('event.created')).toBe(false);
    expect(isCountRefreshEvent('order')).toBe(false); // no dot
    expect(isCountRefreshEvent('')).toBe(false);
  });

  it('event.* is recognized as a metadata event', () => {
    expect(isEventMetaEvent('event.created')).toBe(true);
    expect(isEventMetaEvent('event.deleted')).toBe(true);
    expect(isEventMetaEvent('order.created')).toBe(false);
  });
});

describe('D2a — resolving the event id from TT payload shapes', () => {
  it('reads event_id / event.id / order.event_id / issued_ticket.event_id', () => {
    expect(pickWebhookEventId({ event_id: 'ev_1' })).toBe('ev_1');
    expect(pickWebhookEventId({ event: { id: 'ev_2' } })).toBe('ev_2');
    expect(pickWebhookEventId({ order: { event_id: 'ev_3' } })).toBe('ev_3');
    expect(pickWebhookEventId({ issued_ticket: { event_id: 'ev_4' } })).toBe(
      'ev_4',
    );
    expect(pickWebhookEventId({ id: 'order_99' })).toBeUndefined(); // order id, not event id
    expect(pickWebhookEventId({})).toBeUndefined();
  });

  it('event-meta extraction treats the object itself as the event', () => {
    expect(
      pickEventMeta({
        id: 'ev_5',
        name: 'Fozzy',
        start: { date: '2026-07-01' },
      }),
    ).toEqual({ id: 'ev_5', name: 'Fozzy', event_date: '2026-07-01' });
    expect(pickEventMeta({ event: { id: 'ev_6' } })).toEqual({
      id: 'ev_6',
      name: null,
      event_date: null,
    });
    expect(pickEventMeta({})).toBeNull();
  });
});
