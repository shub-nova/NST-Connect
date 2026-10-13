import type { JwtService } from '@nestjs/jwt';

/** How long an invitation link works. A team lead can send a fresh one at any time ("Resend invite"). */
export const INVITE_TTL = '14d';

/**
 * The invitation link carries a signed token that names the invited address. The sign-up page fills that address in
 * and cannot change it, and the server refuses a sign-up that uses an invitation with any other address. So the person
 * who was added is the one who registers (the verification email then proves they own that mailbox).
 */
export function signInvite(jwt: JwtService, email: string): Promise<string> {
  return jwt.signAsync({ purpose: 'invite', email: email.trim().toLowerCase() }, { expiresIn: INVITE_TTL });
}

/** The invited address, or null when the token is not a valid, unexpired invitation. */
export async function readInvite(jwt: JwtService, token: string): Promise<string | null> {
  try {
    const claims = await jwt.verifyAsync<{ purpose?: string; email?: string }>(token);
    return claims.purpose === 'invite' && typeof claims.email === 'string' ? claims.email.toLowerCase() : null;
  } catch {
    return null;
  }
}
