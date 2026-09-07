import { createHash } from 'crypto';

const CACHE_VERSION = 'v1';

export function buildDashboardCacheKey(
  endpoint: string,
  role: string,
  userId: string,
  query: Record<string, unknown>,
): string {
  const hash = hashQuery(query);
  return `dash:${CACHE_VERSION}:${endpoint}:${role}:${userId}:${hash}`;
}

export function dashboardCachePattern(): string {
  return `dash:${CACHE_VERSION}:*`;
}

function hashQuery(query: Record<string, unknown>): string {
  const sortedKeys = Object.keys(query).sort();
  const normalized = sortedKeys.map((key) => `${key}=${String(query[key])}`).join('&');
  return createHash('sha1').update(normalized).digest('hex').slice(0, 16);
}
