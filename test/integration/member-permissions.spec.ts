import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { TaskPriority } from 'src/common/enums/task-priority.enum';
import {
  API_PREFIX,
  createTestApp,
  closeTestApp,
  clearInMemoryMongo,
  seedOrganization,
  seedUserAndLogin,
  authHeader,
} from './setup/test-app';
import { api, createProject, createSprint, createTask } from './setup/fixtures';

describe('per-project member permissions (integration)', () => {
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

  async function seedOrgUsers() {
    const org = await seedOrganization(app);
    const admin = await seedUserAndLogin(app, {
      email: 'perm-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const manager = await seedUserAndLogin(app, {
      email: 'perm-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: 'perm-developer@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const otherDeveloper = await seedUserAndLogin(app, {
      email: 'perm-developer-2@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    return { org, admin, manager, developer, otherDeveloper };
  }

  function grant(token: string, projectId: string, userId: string, patch: Record<string, boolean>) {
    return api(app)
      .patch(`/${API_PREFIX}/projects/${projectId}/members/${userId}/permissions`)
      .set(...authHeader(token))
      .send(patch);
  }

  it('a project with no grants behaves identically to today (regression)', async () => {
    const { admin, developer } = await seedOrgUsers();
    const project = await createProject(app, admin.accessToken, {
      name: 'No Grants Project',
      memberIds: [developer.userDoc.id],
    });

    const create = await api(app)
      .post(`/${API_PREFIX}/tasks`)
      .set(...authHeader(developer.accessToken))
      .send({ title: 'Task X', project: project.id, priority: TaskPriority.P2 });
    expect(create.status).toBe(403);

    const sprint = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints`)
      .set(...authHeader(developer.accessToken))
      .send({ name: 'Sprint 1', startDate: '2026-01-01', endDate: '2026-01-14' });
    expect(sprint.status).toBe(403);
  });

  it('a grant respects project scope - does not leak to another project the same user is a member of', async () => {
    const { admin, developer } = await seedOrgUsers();
    const projectA = await createProject(app, admin.accessToken, {
      name: 'Project A',
      memberIds: [developer.userDoc.id],
    });
    const projectB = await createProject(app, admin.accessToken, {
      name: 'Project B',
      memberIds: [developer.userDoc.id],
    });

    const grantRes = await grant(admin.accessToken, projectA.id, developer.userDoc.id, {
      canCreateTask: true,
    });
    expect(grantRes.status).toBe(200);

    const onA = await api(app)
      .post(`/${API_PREFIX}/tasks`)
      .set(...authHeader(developer.accessToken))
      .send({ title: 'On A', project: projectA.id, priority: TaskPriority.P2 });
    expect(onA.status).toBe(201);

    const onB = await api(app)
      .post(`/${API_PREFIX}/tasks`)
      .set(...authHeader(developer.accessToken))
      .send({ title: 'On B', project: projectB.id, priority: TaskPriority.P2 });
    expect(onB.status).toBe(403);
  });

  it('a grant is per-user - a different member of the same project without their own grant still gets 403', async () => {
    const { admin, developer, otherDeveloper } = await seedOrgUsers();
    const project = await createProject(app, admin.accessToken, {
      name: 'Shared Project',
      memberIds: [developer.userDoc.id, otherDeveloper.userDoc.id],
    });
    await grant(admin.accessToken, project.id, developer.userDoc.id, { canCreateTask: true });

    const asGranted = await api(app)
      .post(`/${API_PREFIX}/tasks`)
      .set(...authHeader(developer.accessToken))
      .send({ title: 'Task X', project: project.id, priority: TaskPriority.P2 });
    expect(asGranted.status).toBe(201);

    const asOther = await api(app)
      .post(`/${API_PREFIX}/tasks`)
      .set(...authHeader(otherDeveloper.accessToken))
      .send({ title: 'Task Y', project: project.id, priority: TaskPriority.P2 });
    expect(asOther.status).toBe(403);
  });

  it('canEditAnyTask lets a granted Developer edit (but not delete) a task they do not own', async () => {
    const { admin, developer } = await seedOrgUsers();
    const project = await createProject(app, admin.accessToken, {
      name: 'Edit Grant Project',
      memberIds: [developer.userDoc.id],
    });
    const task = await createTask(app, admin.accessToken, {
      title: 'Admin-created task',
      project: project.id,
      priority: TaskPriority.P2,
    });
    await grant(admin.accessToken, project.id, developer.userDoc.id, { canEditAnyTask: true });

    const edit = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(developer.accessToken))
      .send({ title: 'Edited by developer' });
    expect(edit.status).toBe(200);
    expect(edit.body.data.title).toBe('Edited by developer');

    const del = await api(app)
      .delete(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(developer.accessToken));
    expect(del.status).toBe(403);
  });

  it('canDeleteTask lets a granted Developer delete (but not edit) a task they do not own', async () => {
    const { admin, developer } = await seedOrgUsers();
    const project = await createProject(app, admin.accessToken, {
      name: 'Delete Grant Project',
      memberIds: [developer.userDoc.id],
    });
    const task = await createTask(app, admin.accessToken, {
      title: 'Admin-created task',
      project: project.id,
      priority: TaskPriority.P2,
    });
    await grant(admin.accessToken, project.id, developer.userDoc.id, { canDeleteTask: true });

    const edit = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(developer.accessToken))
      .send({ title: 'Should not be allowed' });
    expect(edit.status).toBe(403);

    const del = await api(app)
      .delete(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(developer.accessToken));
    expect(del.status).toBe(204);
  });

  it('canChangeAnyTaskStatus lets a granted Developer transition a task not assigned to them, still respecting workflow legality', async () => {
    const { admin, developer } = await seedOrgUsers();
    const project = await createProject(app, admin.accessToken, {
      name: 'Status Grant Project',
      memberIds: [developer.userDoc.id],
    });
    const task = await createTask(app, admin.accessToken, {
      title: 'Unassigned to developer',
      project: project.id,
      priority: TaskPriority.P2,
    });

    const beforeGrant = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(developer.accessToken))
      .send({ status: 'In Progress' });
    expect(beforeGrant.status).toBe(403);

    await grant(admin.accessToken, project.id, developer.userDoc.id, {
      canChangeAnyTaskStatus: true,
    });

    const legal = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(developer.accessToken))
      .send({ status: 'In Progress' });
    expect(legal.status).toBe(200);

    // The grant bypasses the ASSIGNMENT check, not the workflow's transition-legality check.
    const illegal = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(developer.accessToken))
      .send({ status: 'Done' });
    expect(illegal.status).toBe(409);
  });

  it('canManageSprints lets a granted Developer run the full sprint lifecycle and move tasks in/out', async () => {
    const { admin, developer } = await seedOrgUsers();
    const project = await createProject(app, admin.accessToken, {
      name: 'Sprint Grant Project',
      memberIds: [developer.userDoc.id],
    });
    const task = await createTask(app, admin.accessToken, {
      title: 'Sprintable task',
      project: project.id,
      priority: TaskPriority.P2,
    });
    await grant(admin.accessToken, project.id, developer.userDoc.id, { canManageSprints: true });

    const sprint = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints`)
      .set(...authHeader(developer.accessToken))
      .send({ name: 'Dev Sprint', startDate: '2026-01-01', endDate: '2026-01-14' });
    expect(sprint.status).toBe(201);
    const sprintId = sprint.body.data.id;

    const start = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprintId}/start`)
      .set(...authHeader(developer.accessToken));
    expect(start.status).toBe(201);

    const moveIn = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/sprint`)
      .set(...authHeader(developer.accessToken))
      .send({ sprintId });
    expect(moveIn.status).toBe(200);

    const rank = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/rank`)
      .set(...authHeader(developer.accessToken))
      .send({});
    // No before/afterTaskId with a single task in the list is a 400 (bad request shape), not a
    // 403 - proving the developer reached the service layer's business logic, not a permission wall.
    expect(rank.status).toBe(400);

    const complete = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprintId}/complete`)
      .set(...authHeader(developer.accessToken));
    expect(complete.status).toBe(201);

    const remove = await api(app)
      .delete(`/${API_PREFIX}/projects/${project.id}/sprints/${sprintId}`)
      .set(...authHeader(developer.accessToken));
    // A completed sprint can't be deleted (business rule, not a permission wall) - 409 proves the
    // developer reached that check rather than being rejected earlier for lacking permission.
    expect(remove.status).toBe(409);
  });

  it('revoking a grant immediately removes access', async () => {
    const { admin, developer } = await seedOrgUsers();
    const project = await createProject(app, admin.accessToken, {
      name: 'Revoke Project',
      memberIds: [developer.userDoc.id],
    });
    await grant(admin.accessToken, project.id, developer.userDoc.id, { canCreateTask: true });

    const before = await api(app)
      .post(`/${API_PREFIX}/tasks`)
      .set(...authHeader(developer.accessToken))
      .send({ title: 'Allowed', project: project.id, priority: TaskPriority.P2 });
    expect(before.status).toBe(201);

    await grant(admin.accessToken, project.id, developer.userDoc.id, { canCreateTask: false });

    const after = await api(app)
      .post(`/${API_PREFIX}/tasks`)
      .set(...authHeader(developer.accessToken))
      .send({ title: 'Blocked again', project: project.id, priority: TaskPriority.P2 });
    expect(after.status).toBe(403);
  });

  it('Admin and the owning Manager behavior is provably unchanged on a project with zero grants', async () => {
    const { admin, manager } = await seedOrgUsers();
    const project = await createProject(app, manager.accessToken, { name: 'Untouched Project' });

    const task = await createTask(app, manager.accessToken, {
      title: 'Manager task',
      project: project.id,
      priority: TaskPriority.P2,
    });
    const edit = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(manager.accessToken))
      .send({ title: 'Edited' });
    expect(edit.status).toBe(200);

    const sprint = await createSprint(app, admin.accessToken, project.id, {
      name: 'Sprint 1',
      startDate: '2026-01-01',
      endDate: '2026-01-14',
    });
    const start = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/start`)
      .set(...authHeader(admin.accessToken));
    expect(start.status).toBe(201);

    const del = await api(app)
      .delete(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(manager.accessToken));
    expect(del.status).toBe(204);
  });

  it('granting is itself gated - a non-owning Manager attempting to grant gets 403 (no self-escalation path)', async () => {
    const { admin, manager, developer } = await seedOrgUsers();
    // owned by admin, so `manager` is neither the org-Admin nor the owner
    const project = await createProject(app, admin.accessToken, {
      name: 'Escalation Guard Project',
      memberIds: [developer.userDoc.id],
    });

    const res = await grant(manager.accessToken, project.id, developer.userDoc.id, {
      canCreateTask: true,
    });
    expect(res.status).toBe(403);
  });

  it('rejects granting to the project owner (400) and to a non-member (404)', async () => {
    const { admin, manager, developer } = await seedOrgUsers();
    const project = await createProject(app, manager.accessToken, { name: 'Edge Case Project' });

    const targetingOwner = await grant(admin.accessToken, project.id, manager.userDoc.id, {
      canCreateTask: true,
    });
    expect(targetingOwner.status).toBe(400);

    const targetingNonMember = await grant(admin.accessToken, project.id, developer.userDoc.id, {
      canCreateTask: true,
    });
    expect(targetingNonMember.status).toBe(404);
  });

  it("a granted member's permissions are visible on the project response", async () => {
    const { admin, developer } = await seedOrgUsers();
    const project = await createProject(app, admin.accessToken, {
      name: 'Visible Grants Project',
      memberIds: [developer.userDoc.id],
    });
    await grant(admin.accessToken, project.id, developer.userDoc.id, {
      canCreateTask: true,
      canManageSprints: true,
    });

    const res = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}`)
      .set(...authHeader(admin.accessToken));
    expect(res.status).toBe(200);
    const memberRow = res.body.data.members.find(
      (m: { user: { id: string } }) => m.user.id === developer.userDoc.id,
    );
    expect(memberRow.permissions).toMatchObject({
      canCreateTask: true,
      canManageSprints: true,
      canEditAnyTask: false,
      canDeleteTask: false,
      canChangeAnyTaskStatus: false,
    });
  });
});
