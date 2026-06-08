'use server';

import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { getTenantContext } from '~/lib/server/ai';
import {
  createAd,
  createAdSet,
  createCampaign,
  createCreative,
  uploadAdImage,
} from '~/lib/server/meta/graph';

import { type AudienceSpec, buildTargeting, mapSac } from './targeting';

export type { AudienceSpec };

export type PublishResult =
  | { ok: true; metaCampaignId: string }
  | { ok: false; error: string };

export async function publishCampaign(input: {
  campaignId: string;
  audience: AudienceSpec;
  pageId: string;
  ticketLink: string;
  imageB64: string; // creative image bytes (base64)
}): Promise<PublishResult> {
  const { supabase, user, tenant } = await getTenantContext();
  if (!tenant) return { ok: false, error: 'No client found.' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // 1. Approval gate — approved + a linked profitability run.
  const { data: campaign } = await db
    .from('campaigns')
    .select('id, name, status, copy, budget_daily, profitability_run_id, special_ad_category')
    .eq('id', input.campaignId)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (!campaign) return { ok: false, error: 'Campaign not found.' };
  if (campaign.status !== 'approved' || !campaign.profitability_run_id) {
    return { ok: false, error: 'Approve the ad (with a linked run) first.' };
  }

  // 2. Selected ad account must be API-enabled (else advisor mode — Foundry path).
  const { data: account } = await db
    .from('ad_accounts')
    .select('meta_account_id, pixel_id, is_ads_mcp_enabled')
    .eq('tenant_id', tenant.id)
    .eq('is_selected', true)
    .maybeSingle();
  if (!account || !account.is_ads_mcp_enabled) {
    return {
      ok: false,
      error:
        "This client's Meta account is in advisor mode — publishing is off. Use the build steps to publish manually.",
    };
  }

  // 3. Pixel required for conversion-optimized ads.
  if (!account.pixel_id) {
    return {
      ok: false,
      error:
        'No Meta pixel on this account — add one before publishing conversion-optimized ads.',
    };
  }

  // 4. Token (service_role-only Vault decrypt).
  const admin = getSupabaseServerAdminClient();
  const { data: token } = await (
    admin as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: string | null; error: unknown }>;
    }
  ).rpc('get_meta_token', { p_tenant: tenant.id });
  if (!token) return { ok: false, error: 'Reconnect Meta.' };

  // 5. Account + SAC.
  const act = String(account.meta_account_id);
  const sac = tenant.special_ad_category ?? 'none';
  const sacCategories = mapSac(sac);

  // Linked run → bid-cap ceiling (budget already MRMC-gated on the campaign row).
  const { data: run } = await db
    .from('show_analyses')
    .select('result')
    .eq('id', campaign.profitability_run_id)
    .maybeSingle();
  const ceiling = run?.result?.cpa_guardrails?.ceiling as number | undefined;

  const copy = (campaign.copy ?? {}) as {
    primaryText?: string;
    headlines?: string[];
    descriptions?: string[];
    cta?: string;
    name?: string;
  };
  const budgetDaily = Number(campaign.budget_daily ?? 0);
  if (!budgetDaily) {
    return {
      ok: false,
      error: 'This draft has no daily budget from its profitability run.',
    };
  }

  try {
    // 6. Image → hash.
    const imageHash = await uploadAdImage(token, act, input.imageB64);

    // 7. Campaign (PAUSED).
    const metaCampaignId = await createCampaign(token, act, {
      name: campaign.name || 'EVA IQ campaign',
      sacCategories,
    });

    // 8. Ad set (PAUSED) — budget in MINOR units; SAC-enforced targeting.
    const targeting = buildTargeting(input.audience, sac);
    const adsetId = await createAdSet(token, act, {
      name: `${campaign.name} — ad set`,
      campaignId: metaCampaignId,
      dailyBudgetMinor: Math.round(budgetDaily * 100),
      pixelId: String(account.pixel_id),
      targeting,
      bidCapMinor: ceiling ? Math.round(ceiling * 100) : undefined,
    });

    // 9. Creative.
    const cta = (copy.cta ?? '').trim().toUpperCase().replace(/\s+/g, '_');
    const creativeId = await createCreative(token, act, {
      name: `${campaign.name} — creative`,
      pageId: input.pageId,
      link: input.ticketLink,
      message: copy.primaryText ?? '',
      headline: copy.headlines?.[0] ?? campaign.name,
      description: copy.descriptions?.[0] ?? '',
      cta: cta || 'LEARN_MORE',
      imageHash,
    });

    // 10. Ad (PAUSED).
    const adId = await createAd(token, act, {
      name: `${campaign.name} — ad`,
      adsetId,
      creativeId,
    });

    // 11. Persist publish result + audience/creative refs on the draft.
    await db
      .from('campaigns')
      .update({
        status: 'published',
        external_id: metaCampaignId,
        published_meta: {
          campaign: metaCampaignId,
          adset: adsetId,
          ad: adId,
          paused: true,
        },
        audience: input.audience,
        page_id: input.pageId,
        ticket_link: input.ticketLink,
        creative_image_ref: imageHash,
      })
      .eq('id', input.campaignId);

    // 12. Audit log.
    await db.from('campaign_audit_log').insert({
      tenant_id: tenant.id,
      campaign_id: input.campaignId,
      user_id: user?.id ?? null,
      action: 'published',
      detail: {
        meta_campaign_id: metaCampaignId,
        adset_id: adsetId,
        ad_id: adId,
        status: 'PAUSED',
      },
    });

    // 13.
    return { ok: true, metaCampaignId };
  } catch (e) {
    // A later-step failure leaves only PAUSED objects (no spend). Surface it.
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Publishing failed.',
    };
  }
}

// Page / audience reads for the composer (server actions; service_role token).
export async function listMetaPages(): Promise<{ id: string; name: string }[]> {
  const { tenant } = await getTenantContext();
  if (!tenant) return [];
  const admin = getSupabaseServerAdminClient();
  const { data: token } = await (
    admin as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: string | null }>;
    }
  ).rpc('get_meta_token', { p_tenant: tenant.id });
  if (!token) return [];
  const { fetchPages } = await import('~/lib/server/meta/graph');
  try {
    return await fetchPages(token);
  } catch {
    return [];
  }
}

export async function listCustomAudiences(): Promise<
  { id: string; name: string; subtype: string; approximate_count: number | null }[]
> {
  const { supabase, tenant } = await getTenantContext();
  if (!tenant) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: account } = await db
    .from('ad_accounts')
    .select('meta_account_id')
    .eq('tenant_id', tenant.id)
    .eq('is_selected', true)
    .maybeSingle();
  if (!account) return [];
  const admin = getSupabaseServerAdminClient();
  const { data: token } = await (
    admin as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: string | null }>;
    }
  ).rpc('get_meta_token', { p_tenant: tenant.id });
  if (!token) return [];
  const { fetchCustomAudiences } = await import('~/lib/server/meta/graph');
  try {
    return await fetchCustomAudiences(token, String(account.meta_account_id));
  } catch {
    return [];
  }
}
