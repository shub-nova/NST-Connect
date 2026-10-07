import { Module } from '@nestjs/common';
import { EscalationController } from './escalation.controller';
import { EscalationScheduler } from './escalation.scheduler';
import { EscalationService } from './escalation.service';

@Module({
  controllers: [EscalationController],
  providers: [EscalationService, EscalationScheduler],
  exports: [EscalationService],
})
export class EscalationModule {}
