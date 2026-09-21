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
import { api, createProject, createSprint, createTask } from './setup/fixtures';

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
    const org = await seedOrganization(app);
    const manager = await seedUserAndLogin(app, {
      email: 'dash-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: 'dash-developer@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
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

  describe('SLA policy + compliance widget (Search/Dashboards v2)', () => {
    async function seedManager(email = 'sla-manager@example.com') {
      const org = await seedOrganization(app);
      const manager = await seedUserAndLogin(app, {
        email,
        password: 'Password123',
        role: Role.MANAGER,
        organizationId: org.id,
      });
      return { org, manager };
    }

    it('defaults to the system policy until a project configures its own', async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, { name: 'SLA Project' });

      const res = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/sla-policy`)
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([
        { priority: 'P1', resolutionHours: 8 },
        { priority: 'P2', resolutionHours: 24 },
        { priority: 'P3', resolutionHours: 72 },
      ]);
    });

    it('accepts a custom override, and rejects a duplicate priority', async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, { name: 'Custom SLA Project' });

      const put = await api(app)
        .put(`/${API_PREFIX}/projects/${project.id}/sla-policy`)
        .set(...authHeader(manager.accessToken))
        .send({ entries: [{ priority: 'P1', resolutionHours: 4 }] });
      expect(put.status).toBe(200);
      expect(put.body.data).toEqual([{ priority: 'P1', resolutionHours: 4 }]);

      const getAfter = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/sla-policy`)
        .set(...authHeader(manager.accessToken));
      expect(getAfter.body.data).toEqual([{ priority: 'P1', resolutionHours: 4 }]);

      const dup = await api(app)
        .put(`/${API_PREFIX}/projects/${project.id}/sla-policy`)
        .set(...authHeader(manager.accessToken))
        .send({
          entries: [
            { priority: 'P1', resolutionHours: 4 },
            { priority: 'P1', resolutionHours: 5 },
          ],
        });
      expect(dup.status).toBe(400);
    });

    it("the sla-compliance widget reports per-priority totals using each project's resolved policy", async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, { name: 'Compliance Project' });
      await createTask(app, manager.accessToken, {
        title: 'Fresh P1',
        project: project.id,
        priority: TaskPriority.P1,
      });
      await createTask(app, manager.accessToken, {
        title: 'Fresh P2',
        project: project.id,
        priority: TaskPriority.P2,
      });

      const res = await api(app)
        .get(`/${API_PREFIX}/dashboard/sla-compliance`)
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);
      const byPriority = Object.fromEntries(
        res.body.data.map((r: { priority: string }) => [r.priority, r]),
      );
      // Both tasks were just created, so well within any target - neither has breached yet.
      expect(byPriority.P1).toMatchObject({ total: 1, compliant: 1, breached: 0 });
      expect(byPriority.P2).toMatchObject({ total: 1, compliant: 1, breached: 0 });
      expect(byPriority.P3).toMatchObject({ total: 0, compliant: 0, breached: 0 });
    });
  });

  describe('velocity-trend widget (Search/Dashboards v2)', () => {
    it('counts a task completed this week in the most recent bucket', async () => {
      const { manager } = await seedDashboardFixture();
      const project = await createProject(app, manager.accessToken, { name: 'Velocity Project' });
      const task = await createTask(app, manager.accessToken, {
        title: 'Completed with points',
        project: project.id,
        priority: TaskPriority.P2,
        storyPoints: 5,
      });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
        .set(...authHeader(manager.accessToken))
        .send({ status: TaskStatus.IN_PROGRESS });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
        .set(...authHeader(manager.accessToken))
        .send({ status: TaskStatus.REVIEW });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
        .set(...authHeader(manager.accessToken))
        .send({ status: TaskStatus.DONE });

      const res = await api(app)
        .get(`/${API_PREFIX}/dashboard/velocity-trend`)
        .query({ projectId: project.id })
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data.hasStoryPoints).toBe(true);
      const lastPoint = res.body.data.points[res.body.data.points.length - 1];
      expect(lastPoint.completedPoints).toBe(5);
      expect(lastPoint.completedCount).toBe(1);
    });
  });

  describe('active-sprints-health widget (Search/Dashboards v2)', () => {
    it('lists a currently-Active sprint with its remaining work', async () => {
      const { manager } = await seedDashboardFixture();
      const project = await createProject(app, manager.accessToken, { name: 'Health Project' });
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
      const sprint = await createSprint(app, manager.accessToken, project.id, {
        name: 'Sprint 1',
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });
      const task = await createTask(app, manager.accessToken, {
        title: 'In the sprint',
        project: project.id,
        priority: TaskPriority.P2,
        storyPoints: 8,
      });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}/sprint`)
        .set(...authHeader(manager.accessToken))
        .send({ sprintId: sprint.id });
      await api(app)
        .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/start`)
        .set(...authHeader(manager.accessToken));

      const res = await api(app)
        .get(`/${API_PREFIX}/dashboard/active-sprints-health`)
        .query({ projectId: project.id })
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({
        sprintId: sprint.id,
        sprintName: 'Sprint 1',
        projectId: project.id,
        hasStoryPoints: true,
        remainingPoints: 8,
      });
      expect(res.body.data[0].percentTimeElapsed).toBeLessThanOrEqual(5);
    });

    it('returns an empty list when there are no Active sprints (regression)', async () => {
      const { manager } = await seedDashboardFixture();
      const res = await api(app)
        .get(`/${API_PREFIX}/dashboard/active-sprints-health`)
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  describe('my-open-issues widget (Search/Dashboards v2)', () => {
    it("lists the caller's own open tasks, not tasks assigned to others", async () => {
      const { developer, taskD } = await seedDashboardFixture();

      const res = await api(app)
        .get(`/${API_PREFIX}/dashboard/my-open-issues`)
        .set(...authHeader(developer.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data.map((t: { id: string }) => t.id)).toEqual([taskD.id]);
    });

    it('excludes Done tasks even when assigned to the caller', async () => {
      const { manager, project } = await seedDashboardFixture();
      const task = await createTask(app, manager.accessToken, {
        title: 'My completed task',
        project: project.id,
        priority: TaskPriority.P2,
        assignee: manager.userDoc.id,
      });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
        .set(...authHeader(manager.accessToken))
        .send({ status: TaskStatus.IN_PROGRESS });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
        .set(...authHeader(manager.accessToken))
        .send({ status: TaskStatus.REVIEW });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
        .set(...authHeader(manager.accessToken))
        .send({ status: TaskStatus.DONE });

      const res = await api(app)
        .get(`/${API_PREFIX}/dashboard/my-open-issues`)
        .query({ projectId: project.id })
        .set(...authHeader(manager.accessToken));
      expect(res.body.data).toEqual([]);
    });
  });

  describe('resolution-time-trend widget (Search/Dashboards v2)', () => {
    it('reports the average resolution hours for the completing priority in the most recent bucket', async () => {
      const { manager } = await seedDashboardFixture();
      const project = await createProject(app, manager.accessToken, {
        name: 'Resolution Trend Project',
      });
      const task = await createTask(app, manager.accessToken, {
        title: 'Resolved task',
        project: project.id,
        priority: TaskPriority.P1,
      });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
        .set(...authHeader(manager.accessToken))
        .send({ status: TaskStatus.IN_PROGRESS });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
        .set(...authHeader(manager.accessToken))
        .send({ status: TaskStatus.REVIEW });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
        .set(...authHeader(manager.accessToken))
        .send({ status: TaskStatus.DONE });

      const res = await api(app)
        .get(`/${API_PREFIX}/dashboard/resolution-time-trend`)
        .query({ projectId: project.id })
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);
      const lastPoint = res.body.data[res.body.data.length - 1];
      expect(lastPoint.avgResolutionHoursByPriority.P1).toBeGreaterThanOrEqual(0);
      expect(lastPoint.avgResolutionHoursByPriority.P2).toBeNull();
    });
  });
});
