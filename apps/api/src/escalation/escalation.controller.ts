import { Controller, Headers, HttpCode, NotFoundException, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../common/decorators';
import { EscalationService } from './escalation.service';

/**
 * Lets an external scheduler (cron-job.org, Render cron) trigger the check. It is not part
 * of the user-facing API: it is off unless JOB_SECRET is set, and needs it in a header.
 */
@Controller('internal/escalation')
export class EscalationController {
  constructor(
    private readonly escalation: EscalationService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('run')
  @HttpCode(200)
  run(@Headers('x-job-secret') provided?: string) {
    const secret = this.config.get<string>('JOB_SECRET');
    if (!secret) throw new NotFoundException(); // not enabled: pretend it does not exist

    const a = Buffer.from(provided ?? '');
    const b = Buffer.from(secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
    return this.escalation.runOnce();
  }
}
