'use server';

import { callClaude, extractJson, getTenantContext } from '~/lib/server/ai';

import { evaluateApproval } from './approval';

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
  profitabilityRunId: string | null;
  createdAt: string;
};

/** Whether this tenant's Meta account can publish via API (else advisor mode). */
export async function getMetaEnablement(): Promise<{
  enabled: boolean;
  accountId: string | null;
  pixelId: string | null;
  sac: string;
}> {
  const { supabase, tenant } = await getTenantContext();
  if (!tenant) return { enabled: false, accountId: null, pixelId: null, sac: 'none' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const [{ data: conn }, { data: acct }] = await Promise.all([
    supabase
      .from('tenant_platform_connections')
      .select('is_enabled, external_account_id')
      .eq('tenant_id', tenant.id)
      .eq('platform', 'meta')
      .limit(1),
    db
      .from('ad_accounts')
      .select('meta_account_id, pixel_id, is_ads_mcp_enabled')
      .eq('tenant_id', tenant.id)
      .eq('is_selected', true)
      .maybeSingle(),
  ]);
  const c = conn?.[0];
  // The publish gate is the SELECTED ad account's is_ads_mcp_enabled; fall back to
  // the connection's is_enabled (selectAdAccount keeps them in sync).
  const enabled = Boolean(acct?.is_ads_mcp_enabled ?? c?.is_enabled);
  return {
    enabled,
    accountId:
      (acct?.meta_account_id as string) ?? (c?.external_account_id as string) ?? null,
    pixelId: (acct?.pixel_id as string) ?? null,
    sac: tenant.special_ad_category ?? 'none',
  };
}

export async function generateAdDraft(input: {
  brief: string;
  showSummary?: string;
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
        content: `Create a new Meta ad based on this: ${input.brief}${
          input.showSummary
            ? `\n\nProfitability constraints (fit the ad's objective, audience, and expectations to this): ${input.showSummary}. In "buildSteps", include setting the campaign budget to the recommended amount and keeping cost-per-purchase under the early CPA target.`
            : ''
        }\n\nReturn ONLY the JSON.`,
      },
    ],
  });

  if (!res.ok) return { ok: false, error: res.error };
  try {
    const draft = JSON.parse(extractJson(res.text)) as AdDraft;
    draft.headlines ??= [];
    draft.descriptions ??= [];
    draft.buildSteps ??= [];
    // A new ad set paces 0 sales/week, so the objective is fixed (the published
    // ad set already hardcodes custom_event_type: INITIATE_CHECKOUT). Don't let
    // the displayed/stored objective say otherwise.
    draft.objective = 'Sales · optimize for Initiate Checkout';
    return { ok: true, draft };
  } catch {
    return { ok: false, error: 'Claude returned an unexpected format. Try again.' };
  }
}

export async function saveDraft(
  draft: AdDraft,
  opts?: { profitabilityRunId?: string | null; budgetDaily?: number | null },
): Promise<{ id: string } | { error: string }> {
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
      // Linked profitability run + its MRMC-gated daily budget (drives publish).
      profitability_run_id: opts?.profitabilityRunId ?? null,
      budget_daily: opts?.budgetDaily ?? null,
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
    .select('id, name, status, objective, copy, budget_daily, profitability_run_id, created_at')
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
    profitabilityRunId: (c.profitability_run_id as string) ?? null,
    createdAt: String(c.created_at),
  }));
}

/** Advance a campaign's status. Approval is GATED on a profit basis (a linked
 * Show Engine run) and the MRMC ceiling. Publishing has ONE path: publishCampaign. */
export async function setCampaignStatus(
  id: string,
  status: 'pending_approval' | 'approved' | 'published',
  opts?: { override?: boolean; reason?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, user, tenant } = await getTenantContext();
  if (!tenant) return { ok: false, error: 'No client found.' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // One publish path: publishCampaign sets 'published' after a real Meta publish.
  if (status === 'published') {
    return {
      ok: false,
      error:
        'Use Publish to push this ad to Meta — status is set automatically after it succeeds.',
    };
  }

  // Profit gate: no approval without a linked run, and no budget over MRMC unless
  // explicitly overridden with a logged reason.
  if (status === 'approved') {
    const { data: row } = await db
      .from('campaigns')
      .select('profitability_run_id')
      .eq('id', id)
      .single();

    // Only query the run when one is linked (don't hit show_analyses with a null
    // id). The no-run case is handled by evaluateApproval below.
    let mrmc = 0;
    let recommended = 0;
    if (row?.profitability_run_id) {
      const { data: run } = await db
        .from('show_analyses')
        .select('result')
        .eq('id', row.profitability_run_id)
        .single();

      const result = (run?.result ?? {}) as {
        mrmc?: number;
        budget_tiers?: { total_budget: number }[];
      };
      mrmc = Number(result.mrmc ?? 0);
      recommended = Number(result.budget_tiers?.[1]?.total_budget ?? 0);
    }

    const decision = evaluateApproval({
      profitabilityRunId: row?.profitability_run_id ?? null,
      mrmc,
      recommendedBudget: recommended,
      override: opts?.override,
    });
    if (!decision.ok) return { ok: false, error: decision.error };
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
    detail:
      status === 'approved'
        ? { override: opts?.override ?? false, reason: opts?.reason ?? null }
        : {},
  });

  return { ok: true };
}
