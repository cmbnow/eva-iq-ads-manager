import { describe, expect, it } from 'vitest';

import { isAuthorizedCron } from './auth';

/*
 * D2a reconcile cron auth gate. Fails closed: no CRON_SECRET configured =>
 * nothing is authorized; the header must be exactly `Bearer <secret>`.
 */
describe('D2a — cron CRON_SECRET gate', () => {
  it('authorizes only the exact Bearer <secret> header', () => {
    expect(isAuthorizedCron('Bearer s3cr3t', 's3cr3t')).toBe(true);
  });

  it('rejects wrong, missing, or unprefixed headers', () => {
    expect(isAuthorizedCron('Bearer wrong', 's3cr3t')).toBe(false);
    expect(isAuthorizedCron(null, 's3cr3t')).toBe(false);
    expect(isAuthorizedCron('s3cr3t', 's3cr3t')).toBe(false); // no "Bearer "
  });

  it('fails closed when no secret is configured', () => {
    expect(isAuthorizedCron('Bearer ', undefined)).toBe(false);
    expect(isAuthorizedCron('Bearer x', '')).toBe(false);
  });
});
