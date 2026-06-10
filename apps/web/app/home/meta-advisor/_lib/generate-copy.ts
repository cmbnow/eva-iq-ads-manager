'use server';

import type { AnalysisResult } from './analyze';

export type ScalePlay = {
  ad: string;
  action: string;
  why: string;
};

export type AdCopy = {
  forAd: string;
  primaryText: string;
  headline: string;
  description: string;
};

export type CreativeBrief = {
  concept: string;
  format: string;
  hook: string;
  shotList: string;
};

export type GeneratedPlan = {
  scalePlays: ScalePlay[];
  adCopy: AdCopy[];
  creativeBriefs: CreativeBrief[];
  buildSteps: string[];
};

export type GenerateResult =
  | { ok: true; plan: GeneratedPlan }
  | { ok: false; error: string };

const MODEL = 'claude-sonnet-4-6';

const SYSTEM = `You are EVA IQ's senior Meta ads strategist for "The Foundry at Basic City Beer Co." — a live-music venue and hospitality space in Waynesboro, VA that sells event tickets (SeeTickets / TicketTailor) and uses FIRST-PARTY audiences only (past buyers, SeeTickets buyers, Hive buyers, and 1% lookalikes seeded from them). No third-party/purchased data.

You will be given a performance analysis of the venue's current Meta ads. Produce a concrete action plan grounded ONLY in that data: which ads to scale, fresh ad copy for the winners, creative briefs for the next assets, and exact build steps a human can follow in Meta Ads Manager.

Voice: energetic, local, event-driven, concrete (name the band/event from the ad names where relevant). Keep copy within Meta limits (primary text punchy ~125 chars ideal, headline <40 chars, description <30 chars).

Return ONLY valid minified JSON (no markdown, no code fences) matching exactly this TypeScript type:
{
  "scalePlays": [{ "ad": string, "action": string, "why": string }],
  "adCopy": [{ "forAd": string, "primaryText": string, "headline": string, "description": string }],
  "creativeBriefs": [{ "concept": string, "format": string, "hook": string, "shotList": string }],
  "buildSteps": string[]
}`;

export async function generateAdPlan(
  analysis: AnalysisResult,
): Promise<GenerateResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      error: 'Missing ANTHROPIC_API_KEY on the server.',
    };
  }

  // Compact the analysis so we send only what matters (keeps cost low).
  const compact = {
    period: `${analysis.summary.reportStart} to ${analysis.summary.reportEnd}`,
    blendedRoas: Number(analysis.summary.blendedRoas.toFixed(2)),
    blendedCostPerPurchase:
      analysis.summary.blendedCpp !== null
        ? Number(analysis.summary.blendedCpp.toFixed(2))
        : null,
    totalSpend: Number(analysis.summary.totalSpend.toFixed(2)),
    totalRevenue: Number(analysis.summary.totalRevenue.toFixed(2)),
    highlights: analysis.highlights,
    ads: analysis.ads.map((a) => ({
      adName: a.adName,
      adSet: a.adSetName,
      spend: Number(a.spend.toFixed(2)),
      purchases: a.purchases,
      roas: Number(a.roas.toFixed(2)),
      costPerPurchase: a.cpp !== null ? Number(a.cpp.toFixed(2)) : null,
      frequency: Number(a.frequency.toFixed(2)),
      optimizingFor: a.resultType,
      recommendation: a.recommendation,
    })),
  };

  const userPrompt = `Here is the current performance analysis (JSON):\n\n${JSON.stringify(
    compact,
  )}\n\nProduce the action plan now. Prioritize scaling the underfunded winners and refreshing any fatigued ads. Return ONLY the JSON object.`;

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
        model: MODEL,
        max_tokens: 2500,
        system: SYSTEM,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
  } catch {
    return {
      ok: false,
      error:
        'Could not reach the Claude API. Check the server has internet access.',
    };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return {
      ok: false,
      error: `Claude API error (${response.status}). ${detail.slice(0, 300)}`,
    };
  }

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };

  const text =
    data.content?.map((b) => b.text ?? '').join('').trim() ?? '';

  // The model may wrap JSON in stray text/fences — extract the JSON object.
  const jsonStr = extractJson(text);

  try {
    const plan = JSON.parse(jsonStr) as GeneratedPlan;
    // basic shape guard
    plan.scalePlays ??= [];
    plan.adCopy ??= [];
    plan.creativeBriefs ??= [];
    plan.buildSteps ??= [];
    return { ok: true, plan };
  } catch {
    return {
      ok: false,
      error: 'Claude returned an unexpected format. Please try again.',
    };
  }
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1);
  }
  return text;
}
