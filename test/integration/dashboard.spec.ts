import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { TaskPriority } from 'src/common/enums/task-priority.enum';
import { TaskStatus } from 'src/common/enums/task-status.enum';
import {
  API_PREFIX,
  createTestApp,
  closeTestApp,
  clearInMemoryMongo,
  seedUserAndLogin,
  authHeader,
} from './setup/test-app';
import { api, createProject, createTask } from './setup/fixtures';

describe('dashboard (integration)', () => {
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

  /**
   * One project with 4 tasks of known status/priority:
   *  - task A: P1, walked to Done
   *  - task B: P2, In Progress
   *  - task C: P3, Todo
   *  - task D: P1, Todo, assigned to the developer
   * So: totalTasks=4, completedTasks=1, openTasks=3, completionRate=25.
   */
  async function seedDashboardFixture() {
    const manager = await seedUserAndLogin(app, {
      email: 'dash-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
    });
    const developer = await seedUserAndLogin(app, {
      email: 'dash-developer@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
    });
    const project = await createProject(app, manager.accessToken, {
      name: 'Dashboard Fixture Project',
      memberIds: [developer.userDoc.id],
    });

    const taskA = await createTask(app, manager.accessToken, {
      title: 'Task A',
      project: project.id,
      priority: TaskPriority.P1,
    });
    const taskB = await createTask(app, manager.accessToken, {
      title: 'Task B',
      project: project.id,
      priority: TaskPriority.P2,
    });
    await createTask(app, manager.accessToken, {
      title: 'Task C',
      project: project.id,
      priority: TaskPriority.P3,
    });
    const taskD = await createTask(app, manager.accessToken, {
      title: 'Task D',
      project: project.id,
      priority: TaskPriority.P1,
      assignee: developer.userDoc.id,
    });

    // Walk task A to Done through the legal path; task B to In Progress.
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${taskA.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TaskStatus.IN_PROGRESS });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${taskA.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TaskStatus.REVIEW });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${taskA.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TaskStatus.DONE });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${taskB.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TaskStatus.IN_PROGRESS });

    return { manager, developer, project, taskA, taskB, taskD };
  }

  it('summary matches the fixture and X-Cache goes MISS then HIT', async () => {
    const { manager } = await seedDashboardFixture();

    const first = await api(app)
      .get(`/${API_PREFIX}/dashboard/summary`)
      .set(...authHeader(manager.accessToken));
    expect(first.status).toBe(200);
    expect(first.headers['x-cache']).toBe('MISS');
    expect(first.body.data).toMatchObject({
      totalTasks: 4,
      completedTasks: 1,
      openTasks: 3,
      completionRate: 25,
    });

    const second = await api(app)
      .get(`/${API_PREFIX}/dashboard/summary`)
      .set(...authHeader(manager.accessToken));
    expect(second.status).toBe(200);
    expect(second.headers['x-cache']).toBe('HIT');
    expect(second.body.data).toEqual(first.body.data);
  });

  it('tasks-status matches the fixture', async () => {
    const { manager } = await seedDashboardFixture();
    const res = await api(app)
      .get(`/${API_PREFIX}/dashboard/tasks-status`)
      .set(...authHeader(manager.accessToken));
    expect(res.status).toBe(200);
    const byStatus = Object.fromEntries(
      res.body.data.map((row: { status: string; count: number }) => [row.status, row.count]),
    );
    expect(byStatus).toMatchObject({
      [TaskStatus.TODO]: 2,
      [TaskStatus.IN_PROGRESS]: 1,
      [TaskStatus.REVIEW]: 0,
      [TaskStatus.DONE]: 1,
    });
  });

  it('tasks-by-priority matches the fixture', async () => {
    const { manager } = await seedDashboardFixture();
    const res = await api(app)
      .get(`/${API_PREFIX}/dashboard/tasks-by-priority`)
      .set(...authHeader(manager.accessToken));
    expect(res.status).toBe(200);
    const byPriority = Object.fromEntries(
      res.body.data.map((row: { priority: string; count: number }) => [row.priority, row.count]),
    );
    expect(byPriority).toMatchObject({ P1: 2, P2: 1, P3: 1 });
  });

  it("a Developer's dashboard is scoped to their own assigned tasks", async () => {
    const { developer } = await seedDashboardFixture();

    // The developer is only assigned task D (Todo, P1); task-scoped dashboard endpoints filter
    // tasks to `assignee = actingUser.id` for Developers (dashboard.service.ts `resolveScope`).
    const res = await api(app)
      .get(`/${API_PREFIX}/dashboard/summary`)
      .set(...authHeader(developer.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.totalTasks).toBe(1);
    expect(res.body.data.completedTasks).toBe(0);

    // Projects are NOT task-scoped by assignee though - the developer is a project member, so
    // totalProjects should still count the one project they belong to.
    expect(res.body.data.totalProjects).toBe(1);
  });

  it('developer-workload reflects per-developer totals and completion rate', async () => {
    const { manager, developer } = await seedDashboardFixture();
    const res = await api(app)
      .get(`/${API_PREFIX}/dashboard/developer-workload`)
      .set(...authHeader(manager.accessToken));
    expect(res.status).toBe(200);
    const row = res.body.data.find((r: { userId: string }) => r.userId === developer.userDoc.id);
    expect(row).toMatchObject({ totalAssigned: 1, completed: 0, completionRate: 0 });
  });

  it('cache invalidates when the underlying data changes (a new task busts the dashboard cache)', async () => {
    const { manager, project } = await seedDashboardFixture();

    const first = await api(app)
      .get(`/${API_PREFIX}/dashboard/summary`)
      .set(...authHeader(manager.accessToken));
    expect(first.headers['x-cache']).toBe('MISS');
    expect(first.body.data.totalTasks).toBe(4);

    await createTask(app, manager.accessToken, {
      title: 'Task E (added after first summary call)',
      project: project.id,
      priority: TaskPriority.P2,
    });

    const afterChange = await api(app)
      .get(`/${API_PREFIX}/dashboard/summary`)
      .set(...authHeader(manager.accessToken));
    // Creating a task invalidates the whole dashboard cache pattern, so this must recompute
    // (MISS again) and reflect the new task.
    expect(afterChange.headers['x-cache']).toBe('MISS');
    expect(afterChange.body.data.totalTasks).toBe(5);
  });
});
