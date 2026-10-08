import { buildTransportOptions } from './mail.options';

describe('buildTransportOptions', () => {
  it('delivers locally with no login when SMTP_USER is empty (development with Mailpit)', () => {
    expect(buildTransportOptions({ SMTP_HOST: 'localhost', SMTP_PORT: '1025' })).toEqual({ host: 'localhost', port: 1025, secure: false });
  });

  it('logs in and upgrades to TLS on port 587 (Brevo, Gmail, SES)', () => {
    expect(buildTransportOptions({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: 587, SMTP_USER: 'me', SMTP_PASS: 'secret' })).toEqual({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'me', pass: 'secret' },
    });
  });

  it('uses implicit TLS on port 465 or when SMTP_SECURE is true', () => {
    expect(buildTransportOptions({ SMTP_HOST: 'h', SMTP_PORT: 465, SMTP_USER: 'u', SMTP_PASS: 'p' })).toMatchObject({ secure: true, requireTLS: false });
    expect(buildTransportOptions({ SMTP_HOST: 'h', SMTP_PORT: 2465, SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_SECURE: 'true' })).toMatchObject({ secure: true });
  });

  it('refuses a login without a password', () => {
    expect(() => buildTransportOptions({ SMTP_HOST: 'h', SMTP_PORT: 587, SMTP_USER: 'u' })).toThrow(/SMTP_PASS/);
  });

  it('always uses local Mailpit under test, so the test suite can never send real email', () => {
    expect(buildTransportOptions({ NODE_ENV: 'test', SMTP_HOST: 'smtp.real.com', SMTP_PORT: 587, SMTP_USER: 'u', SMTP_PASS: 'p' })).toEqual({
      host: 'localhost',
      port: 1025,
      secure: false,
    });
  });
});
