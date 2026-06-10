/**
 * True only when the request carries the exact `Bearer <CRON_SECRET>` header.
 * Vercel Cron sends `authorization: Bearer <CRON_SECRET>`. Fails closed when the
 * secret is unset (no secret configured => nothing is authorized).
 */
export function isAuthorizedCron(
  authHeader: string | null,
  secret: string | undefined,
): boolean {
  if (!secret) return false;
  return authHeader === `Bearer ${secret}`;
}
