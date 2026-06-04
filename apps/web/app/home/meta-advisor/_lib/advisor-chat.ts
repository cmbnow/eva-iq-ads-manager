'use server';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export type PlanStep = { title: string; detail: string };

export type AdContext = {
  adName: string;
  adSet: string;
  spend: number;
  dailySpend: number;
  purchases: number;
  roas: number;
  costPerPurchase: number | null;
  frequency: number;
  optimizingFor: string;
  recommendation: string;
  endsDate: string;
  daysUntilEnd: number | null;
};

export type AccountContext = {
  period: string;
  blendedRoas: number;
  blendedCostPerPurchase: number | null;
  totalSpend: number;
};

export type AskResult = { ok: true; reply: string } | { ok: false; error: string };
export type PlanResult =
  | { ok: true; steps: PlanStep[]; bottomLine: string }
  | { ok: false; error: string };

const MODEL = 'claude-sonnet-4-6';

function buildSystem(ad: AdContext, account: AccountContext): string {
  return `You are EVA IQ, a Meta ads advisor for "The Foundry at Basic City Beer Co." — a live-music venue & hospitality space in Waynesboro, VA that sells event tickets (SeeTickets / TicketTailor). It uses FIRST-PARTY audiences only (past buyers, SeeTickets buyers, Hive buyers, and 1% lookalikes seeded from them) — never third-party/purchased data.

You advise the venue's owner, who is NOT technical. Be warm, plain-spoken, CONCISE, and CONCRETE.

MONEY RULE (critical):
- Whenever you suggest a budget change, give the EXACT new daily budget in DOLLARS, computed from the ad's recent daily spend. Never say a percentage.
- SCALE GRADUALLY: never increase a daily budget by more than ~30–40% in a single step. Larger jumps reset Meta's learning phase and can tank a winning ad — so step it up over time. Example: if it's at ~$1/day, recommend "raise to about $1.30/day" (not $3/day), then step up again in a week. If it's at ~$8/day, recommend ~$10–11/day.
- BE PRECISE: never exaggerate a number. If cost/purchase is $2.74 against an $8 target, that's "about 3x under target," not 4x. Double-check every multiple and dollar figure.

TIMELINE RULE (critical): Tailor advice to the days remaining. If the event ends within ~4 days, do NOT recommend producing new creative or multi-day check-ins — there's no time. Instead: adjust budget on what's converting, ride the final push, and capture these buyers as a first-party seed for the NEXT event's lookalike. Only suggest new creative / A-B tests when there's a week+ of runway.

SELECTED AD
- Name: ${ad.adName}
- Ad set / audience: ${ad.adSet}
- Total spend this period: $${ad.spend.toFixed(2)}
- Recent daily spend: ~$${ad.dailySpend.toFixed(2)}/day
- Purchases: ${ad.purchases}
- ROAS: ${ad.roas.toFixed(2)}x
- Cost per purchase: ${ad.costPerPurchase !== null ? '$' + ad.costPerPurchase.toFixed(2) : 'n/a'}
- Frequency: ${ad.frequency.toFixed(2)}
- Optimizing for: ${ad.optimizingFor}
- Event/ad ENDS: ${ad.endsDate || 'unknown'}${
    ad.daysUntilEnd !== null
      ? ` (${ad.daysUntilEnd <= 0 ? 'today or already over' : ad.daysUntilEnd + ' day(s) from now'})`
      : ''
  }

ACCOUNT (context): period ${account.period}, blended ROAS ${account.blendedRoas.toFixed(2)}x, blended cost/purchase ${account.blendedCostPerPurchase !== null ? '$' + account.blendedCostPerPurchase.toFixed(2) : 'n/a'}, total spend $${account.totalSpend.toFixed(2)}.

Benchmarks: cost/purchase target under $8; frequency under 3.0 (above = fatigue); ROAS 10x+ is strong for this venue.`;
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) return text.slice(start, end + 1);
  return text;
}

async function callClaude(body: object): Promise<
  { ok: true; text: string } | { ok: false; error: string }
> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: 'Missing ANTHROPIC_API_KEY on the server.' };

  let response: Response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: 'Could not reach the Claude API.' };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { ok: false, error: `Claude API error (${response.status}). ${detail.slice(0, 200)}` };
  }

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = data.content?.map((b) => b.text ?? '').join('').trim() ?? '';
  return { ok: true, text };
}

/** Structured, checkbox-ready action plan for a single ad. */
export async function getPlan(params: {
  ad: AdContext;
  account: AccountContext;
}): Promise<PlanResult> {
  const res = await callClaude({
    model: MODEL,
    max_tokens: 1200,
    system: buildSystem(params.ad, params.account),
    messages: [
      {
        role: 'user',
        content:
          'Give me a step-by-step action plan for THIS ad as JSON ONLY (no markdown, no fences) matching exactly: {"steps":[{"title":string,"detail":string}],"bottomLine":string}. 3–6 steps. Each "title" is a short concrete action the owner can check off (include EXACT dollar budgets where relevant, never percentages). Each "detail" is one plain sentence of why/how. "bottomLine" is one sentence.',
      },
    ],
  });

  if (!res.ok) return { ok: false, error: res.error };

  try {
    const parsed = JSON.parse(extractJson(res.text)) as {
      steps?: PlanStep[];
      bottomLine?: string;
    };
    return {
      ok: true,
      steps: Array.isArray(parsed.steps) ? parsed.steps : [],
      bottomLine: parsed.bottomLine ?? '',
    };
  } catch {
    return { ok: false, error: 'Claude returned an unexpected format. Try again.' };
  }
}

/** Free-form Q&A about the ad. Aware of which plan steps are already done. */
export async function askAdvisor(params: {
  ad: AdContext;
  account: AccountContext;
  messages: ChatMessage[];
  doneSteps?: string[];
}): Promise<AskResult> {
  let system = buildSystem(params.ad, params.account);
  if (params.doneSteps && params.doneSteps.length) {
    system += `\n\nPROGRESS: The owner has already completed these steps: ${params.doneSteps
      .map((s) => `"${s}"`)
      .join(', ')}. Do not tell them to redo these — build on them.`;
  }

  const res = await callClaude({
    model: MODEL,
    max_tokens: 1024,
    system,
    messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
  });

  if (!res.ok) return { ok: false, error: res.error };
  if (!res.text) return { ok: false, error: 'Claude returned an empty reply. Try again.' };
  return { ok: true, reply: res.text };
}
