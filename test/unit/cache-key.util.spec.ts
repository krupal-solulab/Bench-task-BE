import { buildDashboardCacheKey, dashboardCachePattern } from 'src/common/utils/cache-key.util';

describe('cache-key.util', () => {
  describe('buildDashboardCacheKey', () => {
    it('builds a versioned, namespaced key from endpoint/role/userId/query', () => {
      const key = buildDashboardCacheKey('summary', 'Admin', 'user-1', { projectId: 'p-1' });
      expect(key).toMatch(/^dash:v1:summary:Admin:user-1:[a-f0-9]{16}$/);
    });

    it('produces the same key for the same query regardless of key order', () => {
      const a = buildDashboardCacheKey('summary', 'Admin', 'user-1', { a: '1', b: '2' });
      const b = buildDashboardCacheKey('summary', 'Admin', 'user-1', { b: '2', a: '1' });
      expect(a).toBe(b);
    });

    it('produces different keys for different query values', () => {
      const a = buildDashboardCacheKey('summary', 'Admin', 'user-1', { projectId: 'p-1' });
      const b = buildDashboardCacheKey('summary', 'Admin', 'user-1', { projectId: 'p-2' });
      expect(a).not.toBe(b);
    });

    it('scopes the key by role and userId so different callers never collide', () => {
      const admin = buildDashboardCacheKey('summary', 'Admin', 'user-1', {});
      const manager = buildDashboardCacheKey('summary', 'Manager', 'user-1', {});
      const otherUser = buildDashboardCacheKey('summary', 'Admin', 'user-2', {});
      expect(admin).not.toBe(manager);
      expect(admin).not.toBe(otherUser);
    });
  });

  describe('dashboardCachePattern', () => {
    it('returns a wildcard pattern under the same version prefix used by real keys', () => {
      const pattern = dashboardCachePattern();
      const realKey = buildDashboardCacheKey('summary', 'Admin', 'user-1', {});
      expect(pattern).toBe('dash:v1:*');
      expect(realKey.startsWith('dash:v1:')).toBe(true);
    });
  });
});
