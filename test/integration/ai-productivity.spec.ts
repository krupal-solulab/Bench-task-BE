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
import { api, createProject, createTask, createSprint } from './setup/fixtures';

/** Module 10: deterministic (non-LLM) "AI Productivity Layer" substitutes - sprint-planning
 * suggestions, issue summaries, and suggested-field hints for issue creation. Duplicate detection
 * and the Cmd+K quick switcher are frontend-only (reuse the existing `GET /tasks/search`
 * endpoint), so they have no backend surface of their own to test here. */
describe('AI productivity layer (integration)', () => {
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
      email: 'ai-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    return { org, manager };
  }

  describe('sprint planning suggestion', () => {
    it('walks the ranked backlog by points until the sprint capacity is reached', async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, { name: 'Planning Project' });
      const sprint = await createSprint(app, manager.accessToken, project.id, {
        name: 'Sprint 1',
        startDate: '2026-01-01',
        endDate: '2026-01-14',
        capacityPoints: 8,
      });
      const taskA = await createTask(app, manager.accessToken, {
        title: 'Top of backlog',
        project: project.id,
        priority: TaskPriority.P2,
        storyPoints: 5,
      });
      const taskB = await createTask(app, manager.accessToken, {
        title: 'Second in backlog',
        project: project.id,
        priority: TaskPriority.P2,
        storyPoints: 3,
      });
      const taskC = await createTask(app, manager.accessToken, {
        title: 'Would overflow capacity',
        project: project.id,
        priority: TaskPriority.P2,
        storyPoints: 4,
      });

      const res = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/planning-suggestion`)
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        suggestedTaskIds: [taskA.id, taskB.id],
        suggestedPoints: 8,
        basis: 'capacity',
        targetPoints: 8,
      });
      void taskC;
    });

    it('rejects a planning suggestion for a sprint that has already started (400)', async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, {
        name: 'Started Sprint Project',
      });
      const sprint = await createSprint(app, manager.accessToken, project.id, {
        name: 'Sprint 1',
        startDate: '2026-01-01',
        endDate: '2026-01-14',
      });
      await api(app)
        .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/start`)
        .set(...authHeader(manager.accessToken));

      const res = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/planning-suggestion`)
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(400);
    });

    it('produces no suggestion for a brand-new project with no capacity set and no velocity history', async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, { name: 'No Signal Project' });
      const sprint = await createSprint(app, manager.accessToken, project.id, {
        name: 'Sprint 1',
        startDate: '2026-01-01',
        endDate: '2026-01-14',
      });
      await createTask(app, manager.accessToken, {
        title: 'Backlog item',
        project: project.id,
        priority: TaskPriority.P2,
        storyPoints: 3,
      });

      const res = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/planning-suggestion`)
        .set(...authHeader(manager.accessToken));
      expect(res.body.data).toMatchObject({ basis: 'none', suggestedTaskIds: [] });
    });
  });

  describe('issue summary', () => {
    it('reflects real comment/link/status-change/watcher counts, not placeholder text', async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, { name: 'Summary Project' });
      const taskA = await createTask(app, manager.accessToken, {
        title: 'Task with a story',
        project: project.id,
        priority: TaskPriority.P2,
      });
      const taskB = await createTask(app, manager.accessToken, {
        title: 'Related task',
        project: project.id,
        priority: TaskPriority.P2,
      });

      const linkTypes = await api(app)
        .get(`/${API_PREFIX}/link-types`)
        .set(...authHeader(manager.accessToken));
      await api(app)
        .post(`/${API_PREFIX}/tasks/${taskA.id}/links`)
        .set(...authHeader(manager.accessToken))
        .send({ targetTaskId: taskB.id, linkTypeId: linkTypes.body.data[0].id });

      await api(app)
        .post(`/${API_PREFIX}/tasks/${taskA.id}/comments`)
        .set(...authHeader(manager.accessToken))
        .send({ body: 'First comment' });
      await api(app)
        .post(`/${API_PREFIX}/tasks/${taskA.id}/comments`)
        .set(...authHeader(manager.accessToken))
        .send({ body: 'Second comment' });

      await api(app)
        .patch(`/${API_PREFIX}/tasks/${taskA.id}/status`)
        .set(...authHeader(manager.accessToken))
        .send({ status: TaskStatus.IN_PROGRESS });

      const res = await api(app)
        .get(`/${API_PREFIX}/tasks/${taskA.id}/summary`)
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data.headline).toContain('Task with a story');
      expect(res.body.data.bullets).toContain('2 comments, 1 linked issue.');
      expect(res.body.data.bullets).toContain('1 status change, 0 reassignments so far.');
      // The creator is auto-added as a watcher (Module 7) - never a placeholder "0 users".
      expect(res.body.data.bullets.some((b: string) => b.startsWith('Watched by 1 user'))).toBe(
        true,
      );
      expect(res.body.data.generatedAt).toBeTruthy();
    });

    it('rejects a Developer with no view access to the project (403)', async () => {
      const { org, manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, {
        name: 'Private Summary Project',
      });
      const task = await createTask(app, manager.accessToken, {
        title: 'Task',
        project: project.id,
        priority: TaskPriority.P2,
      });
      const stranger = await seedUserAndLogin(app, {
        email: 'ai-stranger@example.com',
        password: 'Password123',
        role: Role.DEVELOPER,
        organizationId: org.id,
      });

      const res = await api(app)
        .get(`/${API_PREFIX}/tasks/${task.id}/summary`)
        .set(...authHeader(stranger.accessToken));
      expect(res.status).toBe(403);
    });
  });

  describe('suggested task fields', () => {
    it('suggests the most frequent assignee and labels for the project', async () => {
      const { org, manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, {
        name: 'Suggested Fields Project',
      });
      const developer = await seedUserAndLogin(app, {
        email: 'ai-developer@example.com',
        password: 'Password123',
        role: Role.DEVELOPER,
        organizationId: org.id,
      });
      await api(app)
        .post(`/${API_PREFIX}/projects/${project.id}/members`)
        .set(...authHeader(manager.accessToken))
        .send({ userIds: [developer.userDoc.id] });

      await createTask(app, manager.accessToken, {
        title: 'Task 1',
        project: project.id,
        priority: TaskPriority.P2,
        assignee: developer.userDoc.id,
        labels: ['backend', 'urgent'],
      });
      await createTask(app, manager.accessToken, {
        title: 'Task 2',
        project: project.id,
        priority: TaskPriority.P2,
        assignee: developer.userDoc.id,
        labels: ['backend'],
      });
      await createTask(app, manager.accessToken, {
        title: 'Task 3',
        project: project.id,
        priority: TaskPriority.P2,
        labels: ['frontend'],
      });

      const res = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/tasks/suggested-fields`)
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data.suggestedAssigneeId).toBe(developer.userDoc.id);
      expect(res.body.data.suggestedLabels).toEqual(
        expect.arrayContaining(['backend', 'urgent', 'frontend']),
      );
      expect(res.body.data.suggestedLabels[0]).toBe('backend');
    });

    it('returns null/empty suggestions for a project with no tasks yet (regression)', async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, { name: 'Empty Project' });

      const res = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/tasks/suggested-fields`)
        .set(...authHeader(manager.accessToken));
      expect(res.body.data).toEqual({ suggestedAssigneeId: null, suggestedLabels: [] });
    });

    it('skips a more-frequently-assigned Manager/Admin in favor of a Developer (regression: New Task can only pre-select a Developer)', async () => {
      const { org, manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, {
        name: 'Non-Developer Assignee Project',
      });
      const developer = await seedUserAndLogin(app, {
        email: 'ai-developer-2@example.com',
        password: 'Password123',
        role: Role.DEVELOPER,
        organizationId: org.id,
      });
      await api(app)
        .post(`/${API_PREFIX}/projects/${project.id}/members`)
        .set(...authHeader(manager.accessToken))
        .send({ userIds: [developer.userDoc.id] });

      // The Manager (project owner) is assigned MORE tasks than the Developer, but the Assignee
      // picker in the New Task form only ever offers active Developers - suggesting the Manager
      // would be a dead end the form has no way to actually apply.
      await createTask(app, manager.accessToken, {
        title: 'Manager task 1',
        project: project.id,
        priority: TaskPriority.P2,
        assignee: manager.userDoc.id,
      });
      await createTask(app, manager.accessToken, {
        title: 'Manager task 2',
        project: project.id,
        priority: TaskPriority.P2,
        assignee: manager.userDoc.id,
      });
      await createTask(app, manager.accessToken, {
        title: 'Developer task',
        project: project.id,
        priority: TaskPriority.P2,
        assignee: developer.userDoc.id,
      });

      const res = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/tasks/suggested-fields`)
        .set(...authHeader(manager.accessToken));
      expect(res.body.data.suggestedAssigneeId).toBe(developer.userDoc.id);
    });
  });
});
