/**
 * Minimal in-memory stand-in for the ioredis client, supporting only the exact method
 * signatures `CacheService` (src/redis/cache.service.ts) actually calls: `get`, `set` with
 * `'EX', ttl`, `del` with spread keys, and `scan` with cursor/MATCH/COUNT returning
 * `[nextCursor, keys]`. Backed by a plain Map so state persists across calls within a test,
 * which is what lets dashboard.spec.ts assert a real cache MISS -> HIT transition.
 */
export class FakeRedis {
  private readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  async set(key: string, value: string, _mode: 'EX', _ttlSeconds: number): Promise<'OK'> {
    this.store.set(key, value);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (this.store.delete(key)) deleted += 1;
    }
    return deleted;
  }

  async scan(
    _cursor: string,
    _matchFlag: 'MATCH',
    pattern: string,
    _countFlag: 'COUNT',
    _count: number,
  ): Promise<[string, string[]]> {
    const regex = globToRegExp(pattern);
    const keys = [...this.store.keys()].filter((key) => regex.test(key));
    // Everything is scanned in one pass, so we always report cursor '0' (scan complete).
    return ['0', keys];
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

/** Translates a redis glob pattern (only `*` is used by this codebase) into a RegExp. */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}
