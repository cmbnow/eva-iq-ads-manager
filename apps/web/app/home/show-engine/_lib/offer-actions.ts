'use server';

import { callClaude, extractJson, getTenantContext } from '~/lib/server/ai';

import { type AnalysisResult, type ShowInputs } from './offer-engine';
import { type WalkupResult, projectWalkup } from './walkup-projection';

export type SavedShow = {
  id: string;
  showName: string;
  showDate: string | null;
  dealScore: string | null;
  createdAt: string;
  inputs: ShowInputs;
  result: AnalysisResult;
};

export async function saveAnalysis(input: {
  showName: string;
  showDate: string | null;
  inputs: ShowInputs;
  result: AnalysisResult;
}): Promise<{ id: string } | { error: string }> {
  const { supabase, user, tenant } = await getTenantContext();
  if (!tenant) return { error: 'No client found.' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from('show_analyses')
    .insert({
      tenant_id: tenant.id,
      show_name: input.showName || 'Untitled show',
      show_date: input.showDate,
      inputs: input.inputs,
      result: input.result,
      deal_score: input.result.deal_score,
      created_by: user?.id ?? null,
    })
    .select('id')
    .single();
  if (error || !data) return { error: 'Could not save the analysis.' };
  return { id: String(data.id) };
}

export async function listAnalyses(): Promise<SavedShow[]> {
  const { supabase, tenant } = await getTenantContext();
  if (!tenant) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data } = await db
    .from('show_analyses')
    .select('id, show_name, show_date, deal_score, created_at, inputs, result')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false })
    .limit(50);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    showName: String(r.show_name),
    showDate: (r.show_date as string) ?? null,
    dealScore: (r.deal_score as string) ?? null,
    createdAt: String(r.created_at),
    inputs: r.inputs as ShowInputs,
    result: r.result as AnalysisResult,
  }));
}

export type ParsedOffer = Partial<ShowInputs> & {
  show_name?: string;
  show_date?: string;
};

/**
 * Best-effort extraction of offer-sheet fields from a PDF (or image).
 * The user MUST confirm/edit before the model runs — never auto-run.
 */
export async function parseOfferSheet(input: {
  data: string;
  mediaType: string;
}): Promise<{ ok: true; fields: ParsedOffer } | { ok: false; error: string }> {
  const isPdf = input.mediaType === 'application/pdf';
  const block = isPdf
    ? {
        type: 'document' as const,
        source: {
          type: 'base64' as const,
          media_type: 'application/pdf' as const,
          data: input.data,
        },
      }
    : {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: input.mediaType,
          data: input.data,
        },
      };

  const res = await callClaude({
    feature: 'offer_parse',
    maxTokens: 1200,
    system:
      'You extract structured fields from a live-music show offer sheet. Return ONLY valid JSON (no markdown) with any fields you can find: {"show_name":string,"show_date":"YYYY-MM-DD","venue_capacity":number,"avg_ticket_price":number,"offer_structure":"straight_guarantee|backend|hybrid|bonus_escalator","guarantee":number,"backend_promoter_share":number,"fixed_show_expenses":number,"bonus_tiers":[{"from_attendance":number,"to_attendance":number,"bonus_paid":number}],"conservative_attendance":number,"target_attendance":number,"sellout_attendance":number}. Omit fields you cannot determine. Do not guess wildly — only include values clearly supported by the sheet.',
    messages: [
      {
        role: 'user',
        content: [
          block,
          {
            type: 'text',
            text: 'Extract the offer fields as JSON only. This will be shown to a human to confirm before any calculation runs.',
          },
        ],
      },
    ],
  });

  if (!res.ok) return { ok: false, error: res.error };
  try {
    return {
      ok: true,
      fields: JSON.parse(extractJson(res.text)) as ParsedOffer,
    };
  } catch {
    return {
      ok: false,
      error: 'Could not read that sheet. Enter the fields manually.',
    };
  }
}

/** Whole days from local midnight today to a YYYY-MM-DD date (never negative). */
function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const event = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(event.getTime())) return 0;
  return Math.max(0, Math.ceil((event.getTime() - today.getTime()) / 86400000));
}

/**
 * B1: live walk-up projection for a show, using the tenant's Ticket Tailor data.
 * There is no show↔TT-event link table yet (a later item), and B1 adds no
 * migration — so v1 associates a show to a TT event by matching event_date.
 * Returns null when there's no tenant, no date, or no matching TT event.
 */
export async function getWalkupForShow(input: {
  showDate: string | null;
  target_attendance: number;
  sellout_attendance: number;
}): Promise<WalkupResult | null> {
  if (!input.showDate) return null;
  const { supabase, tenant } = await getTenantContext();
  if (!tenant) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data } = await db
    .from('ticket_tailor_events')
    .select('total_issued, event_date')
    .eq('tenant_id', tenant.id)
    .eq('event_date', input.showDate)
    .limit(1)
    .maybeSingle();
  if (!data || data.event_date == null) return null;

  return projectWalkup({
    tickets_sold: Number(data.total_issued ?? 0),
    days_remaining: daysUntil(String(data.event_date)),
    target_attendance: input.target_attendance,
    sellout_attendance: input.sellout_attendance,
  });
}
