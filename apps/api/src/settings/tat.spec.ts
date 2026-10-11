import { DEFAULT_TAT_HOURS, deadlineAfter, describeTat, parseTatHours } from './tat';

describe('the escalation limit', () => {
  it('reads whole days and falls back to the default for anything else', () => {
    expect(parseTatHours('72')).toBe(72);
    expect(parseTatHours('24')).toBe(24);
    expect(parseTatHours('336')).toBe(336); // 14 days
    for (const bad of [null, undefined, '', 'abc', '0', '-48', '36', '12', '360', '48.5', '999999']) {
      expect(parseTatHours(bad)).toBe(DEFAULT_TAT_HOURS);
    }
  });

  it('works out the deadline and describes the limit', () => {
    const from = new Date('2026-10-01T10:00:00Z');
    expect(deadlineAfter(from, 72).toISOString()).toBe('2026-10-04T10:00:00.000Z');
    expect(describeTat(24)).toBe('1 day');
    expect(describeTat(48)).toBe('2 days');
    expect(describeTat(36)).toBe('36 hours');
  });
});
