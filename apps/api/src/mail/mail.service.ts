import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { buildTransportOptions } from './mail.options';

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter;
  private readonly from: string;
  private readonly label: string;

  constructor(config: ConfigService) {
    this.from = config.getOrThrow<string>('MAIL_FROM');
    const options = buildTransportOptions({
      NODE_ENV: process.env.NODE_ENV,
      SMTP_HOST: config.get<string>('SMTP_HOST'),
      SMTP_PORT: config.get<number>('SMTP_PORT'),
      SMTP_USER: config.get<string>('SMTP_USER'),
      SMTP_PASS: config.get<string>('SMTP_PASS'),
      SMTP_SECURE: config.get<boolean>('SMTP_SECURE'),
    });
    this.transport = createTransport(options);
    this.label = `${options.host}:${options.port}${options.auth ? ` as ${options.auth.user}` : ' (no login: local mail catcher)'}`;
  }

  /** Says at start-up where mail goes, and warns early if the mail server cannot be reached or rejects the login. */
  async onModuleInit() {
    // Not in tests, and not on serverless where this would run (and hold a connection open) on every cold start.
    if (process.env.NODE_ENV === 'test' || process.env.VERCEL) return;
    try {
      await this.transport.verify();
      this.logger.log(`Mail ready: ${this.label}`);
    } catch (err) {
      this.logger.warn(`Mail NOT ready (${this.label}): ${(err as Error).message}`);
    }
  }

  /** Sends and reports failure to the caller. Used by the "send a test email" command. */
  async sendStrict(to: string, subject: string, text: string) {
    return this.transport.sendMail({ from: this.from, to, subject, text });
  }

  async send(to: string, subject: string, text: string) {
    try {
      await this.sendStrict(to, subject, text);
    } catch (err) {
      // Never fail a request because the mail server is down; log for the operator.
      this.logger.error(`Failed to send "${subject}" to ${to}: ${(err as Error).message}`);
    }
  }
}
