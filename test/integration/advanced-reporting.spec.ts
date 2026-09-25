import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Role } from 'src/common/enums/role.enum';
import { TaskPriority } from 'src/common/enums/task-priority.enum';
import { TaskStatus } from 'src/common/enums/task-status.enum';
import { IssueType } from 'src/common/enums/issue-type.enum';
import { Task, TaskDocument } from 'src/modules/tasks/schemas/task.schema';
import {
  API_PREFIX,
  createTestApp,
  closeTestApp,
  clearInMemoryMongo,
  seedOrganization,
  seedUserAndLogin,
  authHeader,
} from './setup/test-app';
import { api, createProject, createTask, createSprint } from './setup/fixtures';

/** Module 9: Advanced Reporting - Cumulative Flow Diagram, Control Chart (cycle/lead time), sprint
 * retrospective, and Epic Burndown. */
describe('advanced reporting (integration)', () => {
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

  async function seedManagerAndDeveloper() {
    const org = await seedOrganization(app);
    const manager = await seedUserAndLogin(app, {
      email: 'report-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: 'report-developer@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    return { org, manager, developer };
  }

  async function walkToDone(token: string, taskId: string) {
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${taskId}/status`)
      .set(...authHeader(token))
      .send({ status: TaskStatus.IN_PROGRESS });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${taskId}/status`)
      .set(...authHeader(token))
      .send({ status: TaskStatus.REVIEW });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${taskId}/status`)
      .set(...authHeader(token))
      .send({ status: TaskStatus.DONE });
  }

  describe('Cumulative Flow Diagram', () => {
    it('returns one point per day, today reflecting the current status distribution', async () => {
      const { manager } = await seedManagerAndDeveloper();
      const project = await createProject(app, manager.accessToken, { name: 'CFD Project' });
      const taskA = await createTask(app, manager.accessToken, {
        title: 'Stays Todo',
        project: project.id,
        priority: TaskPriority.P2,
      });
      const taskB = await createTask(app, manager.accessToken, {
        title: 'Goes to Done',
        project: project.id,
        priority: TaskPriority.P2,
      });
      await walkToDone(manager.accessToken, taskB.id);

      const res = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/reports/cfd`)
        .query({ days: 5 })
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(5);
      const today = res.body.data.at(-1);
      expect(today).toMatchObject({ toDo: 1, inProgress: 0, done: 1 });
      void taskA;
    });

    it('rejects a Developer who is not a member of the project (view access)', async () => {
      const { manager, developer } = await seedManagerAndDeveloper();
      const project = await createProject(app, manager.accessToken, {
        name: 'Private CFD Project',
      });

      const res = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/reports/cfd`)
        .set(...authHeader(developer.accessToken));
      expect(res.status).toBe(403);
    });
  });

  describe('Control Chart (cycle time / lead time)', () => {
    it('includes a completed issue with a non-negative lead time and cycle time', async () => {
      const { manager } = await seedManagerAndDeveloper();
      const project = await createProject(app, manager.accessToken, { name: 'Cycle Time Project' });
      const task = await createTask(app, manager.accessToken, {
        title: 'Ship the feature',
        project: project.id,
        priority: TaskPriority.P2,
      });
      await walkToDone(manager.accessToken, task.id);

      const res = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/reports/cycle-time`)
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data.points).toHaveLength(1);
      const point = res.body.data.points[0];
      expect(point.taskId).toBe(task.id);
      expect(point.leadTimeHours).toBeGreaterThanOrEqual(0);
      expect(point.cycleTimeHours).toBeGreaterThanOrEqual(0);
      // Cycle time starts later than lead time (first status change vs. creation), so it can
      // never exceed lead time for the same issue.
      expect(point.cycleTimeHours).toBeLessThanOrEqual(point.leadTimeHours);
      expect(res.body.data.averageLeadTimeHours).toBeGreaterThanOrEqual(0);
      expect(res.body.data.averageCycleTimeHours).toBeGreaterThanOrEqual(0);
    });

    it('excludes an issue completed before the requested day window', async () => {
      const { manager } = await seedManagerAndDeveloper();
      const project = await createProject(app, manager.accessToken, {
        name: 'Old Completion Project',
      });
      const task = await createTask(app, manager.accessToken, {
        title: 'Completed long ago',
        project: project.id,
        priority: TaskPriority.P2,
      });
      await walkToDone(manager.accessToken, task.id);

      const taskModel = app.get<Model<TaskDocument>>(getModelToken(Task.name));
      await taskModel.updateOne(
        { _id: task.id },
        { completedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000) },
      );

      const res = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/reports/cycle-time`)
        .query({ days: 30 })
        .set(...authHeader(manager.accessToken));
      expect(res.body.data.points).toEqual([]);
      expect(res.body.data.averageLeadTimeHours).toBeNull();
    });
  });

  describe('Sprint retrospective', () => {
    it('reports planned/completed/carryover across the sprint lifecycle', async () => {
      const { manager } = await seedManagerAndDeveloper();
      const project = await createProject(app, manager.accessToken, { name: 'Retro Project' });
      const sprint = await createSprint(app, manager.accessToken, project.id, {
        name: 'Sprint 1',
        startDate: '2026-01-01',
        endDate: '2026-01-14',
      });
      const taskA = await createTask(app, manager.accessToken, {
        title: 'Will complete',
        project: project.id,
        priority: TaskPriority.P2,
        storyPoints: 3,
      });
      const taskB = await createTask(app, manager.accessToken, {
        title: 'Will carry over',
        project: project.id,
        priority: TaskPriority.P2,
        storyPoints: 5,
      });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${taskA.id}/sprint`)
        .set(...authHeader(manager.accessToken))
        .send({ sprintId: sprint.id });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${taskB.id}/sprint`)
        .set(...authHeader(manager.accessToken))
        .send({ sprintId: sprint.id });

      await api(app)
        .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/start`)
        .set(...authHeader(manager.accessToken));

      // Scope added mid-sprint.
      const taskC = await createTask(app, manager.accessToken, {
        title: 'Added mid-sprint',
        project: project.id,
        priority: TaskPriority.P2,
        storyPoints: 2,
      });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${taskC.id}/sprint`)
        .set(...authHeader(manager.accessToken))
        .send({ sprintId: sprint.id });

      // Scope explicitly removed mid-sprint (not the end-of-sprint carryover).
      const taskD = await createTask(app, manager.accessToken, {
        title: 'Removed mid-sprint',
        project: project.id,
        priority: TaskPriority.P2,
        storyPoints: 1,
      });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${taskD.id}/sprint`)
        .set(...authHeader(manager.accessToken))
        .send({ sprintId: sprint.id });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${taskD.id}/sprint`)
        .set(...authHeader(manager.accessToken))
        .send({ sprintId: null });

      await walkToDone(manager.accessToken, taskA.id);

      const duringActive = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/retrospective`)
        .set(...authHeader(manager.accessToken));
      expect(duringActive.status).toBe(200);
      expect(duringActive.body.data).toMatchObject({
        plannedCount: 2,
        plannedPoints: 8,
        // Includes taskD even though it was later removed - addedCount is a raw churn figure
        // (see sprint-retrospective.util.ts), not "what's still added".
        addedCount: 2,
        addedPoints: 3,
        completedCount: 1,
        completedPoints: 3,
        // taskD is excluded here (and from completedCount) once explicitly removed.
        carryoverCount: 2,
        carryoverPoints: 7,
        removedCount: 1,
        removedPoints: 1,
      });

      await api(app)
        .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/complete`)
        .set(...authHeader(manager.accessToken))
        .send({});

      const afterComplete = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/retrospective`)
        .set(...authHeader(manager.accessToken));
      // Still accurate after complete() moves the carryover tasks out of the sprint - initial and
      // added scope are looked up by id directly, not by their current `sprint` field.
      expect(afterComplete.body.data).toMatchObject({
        plannedCount: 2,
        addedCount: 2,
        completedCount: 1,
        carryoverCount: 2,
      });
      expect(afterComplete.body.data.completionRatePercent).toBe(33);
    });

    it('returns an all-zero result for a sprint that was never started', async () => {
      const { manager } = await seedManagerAndDeveloper();
      const project = await createProject(app, manager.accessToken, {
        name: 'Unstarted Retro Project',
      });
      const sprint = await createSprint(app, manager.accessToken, project.id, {
        name: 'Sprint 1',
        startDate: '2026-01-01',
        endDate: '2026-01-14',
      });

      const res = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/retrospective`)
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ plannedCount: 0, completionRatePercent: null });
    });
  });

  describe('Epic Burndown', () => {
    it('reflects remaining linked-issue count as children complete', async () => {
      const { manager } = await seedManagerAndDeveloper();
      const project = await createProject(app, manager.accessToken, {
        name: 'Epic Burndown Project',
      });
      const epic = await createTask(app, manager.accessToken, {
        title: 'Big Epic',
        project: project.id,
        priority: TaskPriority.P2,
        issueType: IssueType.EPIC,
      });
      const child1 = await createTask(app, manager.accessToken, {
        title: 'Child 1',
        project: project.id,
        priority: TaskPriority.P2,
        parent: epic.id,
        storyPoints: 2,
      });
      await createTask(app, manager.accessToken, {
        title: 'Child 2',
        project: project.id,
        priority: TaskPriority.P2,
        parent: epic.id,
        storyPoints: 3,
      });

      const before = await api(app)
        .get(`/${API_PREFIX}/tasks/${epic.id}/epic-burndown`)
        .set(...authHeader(manager.accessToken));
      expect(before.status).toBe(200);
      expect(before.body.data.hasIdealLine).toBe(false);
      expect(before.body.data.points.at(-1)).toMatchObject({
        remainingPoints: 5,
        remainingCount: 2,
      });

      await walkToDone(manager.accessToken, child1.id);

      const after = await api(app)
        .get(`/${API_PREFIX}/tasks/${epic.id}/epic-burndown`)
        .set(...authHeader(manager.accessToken));
      expect(after.body.data.points.at(-1)).toMatchObject({
        remainingPoints: 3,
        remainingCount: 1,
      });
    });

    it('sets hasIdealLine when the Epic has a due date, and rejects a non-Epic issue', async () => {
      const { manager } = await seedManagerAndDeveloper();
      const project = await createProject(app, manager.accessToken, {
        name: 'Epic Due Date Project',
      });
      const epic = await createTask(app, manager.accessToken, {
        title: 'Dated Epic',
        project: project.id,
        priority: TaskPriority.P2,
        issueType: IssueType.EPIC,
        dueDate: '2026-06-01',
      });

      const res = await api(app)
        .get(`/${API_PREFIX}/tasks/${epic.id}/epic-burndown`)
        .set(...authHeader(manager.accessToken));
      expect(res.body.data.hasIdealLine).toBe(true);

      const ordinaryTask = await createTask(app, manager.accessToken, {
        title: 'Not an epic',
        project: project.id,
        priority: TaskPriority.P2,
      });
      const rejected = await api(app)
        .get(`/${API_PREFIX}/tasks/${ordinaryTask.id}/epic-burndown`)
        .set(...authHeader(manager.accessToken));
      expect(rejected.status).toBe(400);
    });
  });
});
