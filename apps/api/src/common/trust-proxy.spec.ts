import { resolveTrustProxy } from './trust-proxy';

describe('resolveTrustProxy', () => {
  it('trusts the proxy on Vercel even when nothing is configured', () => {
    expect(resolveTrustProxy(undefined, true)).toBe(true);
    expect(resolveTrustProxy('', true)).toBe(true);
  });

  it('does not trust a proxy elsewhere unless it is asked to', () => {
    expect(resolveTrustProxy(undefined, false)).toBeUndefined();
    expect(resolveTrustProxy('true', false)).toBe(true);
    expect(resolveTrustProxy('1', false)).toBe(1);
    expect(resolveTrustProxy('loopback', false)).toBe('loopback');
  });

  it('lets the setting win, including turning it off', () => {
    expect(resolveTrustProxy('false', true)).toBe(false);
    expect(resolveTrustProxy('2', true)).toBe(2);
  });
});
