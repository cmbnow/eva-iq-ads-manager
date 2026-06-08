import { describe, expect, it } from 'vitest';

import { evaluateApproval } from './approval';

describe('evaluateApproval', () => {
  it('blocks when no profitability run is linked', () => {
    const d = evaluateApproval({ profitabilityRunId: null, mrmc: 500, recommendedBudget: 100 });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/no profit basis/i);
  });

  it('allows when budget is within MRMC', () => {
    expect(evaluateApproval({ profitabilityRunId: 'r1', mrmc: 500, recommendedBudget: 300 }).ok).toBe(true);
  });

  it('blocks when budget exceeds MRMC without override', () => {
    const d = evaluateApproval({ profitabilityRunId: 'r1', mrmc: 300, recommendedBudget: 450 });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/marginal ceiling/i);
  });

  it('allows over-MRMC budget when override is set', () => {
    expect(evaluateApproval({ profitabilityRunId: 'r1', mrmc: 300, recommendedBudget: 450, override: true }).ok).toBe(true);
  });

  it('does not block on MRMC when mrmc is unknown (0)', () => {
    expect(evaluateApproval({ profitabilityRunId: 'r1', mrmc: 0, recommendedBudget: 9999 }).ok).toBe(true);
  });
});
