/**
 * `STUDENT_EMAIL_DOMAIN` can hold one domain ("adypu.edu.in") or several separated by commas
 * ("adypu.edu.in,gmail.com"). `POC_EMAIL_DOMAIN` works the same way. Extra domains are for TESTING real email
 * delivery with an address you own; remove them before going live. One test domain (gmail.com) may be listed as both:
 * then a "+staff" tag in the address makes it a staff account (you+staff@gmail.com), anything else is a student.
 * Gmail delivers both to the same inbox. Real deployments must keep the two lists apart.
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
export function classifyEmail(email: string, studentDomains: string[], staffDomains: string[]): EmailKind | null {
  const [local, domain, ...rest] = email.split('@');
  if (!local || !domain || rest.length) return null;
  const isStudent = studentDomains.includes(domain);
  const isStaff = staffDomains.includes(domain);
  // A domain listed for both (testing only) is told apart by a "+staff" tag.
  if (isStudent && isStaff) {
    if (local.endsWith('+staff') && local.length > '+staff'.length) return 'STAFF';
    return STUDENT_LOCAL_PART.test(local) ? 'STUDENT' : null;
  }
  if (isStudent) return STUDENT_LOCAL_PART.test(local) ? 'STUDENT' : null;
  if (isStaff) return 'STAFF';
  return null;
}

/** Domains listed as both student and staff: only acceptable while testing, where a +staff tag tells them apart. */
export function overlappingDomains(studentDomains: string[], staffDomains: string[]): string[] {
  return studentDomains.filter((d) => staffDomains.includes(d));
}
