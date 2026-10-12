/**
 * Which proxies Express should believe when it works out the visitor's address (needed by rate limiting).
 *
 * Vercel always sits in front of the API and sets X-Forwarded-For itself (it does not pass on a value the visitor
 * sent), so on Vercel it is trusted without anyone having to remember a setting. Without this every visitor looks like
 * the same address, which means one shared rate-limit bucket for the whole site. Elsewhere it is only trusted
 * when TRUST_PROXY says so ("true", a number of proxies, or an address list).
 */
export function resolveTrustProxy(setting: string | undefined, onVercel: boolean): boolean | number | string | undefined {
  const value = setting?.trim();
  if (value) return value === 'true' ? true : value === 'false' ? false : Number.isInteger(Number(value)) ? Number(value) : value;
  return onVercel ? true : undefined;
}
