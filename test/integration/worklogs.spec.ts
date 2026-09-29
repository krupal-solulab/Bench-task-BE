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

describe('time tracking & work logs (integration)', () => {
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

  async function seedManager() {
    const org = await seedOrganization(app);
    const manager = await seedUserAndLogin(app, {
      email: 'worklog-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    return { org, manager };
  }

  async function logWork(token: string, taskId: string, body: Record<string, unknown> = {}) {
    const res = await api(app)
      .post(`/${API_PREFIX}/tasks/${taskId}/worklogs`)
      .set(...authHeader(token))
      .send({ hours: 2, workDate: '2026-03-01', ...body });
    if (res.status !== 201) {
      throw new Error(`logWork failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body.data;
  }

  it('logs hours against a task as the acting user, lists them, and reflects them in the summary', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Worklog Project' });
    const task = await createTask(app, manager.accessToken, {
      title: 'Build the export feature',
      project: project.id,
      priority: TaskPriority.P2,
      originalEstimateHours: 8,
    });

    const log = await logWork(manager.accessToken, task.id, {
      hours: 3,
      description: 'Initial scaffolding',
      workDate: '2026-03-01',
    });
    expect(log).toMatchObject({ hours: 3, description: 'Initial scaffolding', billable: true });
    expect(log.user.id).toBe(manager.userDoc.id);

    const list = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}/worklogs`)
      .set(...authHeader(manager.accessToken));
    expect(list.body.data).toHaveLength(1);

    const summary = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}/worklogs/summary`)
      .set(...authHeader(manager.accessToken));
    expect(summary.body.data).toEqual({
      taskId: task.id,
      originalEstimateHours: 8,
      totalLoggedHours: 3,
      remainingHours: 5,
      varianceHours: -5,
    });
  });

  it('reports negative remaining and positive variance once logged hours exceed the estimate', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Overrun Project' });
    const task = await createTask(app, manager.accessToken, {
      title: 'Underestimated task',
      project: project.id,
      priority: TaskPriority.P2,
      originalEstimateHours: 2,
    });
    await logWork(manager.accessToken, task.id, { hours: 5, workDate: '2026-03-01' });

    const summary = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}/worklogs/summary`)
      .set(...authHeader(manager.accessToken));
    expect(summary.body.data).toMatchObject({
      totalLoggedHours: 5,
      remainingHours: 0,
      varianceHours: 3,
    });
  });

  it('returns null estimate fields when the task has no original estimate', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'No Estimate Project' });
    const task = await createTask(app, manager.accessToken, {
      title: 'No estimate task',
      project: project.id,
      priority: TaskPriority.P2,
    });
    await logWork(manager.accessToken, task.id, { hours: 1, workDate: '2026-03-01' });

    const summary = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}/worklogs/summary`)
      .set(...authHeader(manager.accessToken));
    expect(summary.body.data).toMatchObject({
      originalEstimateHours: null,
      totalLoggedHours: 1,
      remainingHours: null,
      varianceHours: null,
    });
  });

  it('rejects logging work for a non-member of the project', async () => {
    const { org, manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, {
      name: 'Private Worklog Project',
    });
    const task = await createTask(app, manager.accessToken, {
      title: 'A task',
      project: project.id,
      priority: TaskPriority.P2,
    });
    const outsider = await seedUserAndLogin(app, {
      email: 'worklog-outsider@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });

    const res = await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/worklogs`)
      .set(...authHeader(outsider.accessToken))
      .send({ hours: 1, workDate: '2026-03-01' });
    expect(res.status).toBe(403);
  });

  it("rejects editing/deleting someone else's work log, but allows an Admin to", async () => {
    const { org, manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Edit Perms Project' });
    const task = await createTask(app, manager.accessToken, {
      title: 'A task',
      project: project.id,
      priority: TaskPriority.P2,
    });
    const dev = await seedUserAndLogin(app, {
      email: 'worklog-dev@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/members`)
      .set(...authHeader(manager.accessToken))
      .send({ userIds: [dev.userDoc.id] });
    const log = await logWork(dev.accessToken, task.id, { hours: 1, workDate: '2026-03-01' });

    const managerEditAttempt = await api(app)
      .patch(`/${API_PREFIX}/worklogs/${log.id}`)
      .set(...authHeader(manager.accessToken))
      .send({ hours: 2 });
    expect(managerEditAttempt.status).toBe(403);

    const admin = await seedUserAndLogin(app, {
      email: 'worklog-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const adminEdit = await api(app)
      .patch(`/${API_PREFIX}/worklogs/${log.id}`)
      .set(...authHeader(admin.accessToken))
      .send({ hours: 4 });
    expect(adminEdit.status).toBe(200);
    expect(adminEdit.body.data.hours).toBe(4);

    const ownEdit = await api(app)
      .patch(`/${API_PREFIX}/worklogs/${log.id}`)
      .set(...authHeader(dev.accessToken))
      .send({ description: 'updated by owner' });
    expect(ownEdit.status).toBe(200);

    const deleteAttempt = await api(app)
      .delete(`/${API_PREFIX}/worklogs/${log.id}`)
      .set(...authHeader(dev.accessToken));
    expect(deleteAttempt.status).toBe(204);
  });

  describe('project timesheet & report', () => {
    it('lists raw work logs project-wide, filterable by user/date/billable', async () => {
      const { org, manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, { name: 'Timesheet Project' });
      const task = await createTask(app, manager.accessToken, {
        title: 'Shared task',
        project: project.id,
        priority: TaskPriority.P2,
      });
      const dev = await seedUserAndLogin(app, {
        email: 'timesheet-dev@example.com',
        password: 'Password123',
        role: Role.DEVELOPER,
        organizationId: org.id,
      });
      await api(app)
        .post(`/${API_PREFIX}/projects/${project.id}/members`)
        .set(...authHeader(manager.accessToken))
        .send({ userIds: [dev.userDoc.id] });

      await logWork(manager.accessToken, task.id, {
        hours: 2,
        workDate: '2026-03-01',
        billable: true,
      });
      await logWork(dev.accessToken, task.id, {
        hours: 1,
        workDate: '2026-03-05',
        billable: false,
      });

      const all = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/worklogs`)
        .set(...authHeader(manager.accessToken));
      expect(all.body.data).toHaveLength(2);

      const billableOnly = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/worklogs`)
        .query({ billable: true })
        .set(...authHeader(manager.accessToken));
      expect(billableOnly.body.data).toHaveLength(1);
      expect(billableOnly.body.data[0].hours).toBe(2);

      const byUser = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/worklogs`)
        .query({ userId: dev.userDoc.id })
        .set(...authHeader(manager.accessToken));
      expect(byUser.body.data).toHaveLength(1);

      const byDateRange = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/worklogs`)
        .query({ from: '2026-03-04', to: '2026-03-10' })
        .set(...authHeader(manager.accessToken));
      expect(byDateRange.body.data).toHaveLength(1);
      expect(byDateRange.body.data[0].hours).toBe(1);
    });

    it('aggregates per-user totals for the timesheet report', async () => {
      const { org, manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, { name: 'Report Project' });
      const task = await createTask(app, manager.accessToken, {
        title: 'Shared task',
        project: project.id,
        priority: TaskPriority.P2,
      });
      const dev = await seedUserAndLogin(app, {
        email: 'report-dev@example.com',
        password: 'Password123',
        role: Role.DEVELOPER,
        organizationId: org.id,
      });
      await api(app)
        .post(`/${API_PREFIX}/projects/${project.id}/members`)
        .set(...authHeader(manager.accessToken))
        .send({ userIds: [dev.userDoc.id] });

      await logWork(manager.accessToken, task.id, {
        hours: 3,
        workDate: '2026-03-01',
        billable: true,
      });
      await logWork(dev.accessToken, task.id, {
        hours: 2,
        workDate: '2026-03-02',
        billable: false,
      });
      await logWork(dev.accessToken, task.id, {
        hours: 1,
        workDate: '2026-03-03',
        billable: true,
      });

      const report = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/worklogs/report`)
        .set(...authHeader(manager.accessToken));
      expect(report.status).toBe(200);
      expect(report.body.data.totalHours).toBe(6);
      expect(report.body.data.billableHours).toBe(4);
      expect(report.body.data.nonBillableHours).toBe(2);

      const byUserId = Object.fromEntries(
        report.body.data.entries.map((e: { userId: string }) => [e.userId, e]),
      );
      expect(byUserId[manager.userDoc.id]).toMatchObject({ totalHours: 3, entryCount: 1 });
      expect(byUserId[dev.userDoc.id]).toMatchObject({
        totalHours: 3,
        billableHours: 1,
        nonBillableHours: 2,
        entryCount: 2,
      });
    });

    it('scopes the report to a date range when given', async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, {
        name: 'Scoped Report Project',
      });
      const task = await createTask(app, manager.accessToken, {
        title: 'A task',
        project: project.id,
        priority: TaskPriority.P2,
      });
      await logWork(manager.accessToken, task.id, { hours: 2, workDate: '2026-01-01' });
      await logWork(manager.accessToken, task.id, { hours: 4, workDate: '2026-03-01' });

      const report = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/worklogs/report`)
        .query({ from: '2026-02-01', to: '2026-03-31' })
        .set(...authHeader(manager.accessToken));
      expect(report.body.data.totalHours).toBe(4);
    });

    it("adds the project-wide estimate rollup alongside the report's per-user totals", async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, {
        name: 'Estimate Rollup Project',
      });
      const taskA = await createTask(app, manager.accessToken, {
        title: 'Task A',
        project: project.id,
        priority: TaskPriority.P2,
        originalEstimateHours: 5,
      });
      await createTask(app, manager.accessToken, {
        title: 'Task B (no estimate)',
        project: project.id,
        priority: TaskPriority.P2,
      });
      await createTask(app, manager.accessToken, {
        title: 'Task C',
        project: project.id,
        priority: TaskPriority.P2,
        originalEstimateHours: 3,
      });
      await logWork(manager.accessToken, taskA.id, { hours: 2, workDate: '2026-03-01' });

      const report = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/worklogs/report`)
        .set(...authHeader(manager.accessToken));
      expect(report.body.data.totalEstimateHours).toBe(8);
      expect(report.body.data.totalHours).toBe(2);
    });

    it('still returns the estimate rollup when no work has been logged at all', async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, {
        name: 'No Logs Yet Project',
      });
      await createTask(app, manager.accessToken, {
        title: 'Estimated but untouched',
        project: project.id,
        priority: TaskPriority.P2,
        originalEstimateHours: 6,
      });

      const report = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/worklogs/report`)
        .set(...authHeader(manager.accessToken));
      expect(report.body.data).toEqual({
        entries: [],
        totalHours: 0,
        billableHours: 0,
        nonBillableHours: 0,
        totalEstimateHours: 6,
      });
    });
  });

  describe('story-point-to-time correlation', () => {
    it('only includes story-pointed tasks that actually have logged hours', async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, {
        name: 'Correlation Project',
      });
      const logged = await createTask(app, manager.accessToken, {
        title: 'Logged and pointed',
        project: project.id,
        priority: TaskPriority.P2,
        storyPoints: 5,
      });
      await createTask(app, manager.accessToken, {
        title: 'Pointed but untouched',
        project: project.id,
        priority: TaskPriority.P2,
        storyPoints: 3,
      });
      await createTask(app, manager.accessToken, {
        title: 'Logged but unpointed',
        project: project.id,
        priority: TaskPriority.P2,
      });
      await logWork(manager.accessToken, logged.id, { hours: 4, workDate: '2026-03-01' });

      const res = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/worklogs/correlation`)
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data.entries).toEqual([
        expect.objectContaining({ taskId: logged.id, storyPoints: 5, loggedHours: 4 }),
      ]);
    });
  });

  describe('sprint-level time-spent-vs-estimate report', () => {
    it("sums each sprint task's estimate and logged hours", async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, {
        name: 'Sprint Report Project',
      });
      const sprint = await createSprint(app, manager.accessToken, project.id, {
        name: 'Sprint 1',
        startDate: '2026-03-01',
        endDate: '2026-03-14',
      });
      const inSprint = await createTask(app, manager.accessToken, {
        title: 'In sprint',
        project: project.id,
        priority: TaskPriority.P2,
        originalEstimateHours: 4,
      });
      const alsoInSprint = await createTask(app, manager.accessToken, {
        title: 'Also in sprint',
        project: project.id,
        priority: TaskPriority.P2,
        originalEstimateHours: 2,
      });
      await createTask(app, manager.accessToken, {
        title: 'Backlog task (not in sprint)',
        project: project.id,
        priority: TaskPriority.P2,
        originalEstimateHours: 10,
      });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${inSprint.id}/sprint`)
        .set(...authHeader(manager.accessToken))
        .send({ sprintId: sprint.id });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${alsoInSprint.id}/sprint`)
        .set(...authHeader(manager.accessToken))
        .send({ sprintId: sprint.id });
      await logWork(manager.accessToken, inSprint.id, { hours: 3, workDate: '2026-03-02' });

      const res = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/worklogs/report`)
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        sprintId: sprint.id,
        sprintName: 'Sprint 1',
        totalEstimateHours: 6,
        totalLoggedHours: 3,
      });
      expect(res.body.data.tasks).toHaveLength(2);
    });

    it('404s for a sprint id that does not belong to the given project', async () => {
      const { manager } = await seedManager();
      const projectA = await createProject(app, manager.accessToken, { name: 'Project A' });
      const projectB = await createProject(app, manager.accessToken, { name: 'Project B' });
      const sprintInB = await createSprint(app, manager.accessToken, projectB.id, {
        name: 'Sprint in B',
        startDate: '2026-03-01',
        endDate: '2026-03-14',
      });

      const res = await api(app)
        .get(`/${API_PREFIX}/projects/${projectA.id}/sprints/${sprintInB.id}/worklogs/report`)
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(404);
    });
  });

  describe('CSV export', () => {
    it('exports the filtered project timesheet as CSV', async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, { name: 'CSV Export Project' });
      const task = await createTask(app, manager.accessToken, {
        title: 'Exportable task',
        project: project.id,
        priority: TaskPriority.P2,
      });
      await logWork(manager.accessToken, task.id, {
        hours: 2.5,
        workDate: '2026-03-01',
        description: 'Did the thing',
      });

      const res = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/worklogs/export`)
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data.filename).toContain('timesheet');
      expect(res.body.data.filename).toContain('.csv');
      expect(res.body.data.csv).toContain('User,Task,Hours,Billable,Work Date,Description');
      expect(res.body.data.csv).toContain('Did the thing');
      expect(res.body.data.csv).toContain('2.5');
    });
  });

  describe('personal cross-project timesheet', () => {
    it("buckets the caller's own logs by week across every project, excluding other users' logs", async () => {
      const { org, manager } = await seedManager();
      const projectA = await createProject(app, manager.accessToken, {
        name: 'Personal Project A',
      });
      const projectB = await createProject(app, manager.accessToken, {
        name: 'Personal Project B',
      });
      const taskA = await createTask(app, manager.accessToken, {
        title: 'Task in A',
        project: projectA.id,
        priority: TaskPriority.P2,
      });
      const taskB = await createTask(app, manager.accessToken, {
        title: 'Task in B',
        project: projectB.id,
        priority: TaskPriority.P2,
      });
      const dev = await seedUserAndLogin(app, {
        email: 'personal-timesheet-dev@example.com',
        password: 'Password123',
        role: Role.DEVELOPER,
        organizationId: org.id,
      });
      await api(app)
        .post(`/${API_PREFIX}/projects/${projectA.id}/members`)
        .set(...authHeader(manager.accessToken))
        .send({ userIds: [dev.userDoc.id] });

      // Same ISO week (Mon 2026-03-02 .. Sun 2026-03-08).
      await logWork(manager.accessToken, taskA.id, { hours: 2, workDate: '2026-03-02' });
      await logWork(manager.accessToken, taskB.id, { hours: 1, workDate: '2026-03-04' });
      // A different week entirely.
      await logWork(manager.accessToken, taskA.id, { hours: 3, workDate: '2026-03-16' });
      // Someone else's log - must never appear in the manager's own timesheet.
      await logWork(dev.accessToken, taskA.id, { hours: 9, workDate: '2026-03-02' });

      const res = await api(app)
        .get(`/${API_PREFIX}/worklogs/my-timesheet`)
        .query({ groupBy: 'week' })
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data.groupBy).toBe('week');
      expect(res.body.data.buckets).toHaveLength(2);

      const totalHoursAcrossBuckets = res.body.data.buckets.reduce(
        (sum: number, b: { totalHours: number }) => sum + b.totalHours,
        0,
      );
      expect(totalHoursAcrossBuckets).toBe(6);

      const firstWeekBucket = res.body.data.buckets.find(
        (b: { bucketStart: string }) => b.bucketStart === '2026-03-02',
      );
      expect(firstWeekBucket.totalHours).toBe(3);
      expect(firstWeekBucket.entries).toHaveLength(2);
    });
  });
});
