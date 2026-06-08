'use server';

import {
  callClaude,
  extractJson,
  type ClaudeContentBlock,
  type ClaudeMessage,
} from '~/lib/server/ai';
import { buildAttachmentBlocks } from '~/lib/server/attachments';
import { scalingPromptBlock } from '../../show-engine/_lib/scaling-advisor';

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
  budgetStructure: 'CBO' | 'ABO';
  campaignBudget?: number; // known budget amount, if the user told us
  budgetPeriod?: 'daily' | 'lifetime';
  // Linked Show Engine profitability run — the CALCULATED budget source.
  show?: {
    name: string;
    tmav: number;
    cpaEarly: number;
    cpaMid: number;
    cpaLate: number;
    mrmc: number;
    coreTotal: number;
    coreDaily: number;
    aggressiveTotal: number;
    defenseTotal: number;
    daysRemaining: number;
    dealScore: string;
  };
  // Engine scaling verdict (decideScaling). When present, the AI MUST report this
  // decision rather than derive its own — engine decides, Claude translates.
  scaling?: {
    zone: string;
    action: string;
    reason: string;
    budgetChangePct: number | null;
    caveats: string[];
  };
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
- Give exact dollar figures, never percentages. BUT base any budget recommendation on the KNOWN budget amount in the BUDGET AMOUNT section below — NOT on observed spend. The recent daily spend is only the burn rate, not the budget setting. If the budget amount is unknown, ASK for it instead of inventing a "$X/day" number.
- SCALE GRADUALLY: never increase a daily budget by more than ~30–40% in a single step. Larger jumps reset Meta's learning phase and can tank a winning ad — so step it up over time. Example: if it's at ~$1/day, recommend "raise to about $1.30/day" (not $3/day), then step up again in a week. If it's at ~$8/day, recommend ~$10–11/day.
- BE PRECISE: never exaggerate a number. If cost/purchase is $2.74 against an $8 target, that's "about 3x under target," not 4x. Double-check every multiple and dollar figure.

BUDGET STRUCTURE RULE (critical): This ad set's budget structure is ${ad.budgetStructure}.
${
    ad.budgetStructure === 'CBO'
      ? '- CBO (Advantage+ Campaign Budget): the budget is set at the CAMPAIGN level and Meta auto-distributes it across ad sets. The owner CANNOT set this individual ad set\'s daily budget. So give budget advice at the CAMPAIGN level — e.g. "raise the CAMPAIGN daily budget to ~$X (Meta will shift more of it to this winning ad set)." NEVER tell them to set this ad set\'s budget directly; that instruction cannot be executed.'
      : '- ABO (ad-set budget): this ad set has its OWN budget, so ad-set-level budget advice is correct — e.g. "raise this ad set\'s daily budget to ~$X."'
  }
- The gradual-scaling rule above applies to whichever level you adjust.

BUDGET AMOUNT (critical — do not fabricate):
${
    ad.campaignBudget != null
      ? ad.budgetPeriod === 'lifetime'
        ? `The ${ad.budgetStructure === 'CBO' ? 'campaign' : 'ad set'} budget is $${ad.campaignBudget} LIFETIME. There is NO daily number to raise. If it's largely spent, the campaign simply stops when the lifetime budget is exhausted. To keep this winner running, advise raising the TOTAL LIFETIME budget gradually (about +30%) to ~$${Math.round(ad.campaignBudget * 1.3)} — or accept it ends when spent. NEVER phrase budget advice as "$X/day" for a lifetime budget.`
        : `The ${ad.budgetStructure === 'CBO' ? 'campaign' : 'ad set'} budget is $${ad.campaignBudget} per DAY. Advise gradual steps from that exact number (≤~30–40%), e.g. to ~$${Math.round(ad.campaignBudget * 1.3)}/day.`
      : `The budget amount is UNKNOWN — the CSV export does not include it. DO NOT invent a "$X/day" figure from observed spend. Instead: confirm this ad set is the winner, and either ASK the owner for the campaign budget (amount + daily or lifetime), OR — better — tell them to run the Show Engine for this event and link it, so EVA IQ can CALCULATE the right budget from the show's economics.`
  }
${
    ad.show
      ? `\nPROFITABILITY (CALCULATED budget — use this; do NOT ask the owner for a budget):
A profitability run is linked: "${ad.show.name}" (deal score ${ad.show.dealScore}).
- TMAV (true marginal value per attendee): $${ad.show.tmav.toFixed(0)}.
- Hold cost-per-purchase under these CPA targets: early $${ad.show.cpaEarly.toFixed(0)}, mid $${ad.show.cpaMid.toFixed(0)}, late $${ad.show.cpaLate.toFixed(0)}. Never exceed the late target.
- Max rational marketing spend for this show (MRMC): $${ad.show.mrmc.toFixed(0)}.
- RECOMMENDED total budget for the ${ad.show.daysRemaining}-day flight: Core $${ad.show.coreTotal.toFixed(0)} (~$${ad.show.coreDaily.toFixed(0)}/day), Aggressive $${ad.show.aggressiveTotal.toFixed(0)}, Defense $${ad.show.defenseTotal.toFixed(0)}.
- TELL the owner the EXACT budget to set: pick the tier by deal score (A/B → Core or Aggressive; C → Defense), expressed as a LIFETIME budget of about that tier total across the ${ad.show.daysRemaining}-day flight (or the per-day figure if they run daily budgets). This is the calculated, profitable budget — recommend it directly.${ad.campaignBudget != null ? ` The owner's current budget is $${ad.campaignBudget} ${ad.budgetPeriod ?? ''}; compare to the recommended tier and advise the gradual move toward it (≤~30–40%/step).` : ''}`
      : ''
  }
