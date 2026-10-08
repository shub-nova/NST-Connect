import { RedisThrottlerStorage, type RedisLike } from './redis-throttler.storage';

/** A tiny in-memory Redis with a controllable clock. */
function fakeRedis() {
  let now = 0;
  const data = new Map<string, { value: string; expiresAt: number | null }>();
  const alive = (k: string) => {
    const e = data.get(k);
    if (e && e.expiresAt !== null && e.expiresAt <= now) data.delete(k);
    return data.get(k);
  };
  const redis: RedisLike = {
    async incr(k) {
      const e = alive(k);
      const next = (e ? Number(e.value) : 0) + 1;
      data.set(k, { value: String(next), expiresAt: e?.expiresAt ?? null });
      return next;
    },
    async pexpire(k, ms) {
      const e = alive(k);
      if (e) e.expiresAt = now + ms;
      return 1;
    },
    async pttl(k) {
      const e = alive(k);
      if (!e) return -2;
      return e.expiresAt === null ? -1 : e.expiresAt - now;
    },
    async get<T>(k: string) {
      const e = alive(k);
      return (e ? (Number(e.value) as unknown as T) : null) as T | null;
    },
    async set(k, v, opts) {
      data.set(k, { value: v, expiresAt: now + opts.px });
      return 'OK';
    },
  };
  return { redis, advance: (ms: number) => (now += ms) };
}

describe('RedisThrottlerStorage', () => {
  it('counts hits across calls and blocks above the limit', async () => {
    const { redis } = fakeRedis();
    const store = new RedisThrottlerStorage(redis);
    const hit = () => store.increment('1.2.3.4', 60_000, 3, 0, 'default');
    expect((await hit()).isBlocked).toBe(false);
    expect((await hit()).totalHits).toBe(2);
    expect((await hit()).isBlocked).toBe(false);
    const over = await hit();
    expect(over).toMatchObject({ totalHits: 4, isBlocked: true });
  });

  it('starts counting again after the window passes', async () => {
    const { redis, advance } = fakeRedis();
    const store = new RedisThrottlerStorage(redis);
    for (let i = 0; i < 5; i++) await store.increment('ip', 60_000, 2, 0, 'default');
    advance(60_001);
    expect(await store.increment('ip', 60_000, 2, 0, 'default')).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('keeps visitors and limiters separate', async () => {
    const { redis } = fakeRedis();
    const store = new RedisThrottlerStorage(redis);
    await store.increment('a', 60_000, 1, 0, 'default');
    await store.increment('a', 60_000, 1, 0, 'default');
    expect((await store.increment('b', 60_000, 1, 0, 'default')).isBlocked).toBe(false);
    expect((await store.increment('a', 60_000, 1, 0, 'login')).isBlocked).toBe(false);
  });

  it('holds a block for its full duration', async () => {
    const { redis, advance } = fakeRedis();
    const store = new RedisThrottlerStorage(redis);
    await store.increment('ip', 1_000, 1, 30_000, 'default');
    await store.increment('ip', 1_000, 1, 30_000, 'default'); // over the limit: blocked for 30s
    advance(5_000);
    expect(await store.increment('ip', 1_000, 1, 30_000, 'default')).toMatchObject({ isBlocked: true });
    advance(30_000);
    expect((await store.increment('ip', 1_000, 1, 30_000, 'default')).isBlocked).toBe(false);
  });

  it('lets requests through when Redis is down', async () => {
    const broken: RedisLike = {
      incr: () => Promise.reject(new Error('connection refused')),
      pexpire: () => Promise.reject(new Error('x')),
      pttl: () => Promise.reject(new Error('x')),
      get: () => Promise.reject(new Error('x')),
      set: () => Promise.reject(new Error('x')),
    };
    expect(await new RedisThrottlerStorage(broken).increment('ip', 60_000, 1, 0, 'default')).toMatchObject({ isBlocked: false });
  });
});
