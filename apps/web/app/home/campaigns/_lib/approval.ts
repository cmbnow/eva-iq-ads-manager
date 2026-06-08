export type ApprovalInput = {
  profitabilityRunId: string | null;
  mrmc: number;
  recommendedBudget: number;
  override?: boolean;
};

export type ApprovalDecision = { ok: true } | { ok: false; error: string };

/**
 * The profit gate. A campaign may be approved only with a linked profitability
 * run, and only if its recommended budget stays within the marginal ceiling
 * (MRMC) — unless an explicit override is supplied. Pure: same inputs, same result.
 */
export function evaluateApproval(input: ApprovalInput): ApprovalDecision {
  if (!input.profitabilityRunId) {
    return {
      ok: false,
      error:
        'EVA IQ will not approve an ad with no profit basis. Link a Show Engine run first.',
    };
  }
  if (input.mrmc > 0 && input.recommendedBudget > input.mrmc && !input.override) {
    return {
      ok: false,
      error: `This run's recommended budget ($${Math.round(input.recommendedBudget)}) exceeds the marginal ceiling (MRMC $${Math.round(input.mrmc)}). Approving spends past the point each new ad dollar earns back a full attendee's margin. Re-approve with override to proceed.`,
    };
  }
  return { ok: true };
}