${ad.scaling ? '\n' + scalingPromptBlock(ad.scaling) + '\n' : ''}
INITIATE-CHECKOUT vs PURCHASE RULE (critical, non-negotiable):
- This account optimizes ad sets on Initiate Checkout until a SINGLE AD SET reaches ~50 Purchase events in a rolling 7-day window. ONLY then switch THAT ad set to Purchase optimization.
- The 50/week threshold is PER AD SET — never account-wide, never multi-week totals.
- THIS ad set is pacing ~${(ad.adSetWeeklyPurchases ?? 0).toFixed(1)} purchases/week, which ${ad.icSwitchQualifies ? 'CLEARS' : 'does NOT clear'} the 50/week threshold.${
    ad.icSwitchQualifies
      ? ' So a switch to Purchase optimization is justified for this ad set.'
      : ' So you MUST hold on Initiate Checkout. Do NOT recommend switching to Purchase, no matter how high the raw purchase count looks.'
  }
- NEVER give generic "you have enough purchases, switch to Purchase" advice.

CONFIDENCE & LEARNING RULE (critical):
- SCALE CONFIDENCE: this ad set is pacing ~${(ad.adSetWeeklyPurchases ?? 0).toFixed(1)} sales/week. Trust "winner / scale" advice ONLY at/above 50 sales per ad set per week. Below that, ROAS is statistical NOISE — do NOT call it a winner or recommend scaling; keep it funded, stay on Initiate Checkout, and frame it as "still proving out, not proven yet." (This 50/week gate is an INTERIM noise filter — NOT the final profit logic. The real scaling test is marginal cost-per-sale vs. per-ticket margin, i.e. "does the next ad dollar return more than $1 of ticket margin?", which needs a per-ticket-margin input not yet in the system.)
- If this ad set paces well under 50 sales/week AND the runway is long (more than ~3 weeks), it's likely stuck in Meta's learning phase because budget is spread too thin — recommend CONCENTRATING budget toward the event window, not running flat.
- Any budget increase over ~20%, or duplicating into a new lookalike, re-triggers Meta's learning phase — call that out when you suggest either.

TIMELINE RULE: Tailor advice to the days remaining. If the event ends within ~4 days, do NOT recommend producing new creative or multi-day check-ins — there's no time. Instead adjust budget on what's converting, ride the final push, and capture these buyers as a first-party seed for the NEXT event's lookalike. Only suggest new creative / A-B tests when there's a week+ of runway.

SELECTED AD
- Name: ${ad.adName}
- Ad set / audience: ${ad.adSet}
- Total spend this period: $${ad.spend.toFixed(2)}
- Observed recent daily spend (burn rate, NOT the budget setting): ~$${ad.dailySpend.toFixed(2)}/day
- Purchases (this ad): ${ad.purchases}
- This ad set's pace: ~${(ad.adSetWeeklyPurchases ?? 0).toFixed(1)} purchases/week
- Budget structure: ${ad.budgetStructure}${ad.budgetStructure === 'CBO' ? ' (campaign-level — cannot set this ad set\'s budget directly)' : ' (ad-set budget)'}
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
  attachment?: { data: string; mediaType: string; name: string } | null;
}): Promise<AskResult> {
  let system = buildSystem(params.ad, params.account);
  if (params.doneSteps && params.doneSteps.length) {
    system += `\n\nPROGRESS: The owner has already completed these steps: ${params.doneSteps
      .map((s) => `"${s}"`)
      .join(', ')}. Do not tell them to redo these — build on them.`;
  }

  // Route the attachment into content blocks via the SHARED helper.
  // Unsupported types return a friendly message — never a 400 from the API.
  let attBlocks: ClaudeContentBlock[] | null = null;
  let attIsImage = false;
  if (params.attachment) {
    const routed = await buildAttachmentBlocks(params.attachment);
    if (!routed.ok) return { ok: false, error: routed.error };
    attBlocks = routed.blocks;
    attIsImage = routed.isImage;
  }

  const outbound: ClaudeMessage[] = params.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  if (attBlocks && outbound.length) {
    const last = outbound[outbound.length - 1]!;
    const existingText = typeof last.content === 'string' ? last.content : '';
    last.content = [
      ...attBlocks,
      {
        type: 'text',
        text:
          existingText ||
          (attIsImage ? 'Please analyze this screenshot.' : 'Please analyze this file.'),
      },
    ];
  }

  const res = await callClaude({
    feature: params.attachment ? (attIsImage ? 'advisor_chat_image' : 'advisor_chat_file') : 'advisor_chat',
    maxTokens: 1024,
    system,
    messages: outbound,
  });

  if (!res.ok) return { ok: false, error: res.error };
  if (!res.text) return { ok: false, error: 'Claude returned an empty reply. Try again.' };
  return { ok: true, reply: res.text };
}
