import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EscalationService } from './escalation.service';

/**
 * Runs the escalation check on a timer inside the API process (local development and simple
 * deployments). In hosted setups an external scheduler can call POST /internal/escalation/run
 * instead; both are safe together because the job itself is idempotent.
 */
@Injectable()
export class EscalationScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EscalationScheduler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly escalation: EscalationService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    if (this.config.get('NODE_ENV') === 'test' || !this.config.get<boolean>('ESCALATION_JOB_ENABLED')) return;

    const minutes = this.config.getOrThrow<number>('ESCALATION_INTERVAL_MINUTES');
    this.timer = setInterval(() => void this.tick(), minutes * 60 * 1000);
    this.timer.unref(); // never keeps the process alive on its own
    // Run once shortly after start so a restart after downtime catches up straight away.
    setTimeout(() => void this.tick(), 10_000).unref();
    this.logger.log(`Escalation check runs every ${minutes} min`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return; // a slow run must not overlap the next one
    this.running = true;
    try {
      await this.escalation.runOnce();
    } catch (err) {
      this.logger.error(`Escalation run failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
