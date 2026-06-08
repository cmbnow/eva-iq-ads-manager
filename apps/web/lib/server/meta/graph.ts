import 'server-only';

/**
 * Meta Graph API — server-only read helpers (account discovery, §4.3).
 * Called with the tenant's scoped token (fetched server-side from Vault). Never
 * imported by client code.
 */

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v21.0';
const BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export type MetaAdAccount = {
  meta_account_id: string; // numeric id, e.g. "1621147768656226"
  name: string;
  account_status: number; // 1 = ACTIVE
};

/**
 * List the ad accounts the connected user can access. Multi-account is the norm.
 */
export async function fetchAdAccounts(token: string): Promise<MetaAdAccount[]> {
  const out: MetaAdAccount[] = [];
  let next: string | null = (() => {
    const u = new URL(`${BASE}/me/adaccounts`);
    u.searchParams.set('fields', 'account_id,name,account_status');
    u.searchParams.set('limit', '200');
    u.searchParams.set('access_token', token);
    return u.toString();
  })();

  // Follow paging defensively (capped) so large partners aren't truncated silently.
  for (let page = 0; page < 10 && next; page++) {
    const r = await fetch(next, { cache: 'no-store' });
    if (!r.ok) throw new Error(`adaccounts fetch failed (${r.status})`);
    const j = (await r.json()) as {
      data?: { account_id: string; name?: string; account_status?: number }[];
      paging?: { next?: string };
    };
    for (const a of j.data ?? []) {
      out.push({
        meta_account_id: a.account_id,
        name: a.name ?? a.account_id,
        account_status: a.account_status ?? 0,
      });
    }
    next = j.paging?.next ?? null;
  }
  return out;
}

/* ===========================================================================
 * WRITE helpers + audience/page/pixel reads (publishing). Every call takes the
 * tenant token; POST bodies are form-encoded with access_token. Everything is
 * created PAUSED (see status fields below).
 * ======================================================================== */

/* eslint-disable @typescript-eslint/no-explicit-any */
type GraphPost = Record<string, string | number>;

async function graphPost(path: string, token: string, body: GraphPost): Promise<any> {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) form.set(k, String(v));
  form.set('access_token', token);
  const r = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    body: form,
    cache: 'no-store',
  });
  const j = await r.json();
  if (!r.ok) {
    const msg =
      j?.error?.error_user_msg || j?.error?.message || `Graph error (${r.status})`;
    throw new Error(msg);
  }
  return j;
}

async function graphGet(path: string, token: string): Promise<any> {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(`${BASE}/${path}${sep}access_token=${encodeURIComponent(token)}`, {
    cache: 'no-store',
  });
  const j = await r.json();
  if (!r.ok) {
    const msg =
      j?.error?.error_user_msg || j?.error?.message || `Graph error (${r.status})`;
    throw new Error(msg);
  }
  return j;
}

// --- Reads for the audience builder ---
export async function fetchPages(token: string): Promise<{ id: string; name: string }[]> {
  const j = await graphGet('me/accounts?fields=id,name&limit=200', token);
  return (j.data ?? []).map((p: any) => ({ id: p.id, name: p.name ?? p.id }));
}

export async function fetchPixels(
  token: string,
  act: string,
): Promise<{ id: string; name: string }[]> {
  const j = await graphGet(`act_${act}/adspixels?fields=id,name&limit=200`, token);
  return (j.data ?? []).map((p: any) => ({ id: p.id, name: p.name ?? p.id }));
}

export async function fetchCustomAudiences(
  token: string,
  act: string,
): Promise<
  { id: string; name: string; subtype: string; approximate_count: number | null }[]
> {
  const j = await graphGet(
    `act_${act}/customaudiences?fields=id,name,subtype,approximate_count_lower_bound&limit=200`,
    token,
  );
  return (j.data ?? []).map((a: any) => ({
    id: a.id,
    name: a.name ?? a.id,
    subtype: a.subtype ?? '',
    approximate_count: a.approximate_count_lower_bound ?? null,
  }));
}

// --- Image upload → returns the hash used by the creative ---
export async function uploadAdImage(
  token: string,
  act: string,
  bytesB64: string,
): Promise<string> {
  const j = await graphPost(`act_${act}/adimages`, token, { bytes: bytesB64 });
  const images = j.images ?? {};
  const first = Object.values(images)[0] as { hash?: string } | undefined;
  if (!first?.hash) throw new Error('Image upload returned no hash.');
  return first.hash;
}

// --- Write helpers (all PAUSED) ---
export async function createCampaign(
  token: string,
  act: string,
  p: { name: string; sacCategories: string[] },
): Promise<string> {
  const j = await graphPost(`act_${act}/campaigns`, token, {
    name: p.name,
    objective: 'OUTCOME_SALES',
    status: 'PAUSED',
    special_ad_categories: JSON.stringify(p.sacCategories), // [] when non-SAC
  });
  return j.id;
}

export async function createAdSet(
  token: string,
  act: string,
  p: {
    name: string;
    campaignId: string;
    dailyBudgetMinor: number;
    pixelId: string;
    targeting: object;
    bidCapMinor?: number;
  },
): Promise<string> {
  const body: GraphPost = {
    name: p.name,
    campaign_id: p.campaignId,
    daily_budget: p.dailyBudgetMinor,
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'OFFSITE_CONVERSIONS',
    promoted_object: JSON.stringify({
      pixel_id: p.pixelId,
      custom_event_type: 'INITIATE_CHECKOUT',
    }),
    targeting: JSON.stringify(p.targeting),
    status: 'PAUSED',
    bid_strategy: p.bidCapMinor
      ? 'LOWEST_COST_WITH_BID_CAP'
      : 'LOWEST_COST_WITHOUT_CAP',
  };
  if (p.bidCapMinor) body.bid_amount = p.bidCapMinor;
  const j = await graphPost(`act_${act}/adsets`, token, body);
  return j.id;
}

export async function createCreative(
  token: string,
  act: string,
  p: {
    name: string;
    pageId: string;
    link: string;
    message: string;
    headline: string;
    description: string;
    cta: string;
    imageHash: string;
  },
): Promise<string> {
  const object_story_spec = {
    page_id: p.pageId,
    link_data: {
      link: p.link,
      message: p.message,
      name: p.headline,
      description: p.description,
      image_hash: p.imageHash,
      call_to_action: { type: p.cta || 'LEARN_MORE', value: { link: p.link } },
    },
  };
  const j = await graphPost(`act_${act}/adcreatives`, token, {
    name: p.name,
    object_story_spec: JSON.stringify(object_story_spec),
  });
  return j.id;
}

export async function createAd(
  token: string,
  act: string,
  p: { name: string; adsetId: string; creativeId: string },
): Promise<string> {
  const j = await graphPost(`act_${act}/ads`, token, {
    name: p.name,
    adset_id: p.adsetId,
    creative: JSON.stringify({ creative_id: p.creativeId }),
    status: 'PAUSED',
  });
  return j.id;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
