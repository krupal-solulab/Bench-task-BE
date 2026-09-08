import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { TaskPriority } from 'src/common/enums/task-priority.enum';
import { TaskStatus } from 'src/common/enums/task-status.enum';
import {
  API_PREFIX,
  createTestApp,
  closeTestApp,
  clearInMemoryMongo,
  seedOrganization,
  seedUserAndLogin,
  authHeader,
} from './setup/test-app';
import { api, createProject, createTask } from './setup/fixtures';

describe('tasks CRUD (integration)', () => {
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

  async function seedFixtures() {
    const org = await seedOrganization(app);
    const manager = await seedUserAndLogin(app, {
      email: 'task-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: 'task-developer@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const otherDeveloper = await seedUserAndLogin(app, {
      email: 'task-developer-2@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, {
      name: 'Task CRUD Project',
      memberIds: [developer.userDoc.id, otherDeveloper.userDoc.id],
    });
    return { org, manager, developer, otherDeveloper, project };
  }

  it('creates, updates and soft-deletes a task as Manager', async () => {
    const { manager, project } = await seedFixtures();

    const created = await createTask(app, manager.accessToken, {
      title: 'Set up CI pipeline',
      project: project.id,
      priority: TaskPriority.P1,
    });
    expect(created.status).toBe(TaskStatus.TODO);
    expect(created.priority).toBe(TaskPriority.P1);

    const updateRes = await api(app)
      .patch(`/${API_PREFIX}/tasks/${created.id}`)
      .set(...authHeader(manager.accessToken))
      .send({ title: 'Set up CI/CD pipeline', priority: TaskPriority.P2 });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.title).toBe('Set up CI/CD pipeline');
    expect(updateRes.body.data.priority).toBe(TaskPriority.P2);

    const deleteRes = await api(app)
      .delete(`/${API_PREFIX}/tasks/${created.id}`)
      .set(...authHeader(manager.accessToken));
    expect(deleteRes.status).toBe(204);

    const getAfterDelete = await api(app)
      .get(`/${API_PREFIX}/tasks/${created.id}`)
      .set(...authHeader(manager.accessToken));
    expect(getAfterDelete.status).toBe(404);
  });

  it('walks the legal task status transition workflow and rejects an illegal jump', async () => {
    const { manager, project } = await seedFixtures();
    const task = await createTask(app, manager.accessToken, {
      title: 'Status workflow task',
      project: project.id,
      priority: TaskPriority.P2,
    });

    // Todo -> Review is illegal (must go through In Progress first).
    const illegal = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TaskStatus.REVIEW });
    expect(illegal.status).toBe(409);

    const toInProgress = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TaskStatus.IN_PROGRESS });
    expect(toInProgress.status).toBe(200);
    expect(toInProgress.body.data.status).toBe(TaskStatus.IN_PROGRESS);

    const toReview = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TaskStatus.REVIEW });
    expect(toReview.status).toBe(200);

    const toDone = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TaskStatus.DONE });
    expect(toDone.status).toBe(200);
    expect(toDone.body.data.status).toBe(TaskStatus.DONE);
    expect(toDone.body.data.completedAt).not.toBeNull();
  });

  it('a Developer assigned to a task can change its status but cannot delete it', async () => {
    const { manager, developer, project } = await seedFixtures();
    const task = await createTask(app, manager.accessToken, {
      title: 'Assigned task',
      project: project.id,
      priority: TaskPriority.P2,
      assignee: developer.userDoc.id,
    });

    const statusRes = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(developer.accessToken))
      .send({ status: TaskStatus.IN_PROGRESS });
    expect(statusRes.status).toBe(200);

    const deleteRes = await api(app)
      .delete(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(developer.accessToken));
    expect(deleteRes.status).toBe(403);
  });

  it('a Developer cannot change the status of a task assigned to someone else', async () => {
    const { manager, developer, otherDeveloper, project } = await seedFixtures();
    const task = await createTask(app, manager.accessToken, {
      title: 'Assigned to the other developer',
      project: project.id,
      priority: TaskPriority.P2,
      assignee: otherDeveloper.userDoc.id,
    });

    const res = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(developer.accessToken))
      .send({ status: TaskStatus.IN_PROGRESS });
    expect(res.status).toBe(403);
  });

  it('reassigning a task requires the new assignee to be a project member', async () => {
    const { org, manager, developer, project } = await seedFixtures();
    const outsider = await seedUserAndLogin(app, {
      email: 'task-outsider@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const task = await createTask(app, manager.accessToken, {
      title: 'Reassignment task',
      project: project.id,
      priority: TaskPriority.P2,
    });

    const invalid = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/assignee`)
      .set(...authHeader(manager.accessToken))
      .send({ assignee: outsider.userDoc.id });
    expect(invalid.status).toBe(400);

    const valid = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/assignee`)
      .set(...authHeader(manager.accessToken))
      .send({ assignee: developer.userDoc.id });
    expect(valid.status).toBe(200);
    expect(valid.body.data.assignee.id).toBe(developer.userDoc.id);

    // Unassign with null.
    const unassign = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/assignee`)
      .set(...authHeader(manager.accessToken))
      .send({ assignee: null });
    expect(unassign.status).toBe(200);
    expect(unassign.body.data.assignee).toBeNull();
  });

  it('records task activity for creation, status changes, and reassignment', async () => {
    const { manager, developer, project } = await seedFixtures();
    const task = await createTask(app, manager.accessToken, {
      title: 'Activity task',
      project: project.id,
      priority: TaskPriority.P2,
    });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TaskStatus.IN_PROGRESS });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/assignee`)
      .set(...authHeader(manager.accessToken))
      .send({ assignee: developer.userDoc.id });

    const res = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}/activity`)
      .set(...authHeader(manager.accessToken));
    expect(res.status).toBe(200);
    const actions = res.body.data.map((entry: { action: string }) => entry.action);
    expect(actions).toEqual(expect.arrayContaining(['created', 'status_changed', 'reassigned']));
  });

  it('cannot create a task in a Completed project', async () => {
    const { manager, project } = await seedFixtures();
    await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'In Progress' });
    await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'Completed' });

    const res = await api(app)
      .post(`/${API_PREFIX}/tasks`)
      .set(...authHeader(manager.accessToken))
      .send({ title: 'Too late task', project: project.id, priority: TaskPriority.P2 });
    expect(res.status).toBe(409);
  });
});
