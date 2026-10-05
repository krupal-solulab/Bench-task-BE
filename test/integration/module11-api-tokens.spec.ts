import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Role } from 'src/common/enums/role.enum';
import { ApiToken } from 'src/modules/api-tokens/schemas/api-token.schema';
import {
  API_PREFIX,
  createTestApp,
  closeTestApp,
  clearInMemoryMongo,
  seedOrganization,
  seedUserAndLogin,
  authHeader,
} from './setup/test-app';
import { api, createProject } from './setup/fixtures';

/** Module 11 gap-closure: personal API tokens. */
describe('Module 11 - personal API tokens (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  afterEach(async () => {
    await clearInMemoryMongo();
  });

  async function seed() {
    const org = await seedOrganization(app, { name: 'm11t org', slug: 'm11t-org' });
    const admin = await seedUserAndLogin(app, {
      email: 'm11t-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const dev = await seedUserAndLogin(app, {
      email: 'm11t-dev@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const otherOrg = await seedOrganization(app, { name: 'm11t other', slug: 'm11t-other' });
    const outsider = await seedUserAndLogin(app, {
      email: 'm11t-out@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: otherOrg.id,
    });
    return { org, admin, dev, outsider };
  }

  function createToken(jwt: string, body: Record<string, unknown> = { name: 'CI' }) {
    return api(app)
      .post(`/${API_PREFIX}/api-tokens`)
      .set(...authHeader(jwt))
      .send(body);
  }

  const me = (token: string) =>
    api(app)
      .get(`/${API_PREFIX}/auth/me`)
      .set(...authHeader(token));

  it('creates a token shown once, stored hashed, and it authenticates as its owner', async () => {
    const { dev } = await seed();
    const created = await createToken(dev.accessToken, { name: 'CI pipeline' });
    expect(created.status).toBe(201);
    const { token, apiToken } = created.body.data;
    expect(token).toMatch(/^pat_[A-Za-z0-9_-]{40}$/);
    expect(apiToken).toMatchObject({ name: 'CI pipeline', prefix: token.slice(0, 12) });
    expect(apiToken.tokenHash).toBeUndefined();
    // Default 90-day expiry.
    const days = (new Date(apiToken.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);

    const stored = await app
      .get(getModelToken(ApiToken.name))
      .findById(apiToken.id)
      .select('+tokenHash')
      .lean();
    expect(stored.tokenHash).toHaveLength(64);
    expect(stored.tokenHash).not.toContain(token);

    const viaToken = await me(token);
    expect(viaToken.status).toBe(200);
    expect(viaToken.body.data.email).toBe('m11t-dev@example.com');

    const list = await api(app)
      .get(`/${API_PREFIX}/api-tokens`)
      .set(...authHeader(dev.accessToken));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].lastUsedAt).not.toBeNull();
    expect(list.body.data[0].token).toBeUndefined();
  });

  it('keeps the owner role: a Developer token cannot do Admin-only things', async () => {
    const { dev, admin } = await seed();
    const { token } = (await createToken(dev.accessToken)).body.data;
    const audit = await api(app)
      .get(`/${API_PREFIX}/audit-log`)
      .set(...authHeader(token));
    expect(audit.status).toBe(403);

    const adminToken = (await createToken(admin.accessToken)).body.data.token;
    const project = await createProject(app, adminToken, { name: 'Via token', key: 'VTK' });
    expect(project.name).toBe('Via token');
  });

  it('accepts "never" and rejects an unsupported expiry', async () => {
    const { dev } = await seed();
    const never = await createToken(dev.accessToken, { name: 'Forever', expiresInDays: null });
    expect(never.body.data.apiToken.expiresAt).toBeNull();
    expect((await createToken(dev.accessToken, { name: 'X', expiresInDays: 7 })).status).toBe(400);
    expect((await createToken(dev.accessToken, { name: '' })).status).toBe(400);
  });

  it('refuses token-management, profile, password, logout and impersonation with a token', async () => {
    const { admin, dev } = await seed();
    const { token } = (await createToken(admin.accessToken)).body.data;
    const calls = [
      () => api(app).get(`/${API_PREFIX}/api-tokens`),
      () => api(app).post(`/${API_PREFIX}/api-tokens`).send({ name: 'Nested' }),
      () => api(app).patch(`/${API_PREFIX}/auth/me`).send({ name: 'Hijacked' }),
      () =>
        api(app)
          .patch(`/${API_PREFIX}/auth/me/password`)
          .send({ currentPassword: 'Password123', newPassword: 'Password456' }),
      () => api(app).post(`/${API_PREFIX}/auth/logout-all`),
      () => api(app).post(`/${API_PREFIX}/auth/impersonate/${dev.userDoc.id}`),
    ];
    for (const call of calls) {
      const res = await call().set(...authHeader(token));
      expect(res.status).toBe(403);
    }
    // ...while reading through the token still works.
    expect((await me(token)).status).toBe(200);
  });

  it('rejects revoked, expired, unknown tokens and deactivated owners', async () => {
    const { admin, dev } = await seed();
    const first = (await createToken(dev.accessToken)).body.data;
    const revoke = await api(app)
      .delete(`/${API_PREFIX}/api-tokens/${first.apiToken.id}`)
      .set(...authHeader(dev.accessToken));
    expect(revoke.status).toBe(200);
    expect((await me(first.token)).status).toBe(401);

    const second = (await createToken(dev.accessToken)).body.data;
    await app
      .get(getModelToken(ApiToken.name))
      .updateOne({ _id: second.apiToken.id }, { expiresAt: new Date(Date.now() - 1000) });
    expect((await me(second.token)).status).toBe(401);

    expect((await me('pat_doesnotexist')).status).toBe(401);

    const third = (await createToken(dev.accessToken)).body.data;
    expect((await me(third.token)).status).toBe(200);
    await api(app)
      .patch(`/${API_PREFIX}/users/${dev.userDoc.id}/status`)
      .set(...authHeader(admin.accessToken))
      .send({ isActive: false });
    expect((await me(third.token)).status).toBe(401);
  });

  it('lets an Admin list and revoke org tokens, but not other orgs or as a non-admin', async () => {
    const { admin, dev, outsider } = await seed();
    const devToken = (await createToken(dev.accessToken, { name: 'Dev CLI' })).body.data;
    await createToken(outsider.accessToken, { name: 'Elsewhere' });

    const orgList = await api(app)
      .get(`/${API_PREFIX}/api-tokens/org`)
      .set(...authHeader(admin.accessToken));
    expect(orgList.status).toBe(200);
    expect(orgList.body.data.map((t: { name: string }) => t.name)).toEqual(['Dev CLI']);
    expect(orgList.body.data[0].owner).toMatchObject({ email: 'm11t-dev@example.com' });

    const devCannotList = await api(app)
      .get(`/${API_PREFIX}/api-tokens/org`)
      .set(...authHeader(dev.accessToken));
    expect(devCannotList.status).toBe(403);

    const outsiderRevoke = await api(app)
      .delete(`/${API_PREFIX}/api-tokens/org/${devToken.apiToken.id}`)
      .set(...authHeader(outsider.accessToken));
    expect(outsiderRevoke.status).toBe(404);
    // A plain user can't revoke someone else's token through the self route either.
    const adminSelfRoute = await api(app)
      .delete(`/${API_PREFIX}/api-tokens/${devToken.apiToken.id}`)
      .set(...authHeader(admin.accessToken));
    expect(adminSelfRoute.status).toBe(404);

    const adminRevoke = await api(app)
      .delete(`/${API_PREFIX}/api-tokens/org/${devToken.apiToken.id}`)
      .set(...authHeader(admin.accessToken));
    expect(adminRevoke.status).toBe(200);
    expect((await me(devToken.token)).status).toBe(401);

    const audit = await api(app)
      .get(`/${API_PREFIX}/audit-log`)
      .set(...authHeader(admin.accessToken));
    const actions = audit.body.data.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['ApiTokenCreated', 'ApiTokenRevoked']));
  });

  it('caps active tokens at 20 per user', async () => {
    const { dev } = await seed();
    for (let i = 0; i < 20; i++) {
      expect((await createToken(dev.accessToken, { name: `t${i}` })).status).toBe(201);
    }
    expect((await createToken(dev.accessToken, { name: 'one too many' })).status).toBe(400);
  });

  it('leaves normal JWT sessions unchanged', async () => {
    const { dev } = await seed();
    expect((await me(dev.accessToken)).status).toBe(200);
    const patched = await api(app)
      .patch(`/${API_PREFIX}/auth/me`)
      .set(...authHeader(dev.accessToken))
      .send({ name: 'Still Fine' });
    expect(patched.status).toBe(200);
  });
});
