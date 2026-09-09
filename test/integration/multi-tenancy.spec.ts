import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { OrganizationStatus } from 'src/common/enums/organization-status.enum';
import { TaskPriority } from 'src/common/enums/task-priority.enum';
import {
  API_PREFIX,
  createTestApp,
  closeTestApp,
  clearInMemoryMongo,
  seedOrganization,
  seedUserAndLogin,
  loginAs,
  registerOrganizationAndLogin,
  authHeader,
} from './setup/test-app';
import { api, createProject, createTask } from './setup/fixtures';

/**
 * Covers the multi-tenancy retrofit itself: cross-organization data isolation, org suspension
 * cutting off both existing sessions and new logins, the new public org-registration entry point,
 * and that user-creation always inherits the creating Admin's own organization. The platform/org
 * split (PlatformAdmin vs. everyone else, and the Platform Admin API) is covered separately in
 * platform-admin.spec.ts.
 */
describe('multi-tenancy (integration)', () => {
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

  /** A full org: Admin + Manager + Developer, one project (developer is a member) and one task. */
  async function seedOrgTeam(prefix: string) {
    const org = await seedOrganization(app);
    const admin = await seedUserAndLogin(app, {
      email: `${prefix}-admin@example.com`,
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const manager = await seedUserAndLogin(app, {
      email: `${prefix}-manager@example.com`,
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: `${prefix}-developer@example.com`,
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, {
      name: `${prefix} Project`,
      memberIds: [developer.userDoc.id],
    });
    const task = await createTask(app, manager.accessToken, {
      title: `${prefix} Task`,
      project: project.id,
      priority: TaskPriority.P2,
    });
    return { org, admin, manager, developer, project, task };
  }

  describe('cross-tenant isolation', () => {
    it("Org A's Admin gets 403 reading/writing Org B's project and task by id", async () => {
      const a = await seedOrgTeam('isoA');
      const b = await seedOrgTeam('isoB');

      const getProject = await api(app)
        .get(`/${API_PREFIX}/projects/${b.project.id}`)
        .set(...authHeader(a.admin.accessToken));
      expect(getProject.status).toBe(403);

      const patchProject = await api(app)
        .patch(`/${API_PREFIX}/projects/${b.project.id}`)
        .set(...authHeader(a.admin.accessToken))
        .send({ description: 'should not work' });
      expect(patchProject.status).toBe(403);

      const deleteProject = await api(app)
        .delete(`/${API_PREFIX}/projects/${b.project.id}`)
        .set(...authHeader(a.admin.accessToken));
      expect(deleteProject.status).toBe(403);

      const getTask = await api(app)
        .get(`/${API_PREFIX}/tasks/${b.task.id}`)
        .set(...authHeader(a.admin.accessToken));
      expect(getTask.status).toBe(403);

      const patchTaskStatus = await api(app)
        .patch(`/${API_PREFIX}/tasks/${b.task.id}/status`)
        .set(...authHeader(a.admin.accessToken))
        .send({ status: 'In Progress' });
      expect(patchTaskStatus.status).toBe(403);

      const deleteTask = await api(app)
        .delete(`/${API_PREFIX}/tasks/${b.task.id}`)
        .set(...authHeader(a.admin.accessToken));
      expect(deleteTask.status).toBe(403);
    });

    it("Org A's Admin gets 403 reading, posting, editing, or deleting comments on Org B's task (regression: assertTaskMember/assertCanModify previously bypassed org checks for any Admin)", async () => {
      const a = await seedOrgTeam('commentIsoA');
      const b = await seedOrgTeam('commentIsoB');

      const bComment = await api(app)
        .post(`/${API_PREFIX}/tasks/${b.task.id}/comments`)
        .set(...authHeader(b.developer.accessToken))
        .send({ body: "Org B developer's own comment" });
      expect(bComment.status).toBe(201);
      const bCommentId = bComment.body.data.id;

      const listRes = await api(app)
        .get(`/${API_PREFIX}/tasks/${b.task.id}/comments`)
        .set(...authHeader(a.admin.accessToken));
      expect(listRes.status).toBe(403);

      const createRes = await api(app)
        .post(`/${API_PREFIX}/tasks/${b.task.id}/comments`)
        .set(...authHeader(a.admin.accessToken))
        .send({ body: 'should not be allowed' });
      expect(createRes.status).toBe(403);

      const updateRes = await api(app)
        .patch(`/${API_PREFIX}/comments/${bCommentId}`)
        .set(...authHeader(a.admin.accessToken))
        .send({ body: 'should not be allowed' });
      expect(updateRes.status).toBe(403);

      const deleteRes = await api(app)
        .delete(`/${API_PREFIX}/comments/${bCommentId}`)
        .set(...authHeader(a.admin.accessToken));
      expect(deleteRes.status).toBe(403);
    });

    it('GET /users/:id for a cross-org user id is 404 (not 403), to avoid confirming the id exists elsewhere', async () => {
      const a = await seedOrgTeam('userIsoA');
      const b = await seedOrgTeam('userIsoB');

      const res = await api(app)
        .get(`/${API_PREFIX}/users/${b.developer.userDoc.id}`)
        .set(...authHeader(a.admin.accessToken));
      expect(res.status).toBe(404);
    });

    it("list endpoints (projects/tasks/users) never include another organization's data", async () => {
      const a = await seedOrgTeam('listIsoA');
      const b = await seedOrgTeam('listIsoB');

      const projectsRes = await api(app)
        .get(`/${API_PREFIX}/projects`)
        .set(...authHeader(a.admin.accessToken));
      expect(projectsRes.status).toBe(200);
      const projectIds = projectsRes.body.data.map((p: { id: string }) => p.id);
      expect(projectIds).toContain(a.project.id);
      expect(projectIds).not.toContain(b.project.id);

      const tasksRes = await api(app)
        .get(`/${API_PREFIX}/tasks`)
        .set(...authHeader(a.admin.accessToken));
      expect(tasksRes.status).toBe(200);
      const taskIds = tasksRes.body.data.map((t: { id: string }) => t.id);
      expect(taskIds).toContain(a.task.id);
      expect(taskIds).not.toContain(b.task.id);

      const usersRes = await api(app)
        .get(`/${API_PREFIX}/users`)
        .set(...authHeader(a.admin.accessToken));
      expect(usersRes.status).toBe(200);
      const userIds = usersRes.body.data.map((u: { id: string }) => u.id);
      expect(userIds).toContain(a.developer.userDoc.id);
      expect(userIds).not.toContain(b.developer.userDoc.id);
    });
  });

  describe('organization suspension', () => {
    it('suspending an org 401s an already-issued access token on its very next request and blocks a fresh login, then reactivating restores both', async () => {
      const org = await seedOrganization(app);
      const email = 'suspend-admin@example.com';
      const password = 'Password123';
      const admin = await seedUserAndLogin(app, {
        email,
        password,
        role: Role.ADMIN,
        organizationId: org.id,
      });
      const platformAdmin = await seedUserAndLogin(app, {
        email: 'suspend-platform-admin@example.com',
        password: 'Password123',
        role: Role.PLATFORM_ADMIN,
        organizationId: null,
      });

      // Sanity: works before suspension.
      const meBefore = await api(app)
        .get(`/${API_PREFIX}/auth/me`)
        .set(...authHeader(admin.accessToken));
      expect(meBefore.status).toBe(200);

      const suspendRes = await api(app)
        .patch(`/${API_PREFIX}/platform/organizations/${org.id}/status`)
        .set(...authHeader(platformAdmin.accessToken))
        .send({ status: OrganizationStatus.SUSPENDED });
      expect(suspendRes.status).toBe(200);
      expect(suspendRes.body.data.status).toBe(OrganizationStatus.SUSPENDED);

      // The already-issued access token is still cryptographically valid and unexpired, but every
      // request re-checks org status (JwtStrategy.validate), so it must now 401.
      const meAfterSuspend = await api(app)
        .get(`/${API_PREFIX}/auth/me`)
        .set(...authHeader(admin.accessToken));
      expect(meAfterSuspend.status).toBe(401);

      // A brand-new login attempt for that org's admin must also 401 (not a distinct status that
      // would confirm the org exists/is suspended).
      const loginAttempt = await api(app)
        .post(`/${API_PREFIX}/auth/login`)
        .send({ email, password });
      expect(loginAttempt.status).toBe(401);

      const reactivateRes = await api(app)
        .patch(`/${API_PREFIX}/platform/organizations/${org.id}/status`)
        .set(...authHeader(platformAdmin.accessToken))
        .send({ status: OrganizationStatus.ACTIVE });
      expect(reactivateRes.status).toBe(200);
      expect(reactivateRes.body.data.status).toBe(OrganizationStatus.ACTIVE);

      const meAfterReactivate = await api(app)
        .get(`/${API_PREFIX}/auth/me`)
        .set(...authHeader(admin.accessToken));
      expect(meAfterReactivate.status).toBe(200);

      const loginAfterReactivate = await loginAs(app, email, password);
      expect(loginAfterReactivate.accessToken).toEqual(expect.any(String));
    });
  });

  describe('POST /auth/register-organization', () => {
    it('creates exactly one new organization and one new Admin scoped to it, with an empty project list', async () => {
      const { accessToken, user } = await registerOrganizationAndLogin(app, {
        organizationName: 'Brand New Co',
        adminName: 'Brand New Admin',
        adminEmail: 'brand-new-admin@example.com',
        adminPassword: 'Password123',
      });
      expect((user as { role: Role }).role).toBe(Role.ADMIN);

      const projectsRes = await api(app)
        .get(`/${API_PREFIX}/projects`)
        .set(...authHeader(accessToken));
      expect(projectsRes.status).toBe(200);
      expect(projectsRes.body.data).toHaveLength(0);
    });
  });

  describe('POST /users org-forcing', () => {
    it("an Admin's created user always lands in the Admin's own organization", async () => {
      const org = await seedOrganization(app);
      const admin = await seedUserAndLogin(app, {
        email: 'forcing-admin@example.com',
        password: 'Password123',
        role: Role.ADMIN,
        organizationId: org.id,
      });

      const createRes = await api(app)
        .post(`/${API_PREFIX}/users`)
        .set(...authHeader(admin.accessToken))
        .send({
          name: 'Forced Org Dev',
          email: 'forced-org-dev@example.com',
          password: 'Password123',
          role: Role.DEVELOPER,
        });
      expect(createRes.status).toBe(201);
      expect(createRes.body.data.organizationId).toBe(org.id);
    });

    it('rejects an attempt to create or promote a user to PlatformAdmin (privilege escalation guard)', async () => {
      const org = await seedOrganization(app);
      const admin = await seedUserAndLogin(app, {
        email: 'escalation-admin@example.com',
        password: 'Password123',
        role: Role.ADMIN,
        organizationId: org.id,
      });

      const createRes = await api(app)
        .post(`/${API_PREFIX}/users`)
        .set(...authHeader(admin.accessToken))
        .send({
          name: 'Would-be Platform Admin',
          email: 'escalated@example.com',
          password: 'Password123',
          role: Role.PLATFORM_ADMIN,
        });
      expect(createRes.status).toBe(400);

      const developer = await seedUserAndLogin(app, {
        email: 'escalation-target@example.com',
        password: 'Password123',
        role: Role.DEVELOPER,
        organizationId: org.id,
      });
      const promoteRes = await api(app)
        .patch(`/${API_PREFIX}/users/${developer.userDoc.id}/role`)
        .set(...authHeader(admin.accessToken))
        .send({ role: Role.PLATFORM_ADMIN });
      expect(promoteRes.status).toBe(400);
    });
  });
});
