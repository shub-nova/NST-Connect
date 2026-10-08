import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';

/** The few Redis commands this needs (the Upstash client has all of them). */
export interface RedisLike {
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<unknown>;
  pttl(key: string): Promise<number>;
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: string, opts: { px: number }): Promise<unknown>;
}

/**
 * Rate-limit counters kept in Redis, so every serverless instance shares one count. (The built-in store
 * lives in each instance's memory, which on Vercel means every request could land on a fresh counter.)
 * If Redis cannot be reached it fails open: requests are allowed, because a rate-limit outage must not
 * lock everyone out of the app.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(private readonly redis: RedisLike) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const hitKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `${hitKey}:blocked`;
    try {
      const blockedFor = await this.redis.pttl(blockKey);
      if (blockedFor > 0) {
        const hits = Number((await this.redis.get<number>(hitKey)) ?? limit + 1);
        return { totalHits: hits, timeToExpire: Math.ceil(blockedFor / 1000), isBlocked: true, timeToBlockExpire: Math.ceil(blockedFor / 1000) };
      }

      const hits = await this.redis.incr(hitKey);
      if (hits === 1) await this.redis.pexpire(hitKey, ttl);
      let remaining = await this.redis.pttl(hitKey);
      if (remaining < 0) {
        await this.redis.pexpire(hitKey, ttl); // a counter must never live forever
        remaining = ttl;
      }

      if (hits > limit && blockDuration > 0) {
        await this.redis.set(blockKey, '1', { px: blockDuration });
        return { totalHits: hits, timeToExpire: Math.ceil(remaining / 1000), isBlocked: true, timeToBlockExpire: Math.ceil(blockDuration / 1000) };
      }
      return { totalHits: hits, timeToExpire: Math.ceil(remaining / 1000), isBlocked: hits > limit, timeToBlockExpire: 0 };
    } catch (err) {
      this.logger.warn(`Rate limiting store unavailable, allowing the request: ${(err as Error).message}`);
      return { totalHits: 1, timeToExpire: Math.ceil(ttl / 1000), isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}
