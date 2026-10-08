/**
 * `STUDENT_EMAIL_DOMAIN` can hold one domain ("adypu.edu.in") or several separated by commas
 * ("adypu.edu.in,gmail.com"). Extra domains are for TESTING real email delivery with an address you own;
 * remove them before going live.
 */
export function parseDomains(raw: string): string[] {
  return raw
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

/** "@a.in", "@a.in or @b.com", used in the sign-up error message. */
export function describeDomains(domains: string[]): string {
  return domains.map((d) => `@${d}`).join(' or ');
}

export type EmailKind = 'STUDENT' | 'STAFF';

const STUDENT_LOCAL_PART = /^[a-z0-9][a-z0-9._-]{1,62}$/;

/** Which kind of address is this? null means the domain is not allowed to sign up. */
export function classifyEmail(email: string, studentDomains: string[], staffDomain: string): EmailKind | null {
  const [local, domain, ...rest] = email.split('@');
  if (!local || !domain || rest.length) return null;
  if (studentDomains.includes(domain)) return STUDENT_LOCAL_PART.test(local) ? 'STUDENT' : null;
  if (domain === staffDomain) return 'STAFF';
  return null;
}
