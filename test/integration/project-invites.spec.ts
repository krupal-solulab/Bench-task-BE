import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Role } from 'src/common/enums/role.enum';
import {
  ProjectInvite,
  ProjectInviteDocument,
} from 'src/modules/project-invites/schemas/project-invite.schema';
import {
  API_PREFIX,
  authHeader,
  clearInMemoryMongo,
  closeTestApp,
  createTestApp,
  loginAs,
  seedOrganization,
  seedUserAndLogin,
} from './setup/test-app';
import { api, createProject } from './setup/fixtures';

const P = `/${API_PREFIX}`;

describe('project invites with temporary passwords (integration)', () => {
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

  async function setup() {
    const org = await seedOrganization(app, { name: 'Invite Org' });
    const manager = await seedUserAndLogin(app, {
      name: 'Owner Manager',
      email: 'invite-owner@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const otherManager = await seedUserAndLogin(app, {
      email: 'invite-other-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: 'invite-dev@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, { name: 'Invite Project' });
    return { org, manager, otherManager, developer, project };
  }

  function invite(token: string, projectId: string, body: Record<string, unknown>) {
    return api(app)
      .post(`${P}/projects/${projectId}/invites`)
      .set(...authHeader(token))
      .send(body);
  }

  function tokenFromUrl(url: string): string {
    return url.split('/invite/')[1]!;
  }

  const inviteModel = () =>
    app.get<Model<ProjectInviteDocument>>(getModelToken(ProjectInvite.name));

  it('invite link -> temporary password -> forced password change -> full access', async () => {
    const { manager, project } = await setup();

    const created = await invite(manager.accessToken, project.id, {
      email: 'Asha@Example.com',
      role: Role.DEVELOPER,
    });
    expect(created.status).toBe(201);
    const { inviteUrl, temporaryPassword, emailSent, invite: view } = created.body.data;
    expect(temporaryPassword).toMatch(/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]{12}$/);
    expect(inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
    // No SMTP in tests: the email is only logged, so the inviter is told to share it themselves.
    expect(emailSent).toBe(false);
    expect(view).toMatchObject({ email: 'asha@example.com', status: 'Pending', role: 'Developer' });
    expect(view.tokenHash).toBeUndefined();
    expect(view.tempPasswordHash).toBeUndefined();
    const token = tokenFromUrl(inviteUrl);

    const preview = await api(app).get(`${P}/auth/invites/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body.data.name).toBeUndefined();
    expect(preview.body.data).toMatchObject({
      status: 'Pending',
      email: 'asha@example.com',
      projectName: 'Invite Project',
      organizationName: 'Invite Org',
      inviterName: 'Owner Manager',
    });

    const wrong = await api(app)
      .post(`${P}/auth/invites/${token}/accept`)
      .send({ temporaryPassword: 'not-it-123' });
    expect(wrong.status).toBe(401);

    const accepted = await api(app)
      .post(`${P}/auth/invites/${token}/accept`)
      .send({ temporaryPassword });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.user).toMatchObject({
      email: 'asha@example.com',
      name: 'asha', // placeholder until they enter their own
      role: 'Developer',
      mustChangePassword: true,
    });
    const tempAccess = accepted.body.data.accessToken as string;

    // Joined the project, and the invite reads Accepted.
    const members = await api(app)
      .get(`${P}/projects/${project.id}/members`)
      .set(...authHeader(manager.accessToken));
    expect(members.body.data.map((m: { user: { email: string } }) => m.user.email)).toContain(
      'asha@example.com',
    );
    const list = await api(app)
      .get(`${P}/projects/${project.id}/invites`)
      .set(...authHeader(manager.accessToken));
    expect(list.body.data[0].status).toBe('Accepted');

    // Until a new password is set, everything but the allow-listed auth routes is refused.
    const blocked = await api(app)
      .get(`${P}/projects`)
      .set(...authHeader(tempAccess));
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toBe('You must set a new password before continuing');
    const me = await api(app)
      .get(`${P}/auth/me`)
      .set(...authHeader(tempAccess));
    expect(me.status).toBe(200);

    const reused = await api(app)
      .post(`${P}/auth/me/initial-password`)
      .set(...authHeader(tempAccess))
      .send({ name: 'Asha Patel', newPassword: temporaryPassword });
    expect(reused.status).toBe(400);

    const set = await api(app)
      .post(`${P}/auth/me/initial-password`)
      .set(...authHeader(tempAccess))
      .send({ name: 'Asha Patel', newPassword: 'MyOwnPass123' });
    expect(set.status).toBe(200);
    // The invitee entered their own name - the owner never gave one.
    expect(set.body.data.user).toMatchObject({ mustChangePassword: false, name: 'Asha Patel' });

    const unblocked = await api(app)
      .get(`${P}/projects`)
      .set(...authHeader(set.body.data.accessToken));
    expect(unblocked.status).toBe(200);

    // The temporary password is dead; the chosen one works; the link can't be reused.
    await expect(loginAs(app, 'asha@example.com', temporaryPassword)).rejects.toThrow();
    await expect(loginAs(app, 'asha@example.com', 'MyOwnPass123')).resolves.toBeDefined();
    const again = await api(app)
      .post(`${P}/auth/invites/${token}/accept`)
      .send({ temporaryPassword });
    expect(again.status).toBe(409);
  });

  it('the regular login form accepts an invite with email + temporary password', async () => {
    const { manager, project } = await setup();
    const created = await invite(manager.accessToken, project.id, {
      email: 'ravi@example.com',
      role: Role.MANAGER,
    });

    const session = await loginAs(app, 'ravi@example.com', created.body.data.temporaryPassword);

    expect(session.user).toMatchObject({ role: 'Manager', mustChangePassword: true });
    const project2 = await api(app)
      .get(`${P}/projects/${project.id}`)
      .set(...authHeader(manager.accessToken));
    expect(
      project2.body.data.members.map((m: { user: { email: string } }) => m.user.email),
    ).toContain('ravi@example.com');
  });

  it('a revoked invite is refused on both the link and the login form, with a clear message', async () => {
    const { manager, project } = await setup();
    const created = await invite(manager.accessToken, project.id, {
      email: 'revoked@example.com',
      role: Role.DEVELOPER,
    });
    const { temporaryPassword, inviteUrl, invite: view } = created.body.data;

    const revoked = await api(app)
      .delete(`${P}/projects/${project.id}/invites/${view.id}`)
      .set(...authHeader(manager.accessToken));
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.status).toBe('Revoked');

    const viaLink = await api(app)
      .post(`${P}/auth/invites/${tokenFromUrl(inviteUrl)}/accept`)
      .send({ temporaryPassword });
    expect(viaLink.status).toBe(410);
    expect(viaLink.body.message).toMatch(/revoked/);

    const viaLogin = await api(app)
      .post(`${P}/auth/login`)
      .send({ email: 'revoked@example.com', password: temporaryPassword });
    expect(viaLogin.status).toBe(401);
    expect(viaLogin.body.message).toMatch(/revoked/);

    // A wrong password for the same email stays the generic error - nothing is disclosed.
    const guess = await api(app)
      .post(`${P}/auth/login`)
      .send({ email: 'revoked@example.com', password: 'guess12345' });
    expect(guess.body.message).toBe('Invalid email or password');
  });

  it('an expired invite is refused; resending issues a new password/link and 7 more days', async () => {
    const { manager, project } = await setup();
    const created = await invite(manager.accessToken, project.id, {
      email: 'late@example.com',
      role: Role.DEVELOPER,
    });
    const old = created.body.data;
    await inviteModel().updateOne(
      { _id: old.invite.id },
      { expiresAt: new Date(Date.now() - 1000) },
    );

    const list = await api(app)
      .get(`${P}/projects/${project.id}/invites`)
      .set(...authHeader(manager.accessToken));
    expect(list.body.data[0].status).toBe('Expired');

    const expired = await api(app)
      .post(`${P}/auth/login`)
      .send({ email: 'late@example.com', password: old.temporaryPassword });
    expect(expired.status).toBe(401);
    expect(expired.body.message).toMatch(/expired/);

    const resent = await api(app)
      .post(`${P}/projects/${project.id}/invites/${old.invite.id}/resend`)
      .set(...authHeader(manager.accessToken));
    expect(resent.status).toBe(200);
    expect(resent.body.data.temporaryPassword).not.toBe(old.temporaryPassword);
    expect(resent.body.data.invite).toMatchObject({ status: 'Pending', resendCount: 1 });
    const days = (new Date(resent.body.data.invite.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);

    // The old link and password no longer work; the new ones do.
    const oldLink = await api(app).get(`${P}/auth/invites/${tokenFromUrl(old.inviteUrl)}`);
    expect(oldLink.status).toBe(404);
    await expect(loginAs(app, 'late@example.com', old.temporaryPassword)).rejects.toThrow();
    await expect(
      loginAs(app, 'late@example.com', resent.body.data.temporaryPassword),
    ).resolves.toBeDefined();
  });

  it('only the owning Manager or an Admin may invite; existing users and duplicates are refused', async () => {
    const { manager, otherManager, developer, project } = await setup();
    const body = { email: 'someone@example.com', role: Role.DEVELOPER };

    expect((await invite(developer.accessToken, project.id, body)).status).toBe(403);
    expect((await invite(otherManager.accessToken, project.id, body)).status).toBe(403);

    const existing = await invite(manager.accessToken, project.id, {
      ...body,
      email: 'invite-dev@example.com',
    });
    expect(existing.status).toBe(409);
    expect(existing.body.message).toMatch(/already exists/);

    expect((await invite(manager.accessToken, project.id, body)).status).toBe(201);
    const duplicate = await invite(manager.accessToken, project.id, body);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.message).toMatch(/pending invitation to this project/);

    const adminRole = await invite(manager.accessToken, project.id, {
      ...body,
      email: 'admin-wannabe@example.com',
      role: Role.ADMIN,
    });
    expect(adminRole.status).toBe(400);
  });

  it('Managers can now be added as existing members, and candidates exclude current members', async () => {
    const { manager, otherManager, developer, project } = await setup();

    const before = await api(app)
      .get(`${P}/projects/${project.id}/member-candidates`)
      .set(...authHeader(manager.accessToken));
    const beforeEmails = before.body.data.map((u: { email: string }) => u.email);
    expect(beforeEmails).toEqual(
      expect.arrayContaining(['invite-dev@example.com', 'invite-other-manager@example.com']),
    );
    expect(beforeEmails).not.toContain('invite-owner@example.com');

    const added = await api(app)
      .post(`${P}/projects/${project.id}/members`)
      .set(...authHeader(manager.accessToken))
      .send({ userIds: [otherManager.userDoc.id, developer.userDoc.id] });
    expect(added.status).toBe(201);

    const after = await api(app)
      .get(`${P}/projects/${project.id}/member-candidates`)
      .set(...authHeader(manager.accessToken));
    expect(after.body.data).toHaveLength(0);
  });
});
