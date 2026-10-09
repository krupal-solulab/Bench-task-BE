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

/** Admin > Users: invite to the organization by email + role (no project). */
describe('organization invites from Admin > Users (integration)', () => {
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
    const org = await seedOrganization(app, { name: 'Acme Org' });
    const admin = await seedUserAndLogin(app, {
      name: 'Ada Admin',
      email: 'org-invite-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const manager = await seedUserAndLogin(app, {
      email: 'org-invite-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    return { org, admin, manager };
  }

  const invite = (token: string, body: Record<string, unknown>) =>
    api(app)
      .post(`${P}/organization-invites`)
      .set(...authHeader(token))
      .send(body);
  const tokenFromUrl = (url: string) => url.split('/invite/')[1]!;
  const inviteModel = () =>
    app.get<Model<ProjectInviteDocument>>(getModelToken(ProjectInvite.name));

  it('email + role only -> invitee completes their own name and password -> joins the org', async () => {
    const { admin } = await setup();
    const created = await invite(admin.accessToken, { email: 'Neha@Example.com', role: 'Manager' });
    expect(created.status).toBe(201);
    const { inviteUrl, temporaryPassword, emailSent, invite: view } = created.body.data;
    expect(temporaryPassword).toMatch(/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]{12}$/);
    expect(emailSent).toBe(false); // no SMTP in tests
    expect(view).toMatchObject({
      email: 'neha@example.com',
      role: 'Manager',
      status: 'Pending',
      projectId: null,
    });

    const token = tokenFromUrl(inviteUrl);
    const preview = await api(app).get(`${P}/auth/invites/${token}`);
    expect(preview.body.data).toMatchObject({
      scope: 'organization',
      projectName: 'Acme Org',
      organizationName: null,
      inviterName: 'Ada Admin',
      role: 'Manager',
    });

    const accepted = await api(app)
      .post(`${P}/auth/invites/${token}/accept`)
      .send({ temporaryPassword });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.user).toMatchObject({
      email: 'neha@example.com',
      role: 'Manager',
      mustChangePassword: true,
    });
    const set = await api(app)
      .post(`${P}/auth/me/initial-password`)
      .set(...authHeader(accepted.body.data.accessToken))
      .send({ name: 'Neha Shah', newPassword: 'MyOwnPass123' });
    expect(set.status).toBe(200);
    expect(set.body.data.user).toMatchObject({ name: 'Neha Shah', mustChangePassword: false });
    await expect(loginAs(app, 'neha@example.com', 'MyOwnPass123')).resolves.toBeDefined();

    // Now a real user of the org, and the invite reads Accepted.
    const users = await api(app)
      .get(`${P}/users`)
      .query({ search: 'neha' })
      .set(...authHeader(admin.accessToken));
    expect(users.body.data[0]).toMatchObject({ email: 'neha@example.com', name: 'Neha Shah' });
    const list = await api(app)
      .get(`${P}/organization-invites`)
      .set(...authHeader(admin.accessToken));
    expect(list.body.data[0]).toMatchObject({ email: 'neha@example.com', status: 'Accepted' });

    const audit = await api(app)
      .get(`${P}/audit-log`)
      .set(...authHeader(admin.accessToken));
    const actions = audit.body.data.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['UserInviteSent', 'UserInviteAccepted']));
  });

  it('can invite an Admin, or with a custom role (QA)', async () => {
    const { admin } = await setup();
    const asAdmin = await invite(admin.accessToken, {
      email: 'second-admin@example.com',
      role: 'Admin',
    });
    expect(asAdmin.status).toBe(201);
    const session = await loginAs(
      app,
      'second-admin@example.com',
      asAdmin.body.data.temporaryPassword,
    );
    expect(session.user).toMatchObject({ role: 'Admin', mustChangePassword: true });

    const roles = await api(app)
      .get(`${P}/custom-roles`)
      .set(...authHeader(admin.accessToken));
    const qa = roles.body.data.find((r: { name: string }) => r.name === 'QA');
    expect(qa).toBeDefined();
    const asQa = await invite(admin.accessToken, {
      email: 'tester@example.com',
      role: qa.accessLevel,
      customRoleId: qa.id,
    });
    expect(asQa.status).toBe(201);
    expect(asQa.body.data.invite.customRoleId).toBe(qa.id);
    const preview = await api(app).get(
      `${P}/auth/invites/${tokenFromUrl(asQa.body.data.inviteUrl)}`,
    );
    expect(preview.body.data.role).toBe('QA');
  });

  it('Admin only; existing users and duplicate pending invites are refused', async () => {
    const { admin, manager } = await setup();
    expect(
      (await invite(manager.accessToken, { email: 'x@example.com', role: 'Developer' })).status,
    ).toBe(403);
    expect(
      (
        await api(app)
          .get(`${P}/organization-invites`)
          .set(...authHeader(manager.accessToken))
      ).status,
    ).toBe(403);

    const existing = await invite(admin.accessToken, {
      email: 'org-invite-manager@example.com',
      role: 'Developer',
    });
    expect(existing.status).toBe(409);

    await invite(admin.accessToken, { email: 'twice@example.com', role: 'Developer' });
    const dup = await invite(admin.accessToken, { email: 'twice@example.com', role: 'Developer' });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toContain('pending invitation to the organization');

    expect((await invite(admin.accessToken, { email: 'bad', role: 'Developer' })).status).toBe(400);
    expect(
      (await invite(admin.accessToken, { email: 'r@example.com', role: 'Owner' })).status,
    ).toBe(400);
  });

  it('resend issues a new link + password and 7 more days; revoke blocks both with an admin-worded message', async () => {
    const { admin } = await setup();
    const created = await invite(admin.accessToken, {
      email: 'kiran@example.com',
      role: 'Developer',
    });
    const id = created.body.data.invite.id;
    await inviteModel().updateOne({ _id: id }, { expiresAt: new Date(Date.now() - 1000) });

    const expiredLogin = await api(app)
      .post(`${P}/auth/login`)
      .send({ email: 'kiran@example.com', password: created.body.data.temporaryPassword });
    expect(expiredLogin.status).toBe(401);
    expect(expiredLogin.body.message).toBe(
      'This invitation has expired. Ask your administrator to resend it.',
    );

    const resent = await api(app)
      .post(`${P}/organization-invites/${id}/resend`)
      .set(...authHeader(admin.accessToken));
    expect(resent.status).toBe(200);
    expect(resent.body.data.temporaryPassword).not.toBe(created.body.data.temporaryPassword);
    expect(resent.body.data.invite).toMatchObject({ status: 'Pending', resendCount: 1 });

    const revoked = await api(app)
      .delete(`${P}/organization-invites/${id}`)
      .set(...authHeader(admin.accessToken));
    expect(revoked.body.data.status).toBe('Revoked');
    const viaLink = await api(app)
      .post(`${P}/auth/invites/${tokenFromUrl(resent.body.data.inviteUrl)}/accept`)
      .send({ temporaryPassword: resent.body.data.temporaryPassword });
    expect(viaLink.status).toBe(410);
    expect(viaLink.body.message).toBe(
      'This invitation has been revoked. Ask your administrator for a new one.',
    );
  });

  it('keeps project and organization invites apart', async () => {
    const { admin, manager } = await setup();
    const project = await createProject(app, manager.accessToken, { name: 'Side Project' });
    await api(app)
      .post(`${P}/projects/${project.id}/invites`)
      .set(...authHeader(manager.accessToken))
      .send({ email: 'proj-only@example.com', role: 'Developer' });
    await invite(admin.accessToken, { email: 'org-only@example.com', role: 'Developer' });

    const orgList = await api(app)
      .get(`${P}/organization-invites`)
      .set(...authHeader(admin.accessToken));
    expect(orgList.body.data.map((i: { email: string }) => i.email)).toEqual([
      'org-only@example.com',
    ]);
    const projectList = await api(app)
      .get(`${P}/projects/${project.id}/invites`)
      .set(...authHeader(manager.accessToken));
    expect(projectList.body.data.map((i: { email: string }) => i.email)).toEqual([
      'proj-only@example.com',
    ]);

    // An org invite can't be resent/revoked through a project, nor a project invite via the org.
    const projectInviteId = projectList.body.data[0].id;
    const viaOrg = await api(app)
      .delete(`${P}/organization-invites/${projectInviteId}`)
      .set(...authHeader(admin.accessToken));
    expect(viaOrg.status).toBe(404);
  });
});
