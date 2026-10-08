import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { Role, User } from '../generated/prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { classifyEmail, describeDomains, parseDomains, type EmailKind } from './email-domains';


export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

/** How long after rotation the old refresh token is still accepted (covers racing requests). */
const REFRESH_REUSE_GRACE_MS = 10_000;

const toPublic = (u: User): PublicUser => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  // Used to spend the same time on unknown emails as on real ones (timing safety).
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  /** Makes a test-only setting hard to forget: extra student domains are logged on every start. */
  onModuleInit() {
    const domains = this.studentDomains();
    if (domains.length > 1) {
      this.logger.warn(`Student sign-up also accepts ${describeDomains(domains.slice(1))}. That is for testing only: remove it before going live.`);
    }
  }

  private studentDomains(): string[] {
    return parseDomains(this.config.getOrThrow<string>('STUDENT_EMAIL_DOMAIN'));
  }

  classifyEmail(email: string): EmailKind | null {
    return classifyEmail(email, this.studentDomains(), this.config.getOrThrow<string>('POC_EMAIL_DOMAIN'));
  }

  async register(rawEmail: string, name: string, password: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();
    const kind = this.classifyEmail(email);
    if (!kind) {
      throw new BadRequestException(
        `Registration is limited to ${describeDomains(this.studentDomains())} (students) and @${this.config.get('POC_EMAIL_DOMAIN')} (staff) email addresses.`,
      );
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const existing = await this.prisma.user.findUnique({ where: { email } });
    let target: User | null = null;

    if (kind === 'STUDENT') {
      if (!existing) {
        target = await this.prisma.user.create({
          data: {
            email,
            name,
            passwordHash,
            role: Role.STUDENT,
            enrollmentId: email.split('@')[0],
          },
        });
      } else if (!existing.emailVerifiedAt) {
        target = await this.prisma.user.update({ where: { id: existing.id }, data: { name, passwordHash } });
      }
    } else {
      // Anyone on the staff domain can sign up; the verification link proves the address is theirs. That only
      // creates a POC account with NO category: it sees nothing until an admin or team lead adds them from
      // Settings. Access comes from an assignment, never from signing up. Admins are never self-registered.
      if (existing && !existing.emailVerifiedAt) {
        target = await this.prisma.user.update({ where: { id: existing.id }, data: { passwordHash } });
      } else if (!existing) {
        target = await this.prisma.user.create({ data: { email, name, passwordHash, role: Role.POC } });
      }
    }

    if (target) {
      const token = await this.jwt.signAsync({ sub: target.id, purpose: 'verify' }, { expiresIn: '24h' });
      const link = `${this.config.getOrThrow<string>('WEB_URL')}/verify?token=${token}`;
      await this.mail.send(
        target.email,
        'Verify your NST Connect email',
        `Hi ${target.name},\n\nConfirm your email to finish creating your NST Connect account:\n${link}\n\nThis link expires in 24 hours. If you did not sign up, ignore this email.`,
      );
    }
    // The caller always gets the same response for eligible domains, so the
    // endpoint cannot be used to discover who is registered.
  }

  async verifyEmail(token: string): Promise<void> {
    try {
      const claims = await this.jwt.verifyAsync<{ sub: string; purpose: string }>(token);
      if (claims.purpose !== 'verify') throw new Error('wrong token type');
      await this.prisma.user.updateMany({
        where: { id: claims.sub, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date() },
      });
    } catch {
      throw new BadRequestException('This verification link is invalid or has expired.');
    }
  }

  async login(rawEmail: string, password: string): Promise<AuthResult> {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    this.dummyHash ??= argon2.hash('not-a-real-password', { type: argon2.argon2id });
    const ok = await argon2
      .verify(user?.passwordHash ?? (await this.dummyHash), password)
      .catch(() => false);
    if (!user || !user.passwordHash || !ok) throw new UnauthorizedException('Invalid email or password.');
    if (user.deactivatedAt) throw new ForbiddenException('This account has been deactivated.');
    if (!user.emailVerifiedAt) throw new ForbiddenException('Please verify your email before logging in.');

    return this.issueTokens(user);
  }

  async refresh(rawToken: string | undefined): Promise<AuthResult> {
    if (!rawToken) throw new UnauthorizedException();
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
      include: { user: true },
    });
    if (!record) throw new UnauthorizedException();

    if (record.revokedAt) {
      // Two requests that race (two tabs, a double fire) can present the same token a
      // moment apart. Within a short grace window that is a race, not theft.
      const withinGrace = Date.now() - record.revokedAt.getTime() < REFRESH_REUSE_GRACE_MS;
      if (!withinGrace || record.expiresAt < new Date()) {
        // A rotated token came back well after rotation: assume theft and end every session.
        // Marked with the epoch so the grace window can never apply to a theft revocation.
        await this.prisma.refreshToken.updateMany({
          where: { userId: record.userId, revokedAt: null },
          data: { revokedAt: new Date(0) },
        });
        throw new UnauthorizedException();
      }
      return this.issueTokens(record.user);
    }
    if (record.expiresAt < new Date() || record.user.deactivatedAt) throw new UnauthorizedException();

    await this.prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
    return this.issueTokens(record.user);
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return toPublic(user);
  }

  private async issueTokens(user: User): Promise<AuthResult> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role, purpose: 'access' },
      { expiresIn: this.config.getOrThrow<number>('ACCESS_TOKEN_TTL_SECONDS') },
    );
    const refreshToken = randomBytes(48).toString('base64url');
    const ttlDays = this.config.getOrThrow<number>('REFRESH_TOKEN_TTL_DAYS');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
      },
    });
    return { user: toPublic(user), accessToken, refreshToken };
  }
}
