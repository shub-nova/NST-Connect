import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Redis } from '@upstash/redis';
import { RedisThrottlerStorage, type RedisLike } from './common/redis-throttler.storage';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { validateEnv } from './config/env';
import { HealthController } from './health.controller';
import { MailModule } from './mail/mail.module';
import { EscalationModule } from './escalation/escalation.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { NotesModule } from './notes/notes.module';
import { StaffModule } from './staff/staff.module';
import { PocModule } from './poc/poc.module';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { TicketsModule } from './tickets/tickets.module';
import { AttachmentsModule } from './attachments/attachments.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // The single .env lives at the repo root; the API runs from apps/api.
      envFilePath: ['../../.env', '.env'],
      validate: validateEnv,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('UPSTASH_REDIS_REST_URL');
        const token = config.get<string>('UPSTASH_REDIS_REST_TOKEN');
        return {
          throttlers: [{ ttl: 60_000, limit: 120 }],
          skipIf: () => process.env.NODE_ENV === 'test',
          // A shared store when configured (needed on serverless); otherwise the default in-memory one.
          ...(url && token ? { storage: new RedisThrottlerStorage(new Redis({ url, token }) as unknown as RedisLike) } : {}),
        };
      },
    }),
    PrismaModule,
    MailModule,
    StorageModule,
    AuthModule,
    TicketsModule,
    AttachmentsModule,
    PocModule,
    EscalationModule,
    AnalyticsModule,
    NotesModule,
    StaffModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: rate limit, then "must be logged in", then "must have the role".
    // Access control is deny-by-default; endpoints opt out with @Public().
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
