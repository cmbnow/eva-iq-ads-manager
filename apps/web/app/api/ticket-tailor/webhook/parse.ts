import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Constant-time secret comparison (length-safe; never throws). */
export function secretsMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  try {
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

/**
 * Resolve the related TT event id from an order/issued_ticket webhook payload.
 * Deliberately does NOT fall back to payload.id — on an order payload that is the
 * ORDER id, not the event id.
 */
export function pickWebhookEventId(payload: any): string | undefined {
  const id =
    payload?.event_id ??
    payload?.event?.id ??
    payload?.order?.event_id ??
    payload?.issued_ticket?.event_id;
  return id != null ? String(id) : undefined;
}

/** order.* / issued_ticket.* change ticket counts -> re-pull total_issued. */
export function isCountRefreshEvent(eventType: string): boolean {
  return /^(order|issued_ticket)\./.test(eventType);
}

/** event.* change the event itself (name/date/existence) -> refresh metadata. */
export function isEventMetaEvent(eventType: string): boolean {
  return /^event\./.test(eventType);
}

/**
 * For an event.* webhook the object itself is the event — so here payload.id IS
 * the event id (unlike the order/ticket case above).
 */
export function pickEventMeta(
  payload: any,
): { id: string; name: string | null; event_date: string | null } | null {
  const ev = payload?.event ?? payload;
  const id = ev?.id ?? payload?.event_id;
  if (id == null) return null;
  return {
    id: String(id),
    name: ev?.name ?? null,
    event_date: ev?.start?.date ?? null,
  };
}
