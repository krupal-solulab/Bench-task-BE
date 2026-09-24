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
import { api, createProject, createTask } from './setup/fixtures';

describe('bulk status/priority/delete (Module 5 - Bulk Operations)', () => {
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
      email: 'bulk5-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: 'bulk5-developer@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, {
      name: 'Bulk5 Project',
      memberIds: [developer.userDoc.id],
    });
    return { org, manager, developer, project };
  }

  it('bulk-transitions multiple tasks to the same status', async () => {
    const { manager, project } = await seedFixtures();
    const taskA = await createTask(app, manager.accessToken, {
      title: 'Task A',
      project: project.id,
      priority: TaskPriority.P2,
    });
    const taskB = await createTask(app, manager.accessToken, {
      title: 'Task B',
      project: project.id,
      priority: TaskPriority.P2,
    });

    const res = await api(app)
      .patch(`/${API_PREFIX}/tasks/bulk-status`)
      .set(...authHeader(manager.accessToken))
      .send({ taskIds: [taskA.id, taskB.id], status: 'In Progress' });
    expect(res.status).toBe(200);
    expect(res.body.data.succeeded).toEqual(expect.arrayContaining([taskA.id, taskB.id]));
    expect(res.body.data.failed).toEqual([]);

    const detailA = await api(app)
      .get(`/${API_PREFIX}/tasks/${taskA.id}`)
      .set(...authHeader(manager.accessToken));
    expect(detailA.body.data.status).toBe('In Progress');
  });

  it('reports a per-task failure for an illegal status without failing the whole batch', async () => {
    const { manager, project } = await seedFixtures();
    const taskA = await createTask(app, manager.accessToken, {
      title: 'Task A',
      project: project.id,
      priority: TaskPriority.P2,
    });

    const res = await api(app)
      .patch(`/${API_PREFIX}/tasks/bulk-status`)
      .set(...authHeader(manager.accessToken))
      .send({ taskIds: [taskA.id], status: 'Not A Real Status' });
    expect(res.status).toBe(200);
    expect(res.body.data.succeeded).toEqual([]);
    expect(res.body.data.failed).toHaveLength(1);
    expect(res.body.data.failed[0].taskId).toBe(taskA.id);
  });

  it('bulk-sets priority on multiple tasks', async () => {
    const { manager, project } = await seedFixtures();
    const taskA = await createTask(app, manager.accessToken, {
      title: 'Task A',
      project: project.id,
      priority: TaskPriority.P3,
    });
    const taskB = await createTask(app, manager.accessToken, {
      title: 'Task B',
      project: project.id,
      priority: TaskPriority.P3,
    });

    const res = await api(app)
      .patch(`/${API_PREFIX}/tasks/bulk-priority`)
      .set(...authHeader(manager.accessToken))
      .send({ taskIds: [taskA.id, taskB.id], priority: TaskPriority.P1 });
    expect(res.status).toBe(200);
    expect(res.body.data.succeeded).toEqual(expect.arrayContaining([taskA.id, taskB.id]));

    const detailB = await api(app)
      .get(`/${API_PREFIX}/tasks/${taskB.id}`)
      .set(...authHeader(manager.accessToken));
    expect(detailB.body.data.priority).toBe(TaskPriority.P1);
  });

  it('bulk-deletes (soft) multiple tasks, no longer visible in the active list', async () => {
    const { manager, project } = await seedFixtures();
    const taskA = await createTask(app, manager.accessToken, {
      title: 'Task A',
      project: project.id,
      priority: TaskPriority.P2,
    });
    const taskB = await createTask(app, manager.accessToken, {
      title: 'Task B',
      project: project.id,
      priority: TaskPriority.P2,
    });

    const res = await api(app)
      .patch(`/${API_PREFIX}/tasks/bulk-delete`)
      .set(...authHeader(manager.accessToken))
      .send({ taskIds: [taskA.id, taskB.id] });
    expect(res.status).toBe(200);
    expect(res.body.data.succeeded).toEqual(expect.arrayContaining([taskA.id, taskB.id]));

    const detailA = await api(app)
      .get(`/${API_PREFIX}/tasks/${taskA.id}`)
      .set(...authHeader(manager.accessToken));
    expect(detailA.status).toBe(404);
  });

  it('reports a per-task permission failure on bulk-delete for a Developer with no delete grant', async () => {
    const { developer, project, manager } = await seedFixtures();
    const taskA = await createTask(app, manager.accessToken, {
      title: 'Task A',
      project: project.id,
      priority: TaskPriority.P2,
    });

    const res = await api(app)
      .patch(`/${API_PREFIX}/tasks/bulk-delete`)
      .set(...authHeader(developer.accessToken))
      .send({ taskIds: [taskA.id] });
    expect(res.status).toBe(200);
    expect(res.body.data.succeeded).toEqual([]);
    expect(res.body.data.failed).toHaveLength(1);
  });
});
