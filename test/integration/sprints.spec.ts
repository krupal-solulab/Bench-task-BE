import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { SprintStatus } from 'src/common/enums/sprint-status.enum';
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

describe('sprints (integration)', () => {
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
      email: 'sprint-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: 'sprint-developer@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    return { org, manager, developer };
  }

  it('creates a sprint as Planned, and rejects an illegal endDate/startDate pair', async () => {
    const { manager } = await seedManagerAndDeveloper();
    const project = await createProject(app, manager.accessToken, { name: 'CRUD Project' });

    const sprint = await createSprint(app, manager.accessToken, project.id, {
      name: 'Sprint 1',
      goal: 'Ship the thing',
      startDate: '2026-01-01',
      endDate: '2026-01-14',
    });
    expect(sprint.status).toBe(SprintStatus.PLANNED);

    const invalid = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints`)
      .set(...authHeader(manager.accessToken))
      .send({ name: 'Bad Sprint', startDate: '2026-02-01', endDate: '2026-01-01' });
    expect(invalid.status).toBe(400);
  });

  it('creates a sprint via a duration preset, computing endDate server-side (Phase 2 gap-closure)', async () => {
    const { manager } = await seedManagerAndDeveloper();
    const project = await createProject(app, manager.accessToken, { name: 'Duration Project' });

    const sprint = await createSprint(app, manager.accessToken, project.id, {
      name: 'Sprint 1',
      startDate: '2026-01-01',
      durationWeeks: 2,
      capacityPoints: 40,
    });
    expect(sprint.endDate.slice(0, 10)).toBe('2026-01-15');
    expect(sprint.capacityPoints).toBe(40);
  });

  it('rejects a sprint with neither endDate nor durationWeeks', async () => {
    const { manager } = await seedManagerAndDeveloper();
    const project = await createProject(app, manager.accessToken, { name: 'Bad Duration Project' });

    const res = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints`)
      .set(...authHeader(manager.accessToken))
      .send({ name: 'Sprint 1', startDate: '2026-01-01' });
    expect(res.status).toBe(400);
  });

  it('completes a sprint into a chosen next Planned sprint instead of the backlog (Phase 2 gap-closure)', async () => {
    const { manager } = await seedManagerAndDeveloper();
    const project = await createProject(app, manager.accessToken, { name: 'Next Sprint Project' });
    const sprint1 = await createSprint(app, manager.accessToken, project.id, {
      name: 'Sprint 1',
      startDate: '2026-01-01',
      endDate: '2026-01-14',
    });
    const sprint2 = await createSprint(app, manager.accessToken, project.id, {
      name: 'Sprint 2',
      startDate: '2026-01-15',
      endDate: '2026-01-28',
    });
    await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint1.id}/start`)
      .set(...authHeader(manager.accessToken));

    const openTask = await createTask(app, manager.accessToken, {
      title: 'Unfinished work',
      project: project.id,
      priority: TaskPriority.P2,
    });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${openTask.id}/sprint`)
      .set(...authHeader(manager.accessToken))
      .send({ sprintId: sprint1.id });

    const completeRes = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint1.id}/complete`)
      .set(...authHeader(manager.accessToken))
      .send({ nextSprintId: sprint2.id });
    expect(completeRes.status).toBe(201);

    const taskAfter = await api(app)
      .get(`/${API_PREFIX}/tasks/${openTask.id}`)
      .set(...authHeader(manager.accessToken));
    expect(taskAfter.body.data.sprint.id).toBe(sprint2.id);
  });

  it('rejects completing into a next sprint that is not Planned', async () => {
    const { manager } = await seedManagerAndDeveloper();
    const project = await createProject(app, manager.accessToken, { name: 'Bad Next Sprint' });
    const sprint1 = await createSprint(app, manager.accessToken, project.id, {
      name: 'Sprint 1',
      startDate: '2026-01-01',
      endDate: '2026-01-14',
    });
    const sprint2 = await createSprint(app, manager.accessToken, project.id, {
      name: 'Sprint 2',
      startDate: '2026-01-15',
      endDate: '2026-01-28',
    });
    const sprint3 = await createSprint(app, manager.accessToken, project.id, {
      name: 'Sprint 3',
      startDate: '2026-01-29',
      endDate: '2026-02-11',
    });

    // Only one sprint may be Active at a time, so cycle sprint1 and sprint2 through to Completed
    // one at a time before starting sprint3.
    await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint1.id}/start`)
      .set(...authHeader(manager.accessToken));
    await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint1.id}/complete`)
      .set(...authHeader(manager.accessToken));
    await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint2.id}/start`)
      .set(...authHeader(manager.accessToken));
    await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint2.id}/complete`)
      .set(...authHeader(manager.accessToken));
    await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint3.id}/start`)
      .set(...authHeader(manager.accessToken));

    const res = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint3.id}/complete`)
      .set(...authHeader(manager.accessToken))
      .send({ nextSprintId: sprint2.id }); // sprint2 is Completed, not Planned
    expect(res.status).toBe(400);
  });

  it('records a completion rate and lists it in sprint history (Phase 2 gap-closure)', async () => {
    const { manager } = await seedManagerAndDeveloper();
    const project = await createProject(app, manager.accessToken, { name: 'History Project' });
    const sprint = await createSprint(app, manager.accessToken, project.id, {
      name: 'Sprint 1',
      goal: 'Ship it',
      startDate: '2026-01-01',
      endDate: '2026-01-14',
    });
    await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/start`)
      .set(...authHeader(manager.accessToken));

    const doneTask = await createTask(app, manager.accessToken, {
      title: 'Finished work',
      project: project.id,
      priority: TaskPriority.P2,
    });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${doneTask.id}/sprint`)
      .set(...authHeader(manager.accessToken))
      .send({ sprintId: sprint.id });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${doneTask.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TaskStatus.IN_PROGRESS });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${doneTask.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TaskStatus.REVIEW });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${doneTask.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TaskStatus.DONE });

    await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/complete`)
      .set(...authHeader(manager.accessToken));

    const history = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/sprints/history`)
      .set(...authHeader(manager.accessToken));
    expect(history.status).toBe(200);
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0]).toMatchObject({
      name: 'Sprint 1',
      goal: 'Ship it',
      completionRatePercent: 100,
    });
  });

  it('snapshots initialTaskIds when a sprint starts', async () => {
    const { manager } = await seedManagerAndDeveloper();
    const project = await createProject(app, manager.accessToken, { name: 'Snapshot Project' });
    const sprint = await createSprint(app, manager.accessToken, project.id, {
      name: 'Sprint 1',
      startDate: '2026-01-01',
      endDate: '2026-01-14',
    });
    const task = await createTask(app, manager.accessToken, {
      title: 'Locked-in task',
      project: project.id,
      priority: TaskPriority.P2,
    });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/sprint`)
      .set(...authHeader(manager.accessToken))
      .send({ sprintId: sprint.id });

    const started = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/start`)
      .set(...authHeader(manager.accessToken));
    expect(started.body.data.initialTaskIds).toEqual([task.id]);

    // Adding a task after start is still allowed (no server-side block - see updateSprint's own
    // comment on why this is a client-side confirmation, not a backend gate).
    const addedLater = await createTask(app, manager.accessToken, {
      title: 'Added mid-sprint',
      project: project.id,
      priority: TaskPriority.P2,
    });
    const midSprintAdd = await api(app)
      .patch(`/${API_PREFIX}/tasks/${addedLater.id}/sprint`)
      .set(...authHeader(manager.accessToken))
      .send({ sprintId: sprint.id });
    expect(midSprintAdd.status).toBe(200);
  });

  it('starts a sprint, blocks starting a second one while it is Active, then completes it', async () => {
    const { manager } = await seedManagerAndDeveloper();
    const project = await createProject(app, manager.accessToken, { name: 'Lifecycle Project' });
    const sprintA = await createSprint(app, manager.accessToken, project.id, {
      name: 'Sprint A',
      startDate: '2026-01-01',
      endDate: '2026-01-14',
    });
    const sprintB = await createSprint(app, manager.accessToken, project.id, {
      name: 'Sprint B',
      startDate: '2026-01-15',
      endDate: '2026-01-28',
    });

    const started = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprintA.id}/start`)
      .set(...authHeader(manager.accessToken));
    expect(started.status).toBe(201);
    expect(started.body.data.status).toBe(SprintStatus.ACTIVE);

    const activeRes = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/sprints/active`)
      .set(...authHeader(manager.accessToken));
    expect(activeRes.body.data.id).toBe(sprintA.id);

    const blockedStart = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprintB.id}/start`)
      .set(...authHeader(manager.accessToken));
    expect(blockedStart.status).toBe(409);

    const completed = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprintA.id}/complete`)
      .set(...authHeader(manager.accessToken));
    expect(completed.status).toBe(201);
    expect(completed.body.data.status).toBe(SprintStatus.COMPLETED);

    // Now sprint B can start.
    const startedB = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprintB.id}/start`)
      .set(...authHeader(manager.accessToken));
    expect(startedB.status).toBe(201);
  });

  it('rejects editing or deleting a Completed sprint', async () => {
    const { manager } = await seedManagerAndDeveloper();
    const project = await createProject(app, manager.accessToken, {
      name: 'Immutable History Project',
    });
    const sprint = await createSprint(app, manager.accessToken, project.id, {
      name: 'Sprint 1',
      startDate: '2026-01-01',
      endDate: '2026-01-14',
    });
    await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/start`)
      .set(...authHeader(manager.accessToken));
    await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/complete`)
      .set(...authHeader(manager.accessToken));

    const editAttempt = await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}`)
      .set(...authHeader(manager.accessToken))
      .send({ name: 'Renamed' });
    expect(editAttempt.status).toBe(409);

    const deleteAttempt = await api(app)
      .delete(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}`)
      .set(...authHeader(manager.accessToken));
    expect(deleteAttempt.status).toBe(409);
  });

  it('completing a sprint moves incomplete tasks back to the backlog but keeps Done tasks attached', async () => {
    const { manager } = await seedManagerAndDeveloper();
    const project = await createProject(app, manager.accessToken, { name: 'Completion Project' });
    const sprint = await createSprint(app, manager.accessToken, project.id, {
      name: 'Sprint 1',
      startDate: '2026-01-01',
      endDate: '2026-01-14',
    });
    await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/start`)
      .set(...authHeader(manager.accessToken));

    const doneTask = await createTask(app, manager.accessToken, {
      title: 'Finished work',
      project: project.id,
      priority: TaskPriority.P2,
    });
    const openTask = await createTask(app, manager.accessToken, {
      title: 'Unfinished work',
      project: project.id,
      priority: TaskPriority.P2,
    });

    await api(app)
      .patch(`/${API_PREFIX}/tasks/${doneTask.id}/sprint`)
      .set(...authHeader(manager.accessToken))
      .send({ sprintId: sprint.id });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${openTask.id}/sprint`)
      .set(...authHeader(manager.accessToken))
      .send({ sprintId: sprint.id });

    // Walk doneTask through its legal transitions to Done.
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${doneTask.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TaskStatus.IN_PROGRESS });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${doneTask.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TaskStatus.REVIEW });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${doneTask.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TaskStatus.DONE });

    await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/complete`)
      .set(...authHeader(manager.accessToken));

    const doneAfter = await api(app)
      .get(`/${API_PREFIX}/tasks/${doneTask.id}`)
      .set(...authHeader(manager.accessToken));
    expect(doneAfter.body.data.sprint.id).toBe(sprint.id);

    const openAfter = await api(app)
      .get(`/${API_PREFIX}/tasks/${openTask.id}`)
      .set(...authHeader(manager.accessToken));
    expect(openAfter.body.data.sprint).toBeNull();

    const backlog = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/tasks`)
      .query({ unassignedSprint: true })
      .set(...authHeader(manager.accessToken));
    expect(backlog.body.data.map((t: { id: string }) => t.id)).toContain(openTask.id);
  });

  it('reorders the backlog via PATCH /tasks/:id/rank', async () => {
    const { manager } = await seedManagerAndDeveloper();
    const project = await createProject(app, manager.accessToken, { name: 'Backlog Project' });
    const first = await createTask(app, manager.accessToken, {
      title: 'First',
      project: project.id,
      priority: TaskPriority.P2,
    });
    const second = await createTask(app, manager.accessToken, {
      title: 'Second',
      project: project.id,
      priority: TaskPriority.P2,
    });
    const third = await createTask(app, manager.accessToken, {
      title: 'Third',
      project: project.id,
      priority: TaskPriority.P2,
    });

    // Created order is first, second, third. Move `third` between first and second.
    const reorder = await api(app)
      .patch(`/${API_PREFIX}/tasks/${third.id}/rank`)
      .set(...authHeader(manager.accessToken))
      .send({ beforeTaskId: first.id, afterTaskId: second.id });
    expect(reorder.status).toBe(200);

    const backlog = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/tasks`)
      .query({ unassignedSprint: true, sortBy: 'rank', sortOrder: 'asc' })
      .set(...authHeader(manager.accessToken));

    expect(backlog.body.data.map((t: { id: string }) => t.id)).toEqual([
      first.id,
      third.id,
      second.id,
    ]);
  });

  it('a Developer gets 403 creating/starting/completing a sprint but can list/view one', async () => {
    const { manager, developer } = await seedManagerAndDeveloper();
    const project = await createProject(app, manager.accessToken, { name: 'RBAC Sprint Project' });
    await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/members`)
      .set(...authHeader(manager.accessToken))
      .send({ userIds: [developer.userDoc.id] });
    const sprint = await createSprint(app, manager.accessToken, project.id, {
      name: 'Sprint 1',
      startDate: '2026-01-01',
      endDate: '2026-01-14',
    });

    const createAttempt = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints`)
      .set(...authHeader(developer.accessToken))
      .send({ name: 'Nope', startDate: '2026-01-01', endDate: '2026-01-14' });
    expect(createAttempt.status).toBe(403);

    const startAttempt = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/start`)
      .set(...authHeader(developer.accessToken));
    expect(startAttempt.status).toBe(403);

    const viewAttempt = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}`)
      .set(...authHeader(developer.accessToken));
    expect(viewAttempt.status).toBe(200);
  });

  it('GET /projects/:id/sprints/:id/activity records CREATED, STARTED, COMPLETED in order', async () => {
    const { manager } = await seedManagerAndDeveloper();
    const project = await createProject(app, manager.accessToken, { name: 'Activity Project' });
    const sprint = await createSprint(app, manager.accessToken, project.id, {
      name: 'Sprint 1',
      startDate: '2026-01-01',
      endDate: '2026-01-14',
    });
    await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/start`)
      .set(...authHeader(manager.accessToken));
    await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/complete`)
      .set(...authHeader(manager.accessToken));

    const res = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/activity`)
      .set(...authHeader(manager.accessToken));

    expect(res.status).toBe(200);
    const actions = res.body.data.map((a: { action: string }) => a.action);
    expect(actions).toEqual(['completed', 'started', 'created']);
  });

  describe('reporting (burndown + velocity)', () => {
    it('GET .../burndown returns an empty result for a sprint that has never been started', async () => {
      const { manager } = await seedManagerAndDeveloper();
      const project = await createProject(app, manager.accessToken, { name: 'Never Started' });
      const sprint = await createSprint(app, manager.accessToken, project.id, {
        name: 'Sprint 1',
        startDate: '2026-01-01',
        endDate: '2026-01-14',
      });

      const res = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/burndown`)
        .set(...authHeader(manager.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ points: [], hasStoryPoints: false });
    });

    it('GET .../burndown reflects a task completing partway through the sprint', async () => {
      const { manager } = await seedManagerAndDeveloper();
      const project = await createProject(app, manager.accessToken, { name: 'Burndown Project' });
      const sprint = await createSprint(app, manager.accessToken, project.id, {
        name: 'Sprint 1',
        startDate: '2026-01-01',
        endDate: '2026-01-14',
      });
      await api(app)
        .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/start`)
        .set(...authHeader(manager.accessToken));

      const taskA = await createTask(app, manager.accessToken, {
        title: 'Task A',
        project: project.id,
        priority: TaskPriority.P2,
        storyPoints: 3,
      });
      const taskB = await createTask(app, manager.accessToken, {
        title: 'Task B',
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

      const before = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/burndown`)
        .set(...authHeader(manager.accessToken));
      expect(before.status).toBe(200);
      expect(before.body.data.hasStoryPoints).toBe(true);
      const lastPointBefore = before.body.data.points[before.body.data.points.length - 1];
      expect(lastPointBefore).toMatchObject({ remainingPoints: 8, remainingCount: 2 });

      // Walk taskA through its legal transitions to Done.
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

      const after = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/burndown`)
        .set(...authHeader(manager.accessToken));
      const lastPointAfter = after.body.data.points[after.body.data.points.length - 1];
      expect(lastPointAfter).toMatchObject({ remainingPoints: 5, remainingCount: 1 });
    });

    it('GET .../sprints/velocity is empty with no completed sprints, then reports completed points after one closes', async () => {
      const { manager } = await seedManagerAndDeveloper();
      const project = await createProject(app, manager.accessToken, { name: 'Velocity Project' });

      const empty = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/sprints/velocity`)
        .set(...authHeader(manager.accessToken));
      expect(empty.status).toBe(200);
      expect(empty.body.data).toEqual([]);

      const sprint = await createSprint(app, manager.accessToken, project.id, {
        name: 'Sprint 1',
        startDate: '2026-01-01',
        endDate: '2026-01-14',
      });
      await api(app)
        .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/start`)
        .set(...authHeader(manager.accessToken));

      const doneTask = await createTask(app, manager.accessToken, {
        title: 'Finished work',
        project: project.id,
        priority: TaskPriority.P2,
        storyPoints: 8,
      });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${doneTask.id}/sprint`)
        .set(...authHeader(manager.accessToken))
        .send({ sprintId: sprint.id });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${doneTask.id}/status`)
        .set(...authHeader(manager.accessToken))
        .send({ status: TaskStatus.IN_PROGRESS });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${doneTask.id}/status`)
        .set(...authHeader(manager.accessToken))
        .send({ status: TaskStatus.REVIEW });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${doneTask.id}/status`)
        .set(...authHeader(manager.accessToken))
        .send({ status: TaskStatus.DONE });

      await api(app)
        .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/complete`)
        .set(...authHeader(manager.accessToken));

      const afterComplete = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/sprints/velocity`)
        .set(...authHeader(manager.accessToken));
      expect(afterComplete.status).toBe(200);
      expect(afterComplete.body.data).toEqual([
        expect.objectContaining({
          sprintId: sprint.id,
          name: 'Sprint 1',
          completedPoints: 8,
          completedCount: 1,
        }),
      ]);
    });
  });
});
