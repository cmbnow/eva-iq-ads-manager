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
