import { resolveRange } from './range';
import { tokenize, topTerms } from './words';

describe('topTerms', () => {
  it('drops stop words and counts a word once per ticket', () => {
    const { words } = topTerms(
      ['Wifi wifi wifi is not working in the hostel', 'The hostel wifi keeps disconnecting', 'Water leakage in hostel'],
      10,
      2,
    );
    expect(words).toEqual([
      { term: 'hostel', count: 3 },
      { term: 'wifi', count: 2 },
    ]);
  });

  it('finds two-word phrases made of neighbouring meaningful words', () => {
    const { phrases } = topTerms(['Bonafide certificate for visa', 'need bonafide certificate urgently', 'visa certificate'], 5, 2);
    expect(phrases).toEqual([{ term: 'bonafide certificate', count: 2 }]);
  });

  it('ignores numbers and very short words', () => {
    expect(tokenize('Room 204 is at 5pm, ok')).toEqual(['room', '5pm']);
  });
});

describe('resolveRange', () => {
  const now = new Date('2026-10-07T10:00:00Z');

  it('defaults to the last 30 days including today', () => {
    const r = resolveRange(undefined, undefined, now);
    expect(r.days).toBe(30);
    expect(r.to.toISOString()).toBe('2026-10-08T00:00:00.000Z'); // exclusive end
    expect(r.bucket).toBe('day');
    expect(r.prevFrom.getTime()).toBe(r.from.getTime() - 30 * 86400000);
  });

  it('treats both dates as inclusive and switches to weekly points for long ranges', () => {
    expect(resolveRange('2026-10-01', '2026-10-07', now).days).toBe(7);
    expect(resolveRange('2026-07-01', '2026-10-07', now).bucket).toBe('week');
  });

  it('rejects backwards, huge or malformed ranges', () => {
    expect(() => resolveRange('2026-10-08', '2026-10-01', now)).toThrow();
    expect(() => resolveRange('2020-01-01', '2026-10-01', now)).toThrow();
    expect(() => resolveRange('nonsense', '2026-10-01', now)).toThrow();
  });
});
