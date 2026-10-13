import { resolveRange } from './range';
import { tokenize, topCommentPhrases, topTerms } from './words';

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
  it('refuses days that do not exist instead of moving them into the next month', () => {
    for (const bad of ['2026-02-30', '2026-02-31', '2026-04-31', '2026-02-29', '2026-13-01', '2026-00-10', '2026-10-32']) {
      expect(() => resolveRange(bad, '2026-12-31')).toThrow();
      expect(() => resolveRange('2026-01-01', bad)).toThrow();
    }
    expect(resolveRange('2028-02-29', '2028-03-01').days).toBe(2); // a real leap day is fine
  });

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

describe('topCommentPhrases', () => {
  it('finds whole repeated phrases, including small words inside them', () => {
    const out = topCommentPhrases(['Quick and clear, thank you.', 'Quick and clear!', 'Very quick and clear answer', 'Took too long']);
    expect(out).toEqual([{ term: 'quick and clear', count: 3 }]);
  });

  it('keeps the full phrase and drops its fragments', () => {
    const out = topCommentPhrases(['Problem fixed the same day.', 'The problem fixed the same day, thanks', 'Problem fixed the same day']);
    expect(out).toEqual([{ term: 'problem fixed the same day', count: 3 }]);
  });

  it('counts a phrase once per comment and needs at least two comments', () => {
    expect(topCommentPhrases(['great help great help great help'])).toEqual([]);
    expect(topCommentPhrases(['Great help.', 'great help'])).toEqual([{ term: 'great help', count: 2 }]);
  });

  it('does not build phrases across sentences or start and end on filler words', () => {
    expect(topCommentPhrases(['Slow. Rude.', 'Slow. Rude.'])).toEqual([]);
    expect(topCommentPhrases(['to the team', 'to the team'])).toEqual([]); // only one meaningful word, so no phrase
  });
});
