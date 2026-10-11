import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_TAT_HOURS, describeTat, getTatHours, MAX_TAT_DAYS, MIN_TAT_DAYS, TAT_SETTING_KEY } from './tat';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The limit, plus when the escalation check last ran, so the admin can see the schedule is alive. */
  async escalation() {
    const [hours, beat] = await Promise.all([getTatHours(this.prisma), this.prisma.jobHeartbeat.findUnique({ where: { jobName: 'escalation' } })]);
    return { hours, days: hours / 24, defaultDays: DEFAULT_TAT_HOURS / 24, minDays: MIN_TAT_DAYS, maxDays: MAX_TAT_DAYS, lastRunAt: beat?.lastRunAt ?? null };
  }

  /**
   * Sets how many days a POC has before a ticket escalates. It applies from now on: a ticket's current deadline
   * is left alone and the new limit is used the next time a clock starts for it (an escalation, a reopen, a hand-over,
   * a new ticket). That way changing the setting never makes tickets escalate, or stop escalating, all at once.
   */
  async setEscalationDays(actorId: string, days: number) {
    if (!Number.isInteger(days) || days < MIN_TAT_DAYS || days > MAX_TAT_DAYS) {
      throw new BadRequestException(`Choose between ${MIN_TAT_DAYS} and ${MAX_TAT_DAYS} days.`);
    }
    const hours = days * 24;
    await this.prisma.$transaction(async (tx) => {
      const before = await getTatHours(tx);
      if (before === hours) return;
      await tx.appSetting.upsert({
        where: { key: TAT_SETTING_KEY },
        update: { value: String(hours), updatedById: actorId },
        create: { key: TAT_SETTING_KEY, value: String(hours), updatedById: actorId },
      });
      await tx.staffAudit.create({
        data: { actorId, action: 'SETTING_CHANGED', summary: `Changed the escalation time from ${describeTat(before)} to ${describeTat(hours)}` },
      });
    });
    return this.escalation();
  }
}
