import 'server-only';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

export type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: { type: 'base64'; media_type: string; data: string };
    }
  | {
      type: 'document';
      source: { type: 'base64'; media_type: 'application/pdf'; data: string };
    };

export type ClaudeMessage = {
  role: 'user' | 'assistant';
  content: string | ClaudeContentBlock[];
};

export const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Resolve the current user + their active tenant (first/Foundry for now). */
export async function getTenantContext() {
  const supabase = getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase
    .from('tenants')
    .select('id, name, special_ad_category, vertical')
    .order('created_at', { ascending: true })
    .limit(1);
  return { supabase, user, tenant: data?.[0] ?? null };
}

export type ClaudeResult =
  | { ok: true; text: string; tokensIn: number; tokensOut: number }
  | { ok: false; error: string };

/**
 * Single entry point for all Claude calls. Records token usage per
 * tenant/user/feature (best-effort) so we can report cost per client.
 */
export async function callClaude(opts: {
  system: string;
  messages: ClaudeMessage[];
  feature: string;
  model?: string;
  maxTokens?: number;
}): Promise<ClaudeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'Missing ANTHROPIC_API_KEY on the server.' };
  }

  const model = opts.model ?? DEFAULT_MODEL;

  let response: Response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 1024,
        system: opts.system,
        messages: opts.messages,
      }),
    });
  } catch {
    return { ok: false, error: 'Could not reach the Claude API.' };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return {
      ok: false,
      error: `Claude API error (${response.status}). ${detail.slice(0, 200)}`,
    };
  }

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const text = (data.content ?? []).map((b) => b.text ?? '').join('').trim();
  const tokensIn = data.usage?.input_tokens ?? 0;
  const tokensOut = data.usage?.output_tokens ?? 0;

  // Record usage (best-effort — never block the response on tracking).
  try {
    const { supabase, user, tenant } = await getTenantContext();
    if (tenant) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('usage_events').insert({
        tenant_id: tenant.id,
        user_id: user?.id ?? null,
        feature: opts.feature,
        model,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
      });
    }
  } catch {
    /* ignore tracking errors */
  }

  return { ok: true, text, tokensIn, tokensOut };
}

export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) return text.slice(start, end + 1);
  return text;
}
