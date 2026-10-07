// Turns ticket titles and descriptions into "most repeated words and phrases".
// Pure functions, so they are unit-tested without a database.

const STOP_WORDS = new Set(
  `a about above after again all also am an and any are as at be because been before being below between both but by
can could did do does doing down during each few for from further had has have having he her here hers him his how
i if in into is it its just me more most my no nor not now of off on once only or other our out over own same she
should so some such than that the their them then there these they this those through to too under until up us very
was we were what when where which while who whom why will with would you your yours please pls sir mam hi hello dear
regards thanks thank kindly request issue ticket regarding sub need want get got facing unable not still since
also like one two na hai hain ka ki ke ko se ho nahi every keeps keep cannot cant dont wont today yesterday again always never
days day time getting getting even many much really still`.split(/\s+/),
);

export interface TermCount {
  term: string;
  count: number;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ''))
    .filter((w) => w.length > 2 && !/^\d+$/.test(w));
}

/**
 * Counts single words and two-word phrases, once per ticket (a student repeating a word ten
 * times in one ticket should not outweigh ten different students). Phrases are only built
 * from words that are not stop words, next to each other.
 */
export function topTerms(texts: string[], limit = 15, minCount = 2): { words: TermCount[]; phrases: TermCount[] } {
  const words = new Map<string, number>();
  const phrases = new Map<string, number>();
  for (const text of texts) {
    const tokens = tokenize(text).map((w) => (STOP_WORDS.has(w) ? null : w));
    const seenWords = new Set<string>();
    const seenPhrases = new Set<string>();
    tokens.forEach((w, i) => {
      if (!w) return;
      seenWords.add(w);
      const next = tokens[i + 1];
      if (next) seenPhrases.add(`${w} ${next}`);
    });
    seenWords.forEach((w) => words.set(w, (words.get(w) ?? 0) + 1));
    seenPhrases.forEach((p) => phrases.set(p, (phrases.get(p) ?? 0) + 1));
  }
  const rank = (m: Map<string, number>) =>
    [...m.entries()]
      .filter(([, count]) => count >= minCount)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([term, count]) => ({ term, count }));
  return { words: rank(words), phrases: rank(phrases) };
}

// ---- phrases in short written feedback --------------------------------------------------------

/** Small words a phrase should not start or end with. They may sit inside one ("quick and clear"). */
const EDGE_WORDS = new Set(
  `a an the and or but if so to of in on at for with from by as is am are was were be been being i me my we our you your he she it its
they them their this that these those do did does have has had not no will would can could just than then`.split(/\s+/),
);

/**
 * The phrases people repeat in short comments, e.g. "problem fixed the same day" or "quick and clear".
 * Candidates are runs of 2 to 5 words inside one sentence or clause that start and end on a meaningful word.
 * Each comment counts a phrase once, and a phrase is dropped when a longer one that contains it was repeated
 * just as often, so the list shows the full phrase, not its fragments.
 */
export function topCommentPhrases(texts: string[], limit = 8, minCount = 2, maxWords = 5): TermCount[] {
  const counts = new Map<string, number>();
  for (const text of texts) {
    const seen = new Set<string>();
    for (const clause of text.toLowerCase().split(/[.!?,;:\n()]+/)) {
      const words = clause
        .replace(/[^a-z0-9'\s-]/g, ' ')
        .split(/\s+/)
        .map((w) => w.replace(/^['-]+|['-]+$/g, ''))
        .filter(Boolean);
      for (let i = 0; i < words.length; i++) {
        if (EDGE_WORDS.has(words[i])) continue;
        for (let n = 2; n <= maxWords && i + n <= words.length; n++) {
          if (EDGE_WORDS.has(words[i + n - 1])) continue;
          seen.add(words.slice(i, i + n).join(' '));
        }
      }
    }
    seen.forEach((p) => counts.set(p, (counts.get(p) ?? 0) + 1));
  }
  const repeated = [...counts].filter(([, c]) => c >= minCount);
  const whole = repeated.filter(([p, c]) => !repeated.some(([q, d]) => q !== p && q.length > p.length && d >= c && ` ${q} `.includes(` ${p} `)));
  return whole
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}
