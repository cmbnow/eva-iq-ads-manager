'use server';

import { callClaude, extractJson, getTenantContext } from '~/lib/server/ai';

export type AdDraft = {
  name: string;
  objective: string;
  primaryText: string;
  headlines: string[];
  descriptions: string[];
  cta: string;
  creativeBrief: string;
  targeting: string;
  buildSteps: string[];
};

export type GenerateResult =
  | { ok: true; draft: AdDraft }
  | { ok: false; error: string };

export type CampaignRow = {
  id: string;
  name: string;
  status: string;
  objective: string | null;
  copy: AdDraft | Record<string, unknown>;
  budgetDaily: number | null;
  createdAt: string;
};

/** Whether this tenant's Meta account can publish via API (else advisor mode). */
export async function getMetaEnablement(): Promise<{
  enabled: boolean;
  accountId: string | null;
}> {
  const { supabase, tenant } = await getTenantContext();
  if (!tenant) return { enabled: false, accountId: null };
  const { data } = await supabase
    .from('tenant_platform_connections')
    .select('is_enabled, external_account_id')
    .eq('tenant_id', tenant.id)
    .eq('platform', 'meta')
    .limit(1);
  const c = data?.[0];
  return {
    enabled: Boolean(c?.is_enabled),
    accountId: (c?.external_account_id as string) ?? null,
  };
}

export async function generateAdDraft(input: {
  brief: string;
}): Promise<GenerateResult> {
  const { tenant } = await getTenantContext();
  const sac = tenant?.special_ad_category ?? 'none';
  const isSac = sac !== 'none';

  const system = `You are EVA IQ's senior ad creative + strategist for "${tenant?.name ?? 'the client'}" (vertical: ${tenant?.vertical ?? 'n/a'}). First-party audiences only. Write a complete, ready-to-build Meta ad.

${
    isSac
      ? `SPECIAL AD CATEGORY: ${sac}. ENFORCE compliant mode — NO lookalikes, NO narrow targeting, 15-mile minimum radius, age 18–65+, broad Advantage+ delivery, creative-as-targeting. ${sac === 'financial' ? 'Financial: no rate/return claims without standardized risk-warning templates; refuse non-compliant claims.' : ''}`
      : 'Standard (non-SAC): first-party seed → 1% lookalike audiences are allowed.'
  }

Keep copy within Meta limits: primary text punchy (~125 chars ideal), headlines <40 chars, descriptions <30 chars. Return ONLY valid minified JSON (no markdown/fences) matching exactly:
{"name":string,"objective":string,"primaryText":string,"headlines":string[],"descriptions":string[],"cta":string,"creativeBrief":string,"targeting":string,"buildSteps":string[]}`;

  const res = await callClaude({
    feature: 'composer',
    maxTokens: 1500,
    system,
    messages: [
      {
        role: 'user',
        content: `Create a new Meta ad based on this: ${input.brief}\n\nReturn ONLY the JSON.`,
      },
    ],
  });

  if (!res.ok) return { ok: false, error: res.error };
  try {
    const draft = JSON.parse(extractJson(res.text)) as AdDraft;
    draft.headlines ??= [];
    draft.descriptions ??= [];
    draft.buildSteps ??= [];
    return { ok: true, draft };
  } catch {
    return { ok: false, error: 'Claude returned an unexpected format. Try again.' };
  }
}

export async function saveDraft(draft: AdDraft): Promise<{ id: string } | { error: string }> {
  const { supabase, user, tenant } = await getTenantContext();
  if (!tenant) return { error: 'No client found.' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = await db
    .from('campaigns')
    .insert({
      tenant_id: tenant.id,
      platform: 'meta',
      name: draft.name || 'Untitled ad',
      objective: draft.objective ?? null,
      status: 'draft',
      copy: draft,
      build_steps: draft.buildSteps ?? [],
      special_ad_category: tenant.special_ad_category ?? 'none',
      created_by: user?.id ?? null,
    })
    .select('id')
    .single();

  if (error || !data) return { error: 'Could not save the draft.' };

  await db.from('campaign_audit_log').insert({
    tenant_id: tenant.id,
    campaign_id: data.id,
    user_id: user?.id ?? null,
    action: 'draft_created',
    detail: { name: draft.name },
  });

  return { id: String(data.id) };
}

export async function listCampaigns(): Promise<CampaignRow[]> {
  const { supabase, tenant } = await getTenantContext();
  if (!tenant) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data } = await db
    .from('campaigns')
    .select('id, name, status, objective, copy, budget_daily, created_at')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false })
    .limit(50);
  return (data ?? []).map((c: Record<string, unknown>) => ({
    id: String(c.id),
    name: String(c.name),
    status: String(c.status),
    objective: (c.objective as string) ?? null,
    copy: (c.copy as AdDraft) ?? {},
    budgetDaily: c.budget_daily != null ? Number(c.budget_daily) : null,
    createdAt: String(c.created_at),
  }));
}

/** Advance a campaign's status. Publishing is GATED on Meta enablement. */
export async function setCampaignStatus(
  id: string,
  status: 'pending_approval' | 'approved' | 'published',
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, user, tenant } = await getTenantContext();
  if (!tenant) return { ok: false, error: 'No client found.' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  if (status === 'published') {
    const meta = await getMetaEnablement();
    if (!meta.enabled) {
      return {
        ok: false,
        error:
          'Live publishing is gated: this Meta account is not API-enabled yet (advisor mode). Use the build steps to publish manually, or wait for Meta Advanced Access.',
      };
    }
    // TODO: when enabled, call Meta Marketing API here to publish, then store external_id.
  }

  const patch: Record<string, unknown> = { status };
  if (status === 'approved') {
    patch.approved_by = user?.id ?? null;
    patch.approved_at = new Date().toISOString();
  }

  const { error } = await db.from('campaigns').update(patch).eq('id', id);
  if (error) return { ok: false, error: 'Could not update the campaign.' };

  await db.from('campaign_audit_log').insert({
    tenant_id: tenant.id,
    campaign_id: id,
    user_id: user?.id ?? null,
    action: `status_${status}`,
    detail: {},
  });

  return { ok: true };
}
