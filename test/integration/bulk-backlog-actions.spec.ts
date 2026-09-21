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

describe('bulk backlog actions (Phase 2 gap-closure - BRD 6.2)', () => {
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
      email: 'bulk-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: 'bulk-developer@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, {
      name: 'Bulk Actions Project',
      memberIds: [developer.userDoc.id],
    });
    return { org, manager, developer, project };
  }

  it('bulk-moves multiple tasks into a sprint', async () => {
    const { manager, project } = await seedFixtures();
    const sprint = await createSprint(app, manager.accessToken, project.id, {
      name: 'Sprint 1',
      startDate: '2026-01-01',
      endDate: '2026-01-14',
    });
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
      .patch(`/${API_PREFIX}/tasks/bulk-move-sprint`)
      .set(...authHeader(manager.accessToken))
      .send({ taskIds: [taskA.id, taskB.id], sprintId: sprint.id });
    expect(res.status).toBe(200);
    expect(res.body.data.succeeded).toEqual(expect.arrayContaining([taskA.id, taskB.id]));
    expect(res.body.data.failed).toEqual([]);

    const detailA = await api(app)
      .get(`/${API_PREFIX}/tasks/${taskA.id}`)
      .set(...authHeader(manager.accessToken));
    expect(detailA.body.data.sprint.id).toBe(sprint.id);
  });

  it('bulk-assigns multiple tasks to a member', async () => {
    const { manager, developer, project } = await seedFixtures();
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
      .patch(`/${API_PREFIX}/tasks/bulk-assign`)
      .set(...authHeader(manager.accessToken))
      .send({ taskIds: [taskA.id, taskB.id], assignee: developer.userDoc.id });
    expect(res.status).toBe(200);
    expect(res.body.data.succeeded).toEqual(expect.arrayContaining([taskA.id, taskB.id]));

    const detailB = await api(app)
      .get(`/${API_PREFIX}/tasks/${taskB.id}`)
      .set(...authHeader(manager.accessToken));
    expect(detailB.body.data.assignee.id).toBe(developer.userDoc.id);
  });

  it('bulk-relabels multiple tasks, adding to (not replacing) existing labels', async () => {
    const { manager, project } = await seedFixtures();
    const taskA = await createTask(app, manager.accessToken, {
      title: 'Task A',
      project: project.id,
      priority: TaskPriority.P2,
      labels: ['existing'],
    });
    const taskB = await createTask(app, manager.accessToken, {
      title: 'Task B',
      project: project.id,
      priority: TaskPriority.P2,
    });

    const res = await api(app)
      .patch(`/${API_PREFIX}/tasks/bulk-relabel`)
      .set(...authHeader(manager.accessToken))
      .send({ taskIds: [taskA.id, taskB.id], labels: ['urgent-cleanup'] });
    expect(res.status).toBe(200);
    expect(res.body.data.succeeded).toEqual(expect.arrayContaining([taskA.id, taskB.id]));

    const detailA = await api(app)
      .get(`/${API_PREFIX}/tasks/${taskA.id}`)
      .set(...authHeader(manager.accessToken));
    expect(detailA.body.data.labels.sort()).toEqual(['existing', 'urgent-cleanup']);
  });

  it('reports a per-task failure without failing the whole batch (one bad id)', async () => {
    const { manager, project } = await seedFixtures();
    const taskA = await createTask(app, manager.accessToken, {
      title: 'Task A',
      project: project.id,
      priority: TaskPriority.P2,
    });

    const res = await api(app)
      .patch(`/${API_PREFIX}/tasks/bulk-assign`)
      .set(...authHeader(manager.accessToken))
      .send({ taskIds: [taskA.id, '000000000000000000000000'], assignee: null });
    expect(res.status).toBe(200);
    expect(res.body.data.succeeded).toEqual([taskA.id]);
    expect(res.body.data.failed).toHaveLength(1);
    expect(res.body.data.failed[0].taskId).toBe('000000000000000000000000');
  });

  it('rejects a bulk request from a Developer role with no project grant (403 base org-role gate still applies)', async () => {
    const { developer, project, manager } = await seedFixtures();
    const taskA = await createTask(app, manager.accessToken, {
      title: 'Task A',
      project: project.id,
      priority: TaskPriority.P2,
    });

    // Developer is a member with no canEditAnyTask grant - the per-task call inside the bulk
    // loop still throws, and that failure is captured per-task, not a blanket 403 for the route
    // itself (the route only requires an org role, matching the existing single-task routes).
    const res = await api(app)
      .patch(`/${API_PREFIX}/tasks/bulk-relabel`)
      .set(...authHeader(developer.accessToken))
      .send({ taskIds: [taskA.id], labels: ['x'] });
    expect(res.status).toBe(200);
    expect(res.body.data.succeeded).toEqual([]);
    expect(res.body.data.failed).toHaveLength(1);
  });
});
