'use server';

import { callClaude, extractJson } from '~/lib/server/ai';

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
  adSetWeeklyPurchases: number;
  icSwitchQualifies: boolean;
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

function buildSystem(ad: AdContext, account: AccountContext): string {
  return `You are EVA IQ, a Meta ads advisor for "The Foundry at Basic City Beer Co." — a live-music venue & hospitality space in Waynesboro, VA that sells event tickets (SeeTickets / TicketTailor). It uses FIRST-PARTY audiences only (past buyers, SeeTickets buyers, Hive buyers, and 1% lookalikes seeded from them) — never third-party/purchased data.

You advise the venue's owner, who is NOT technical. Be warm, plain-spoken, CONCISE, and CONCRETE.

MONEY RULE (critical):
- Whenever you suggest a budget change, give the EXACT new daily budget in DOLLARS, computed from the ad's recent daily spend. Never say a percentage.
- SCALE GRADUALLY: never increase a daily budget by more than ~30–40% in a single step. Larger jumps reset Meta's learning phase and can tank a winning ad — so step it up over time. Example: if it's at ~$1/day, recommend "raise to about $1.30/day" (not $3/day), then step up again in a week. If it's at ~$8/day, recommend ~$10–11/day.
- BE PRECISE: never exaggerate a number. If cost/purchase is $2.74 against an $8 target, that's "about 3x under target," not 4x. Double-check every multiple and dollar figure.

INITIATE-CHECKOUT vs PURCHASE RULE (critical, non-negotiable):
- This account optimizes ad sets on Initiate Checkout until a SINGLE AD SET reaches ~50 Purchase events in a rolling 7-day window. ONLY then switch THAT ad set to Purchase optimization.
- The 50/week threshold is PER AD SET — never account-wide, never multi-week totals.
- THIS ad set is pacing ~${(ad.adSetWeeklyPurchases ?? 0).toFixed(1)} purchases/week, which ${ad.icSwitchQualifies ? 'CLEARS' : 'does NOT clear'} the 50/week threshold.${
    ad.icSwitchQualifies
      ? ' So a switch to Purchase optimization is justified for this ad set.'
      : ' So you MUST hold on Initiate Checkout. Do NOT recommend switching to Purchase, no matter how high the raw purchase count looks.'
  }
- NEVER give generic "you have enough purchases, switch to Purchase" advice.

TIMELINE RULE: Tailor advice to the days remaining. If the event ends within ~4 days, do NOT recommend producing new creative or multi-day check-ins — there's no time. Instead adjust budget on what's converting, ride the final push, and capture these buyers as a first-party seed for the NEXT event's lookalike. Only suggest new creative / A-B tests when there's a week+ of runway.

SELECTED AD
- Name: ${ad.adName}
- Ad set / audience: ${ad.adSet}
- Total spend this period: $${ad.spend.toFixed(2)}
- Recent daily spend: ~$${ad.dailySpend.toFixed(2)}/day
- Purchases (this ad): ${ad.purchases}
- This ad set's pace: ~${(ad.adSetWeeklyPurchases ?? 0).toFixed(1)} purchases/week
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

export async function getPlan(params: {
  ad: AdContext;
  account: AccountContext;
}): Promise<PlanResult> {
  const res = await callClaude({
    feature: 'advisor_plan',
    maxTokens: 1200,
    system: buildSystem(params.ad, params.account),
    messages: [
      {
        role: 'user',
        content:
          'Give me a step-by-step action plan for THIS ad as JSON ONLY (no markdown, no fences) matching exactly: {"steps":[{"title":string,"detail":string}],"bottomLine":string}. 3–6 steps. Each "title" is a short concrete action the owner can check off (include EXACT dollar budgets where relevant, never percentages; respect the Initiate-Checkout-vs-Purchase rule). Each "detail" is one plain sentence of why/how. "bottomLine" is one sentence.',
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
    feature: 'advisor_chat',
    maxTokens: 1024,
    system,
    messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
  });

  if (!res.ok) return { ok: false, error: res.error };
  if (!res.text) return { ok: false, error: 'Claude returned an empty reply. Try again.' };
  return { ok: true, reply: res.text };
}
