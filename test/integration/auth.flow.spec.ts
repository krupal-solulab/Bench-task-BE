import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import {
  API_PREFIX,
  createTestApp,
  closeTestApp,
  clearInMemoryMongo,
  seedOrganization,
  seedUser,
  seedUserAndLogin,
  authHeader,
} from './setup/test-app';
import { api } from './setup/fixtures';

describe('auth flow (integration)', () => {
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

  it('register-organization -> login -> access protected route -> refresh rotates the token -> old refresh token is rejected -> logout revokes the rest', async () => {
    const organizationName = 'Flow Org';
    const email = 'flow@example.com';
    const password = 'Password123';

    const registerRes = await api(app).post(`/${API_PREFIX}/auth/register-organization`).send({
      organizationName,
      adminName: 'Flow User',
      adminEmail: email,
      adminPassword: password,
    });
    expect(registerRes.status).toBe(201);
    // POST /auth/register (self-register as a plain Developer) is gone; the only public
    // registration entry point now creates a brand-new organization and its first Admin.
    expect(registerRes.body.data.user.role).toBe(Role.ADMIN);
    expect(registerRes.body.data.user.organizationId).toEqual(expect.any(String));

    const loginRes = await api(app).post(`/${API_PREFIX}/auth/login`).send({ email, password });
    expect(loginRes.status).toBe(200);
    const tokensA = loginRes.body.data;
    expect(tokensA.accessToken).toEqual(expect.any(String));
    expect(tokensA.refreshToken).toEqual(expect.any(String));

    const meRes = await api(app)
      .get(`/${API_PREFIX}/auth/me`)
      .set(...authHeader(tokensA.accessToken));
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.email).toBe(email);
    expect(meRes.body.data.passwordHash).toBeUndefined();

    const refreshRes = await api(app)
      .post(`/${API_PREFIX}/auth/refresh`)
      .send({ refreshToken: tokensA.refreshToken });
    expect(refreshRes.status).toBe(200);
    const tokensB = refreshRes.body.data;
    expect(tokensB.refreshToken).not.toBe(tokensA.refreshToken);

    // Reusing the now-rotated-out refresh token must be rejected.
    const reuseRes = await api(app)
      .post(`/${API_PREFIX}/auth/refresh`)
      .send({ refreshToken: tokensA.refreshToken });
    expect(reuseRes.status).toBe(401);

    const logoutRes = await api(app)
      .post(`/${API_PREFIX}/auth/logout`)
      .set(...authHeader(tokensB.accessToken));
    expect(logoutRes.status).toBe(200);

    // logout revokes every refresh token for the user, including the current session's.
    const postLogoutRefresh = await api(app)
      .post(`/${API_PREFIX}/auth/refresh`)
      .send({ refreshToken: tokensB.refreshToken });
    expect(postLogoutRefresh.status).toBe(401);
  });

  it('rejects a wrong password on login', async () => {
    const org = await seedOrganization(app);
    await seedUser(app, {
      email: 'wrongpass@example.com',
      password: 'Correct123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const res = await api(app)
      .post(`/${API_PREFIX}/auth/login`)
      .send({ email: 'wrongpass@example.com', password: 'Incorrect123' });
    expect(res.status).toBe(401);
  });

  it('rejects login for a deactivated user', async () => {
    const org = await seedOrganization(app);
    await seedUser(app, {
      email: 'deactivated@example.com',
      password: 'Correct123',
      role: Role.DEVELOPER,
      organizationId: org.id,
      isActive: false,
    });
    const res = await api(app)
      .post(`/${API_PREFIX}/auth/login`)
      .send({ email: 'deactivated@example.com', password: 'Correct123' });
    expect(res.status).toBe(401);
  });

  it('rejects registration with a duplicate email', async () => {
    // Email uniqueness is global, not per-organization, so registering a second, entirely
    // separate organization with the same adminEmail must still 409.
    await api(app).post(`/${API_PREFIX}/auth/register-organization`).send({
      organizationName: 'Dupe Org One',
      adminName: 'First',
      adminEmail: 'dupe@example.com',
      adminPassword: 'Password123',
    });
    const res = await api(app).post(`/${API_PREFIX}/auth/register-organization`).send({
      organizationName: 'Dupe Org Two',
      adminName: 'Second',
      adminEmail: 'dupe@example.com',
      adminPassword: 'Password123',
    });
    expect(res.status).toBe(409);
  });

  it('GET /auth/me returns the expected shape', async () => {
    const org = await seedOrganization(app);
    const { accessToken, userDoc } = await seedUserAndLogin(app, {
      name: 'Shape Check',
      email: 'shape@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const res = await api(app)
      .get(`/${API_PREFIX}/auth/me`)
      .set(...authHeader(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: userDoc.id,
      name: 'Shape Check',
      email: 'shape@example.com',
      role: Role.MANAGER,
      isActive: true,
    });
    expect(res.body.data.passwordHash).toBeUndefined();
  });

  describe('PATCH /auth/me/password', () => {
    it('rejects with 409 when the current password is wrong', async () => {
      const org = await seedOrganization(app);
      const { accessToken } = await seedUserAndLogin(app, {
        email: 'changepass1@example.com',
        password: 'OldPass123',
        role: Role.DEVELOPER,
        organizationId: org.id,
      });
      const res = await api(app)
        .patch(`/${API_PREFIX}/auth/me/password`)
        .set(...authHeader(accessToken))
        .send({ currentPassword: 'WrongOldPass123', newPassword: 'NewPass123' });
      expect(res.status).toBe(409);
    });

    it('changes the password and revokes all sessions on success', async () => {
      const org = await seedOrganization(app);
      const { accessToken, refreshToken } = await seedUserAndLogin(app, {
        email: 'changepass2@example.com',
        password: 'OldPass123',
        role: Role.DEVELOPER,
        organizationId: org.id,
      });

      const res = await api(app)
        .patch(`/${API_PREFIX}/auth/me/password`)
        .set(...authHeader(accessToken))
        .send({ currentPassword: 'OldPass123', newPassword: 'NewPass123' });
      expect(res.status).toBe(200);

      // Old refresh token must now be revoked.
      const refreshRes = await api(app).post(`/${API_PREFIX}/auth/refresh`).send({ refreshToken });
      expect(refreshRes.status).toBe(401);

      // Old password no longer works; new password does.
      const oldLogin = await api(app)
        .post(`/${API_PREFIX}/auth/login`)
        .send({ email: 'changepass2@example.com', password: 'OldPass123' });
      expect(oldLogin.status).toBe(401);

      const newLogin = await api(app)
        .post(`/${API_PREFIX}/auth/login`)
        .send({ email: 'changepass2@example.com', password: 'NewPass123' });
      expect(newLogin.status).toBe(200);
    });
  });
});
