import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { validateEnv } from './config/env';
import { HealthController } from './health.controller';
import { MailModule } from './mail/mail.module';
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
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 120 }],
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    PrismaModule,
    MailModule,
    StorageModule,
    AuthModule,
    TicketsModule,
    AttachmentsModule,
    PocModule,
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
