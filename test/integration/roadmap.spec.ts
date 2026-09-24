import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { TaskPriority } from 'src/common/enums/task-priority.enum';
import { IssueType } from 'src/common/enums/issue-type.enum';
import { StatusCategory } from 'src/common/enums/status-category.enum';
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

describe('cross-project roadmap (integration)', () => {
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
      email: 'roadmap-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    return { org, manager };
  }

  it('reports epics across projects with progress, a cross-project blocking warning, and per-project capacity', async () => {
    const { manager } = await seedManager();
    const projectA = await createProject(app, manager.accessToken, { name: 'Roadmap Project A' });
    const projectB = await createProject(app, manager.accessToken, { name: 'Roadmap Project B' });

    const epicA = await createTask(app, manager.accessToken, {
      title: 'Epic A',
      project: projectA.id,
      priority: TaskPriority.P1,
      issueType: IssueType.EPIC,
    });
    const storyA = await createTask(app, manager.accessToken, {
      title: 'Story under Epic A',
      project: projectA.id,
      priority: TaskPriority.P2,
      issueType: IssueType.STORY,
      parent: epicA.id,
    });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${storyA.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'In Progress' });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${storyA.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'Review' });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${storyA.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'Done' });

    const epicB = await createTask(app, manager.accessToken, {
      title: 'Epic B',
      project: projectB.id,
      priority: TaskPriority.P1,
      issueType: IssueType.EPIC,
    });

    // Epic B blocks Epic A, across projects - a "blocked by" warning must surface on Epic A's row.
    await api(app)
      .post(`/${API_PREFIX}/tasks/${epicB.id}/links`)
      .set(...authHeader(manager.accessToken))
      .send({ targetTaskId: epicA.id, linkTypeId: 'blocks' });

    // Give Project A's active sprint some committed points, to prove the capacity aggregation.
    const sprint = await createSprint(app, manager.accessToken, projectA.id, {
      name: 'Sprint 1',
      startDate: '2026-01-01',
      endDate: '2026-01-14',
    });
    await api(app)
      .post(`/${API_PREFIX}/projects/${projectA.id}/sprints/${sprint.id}/start`)
      .set(...authHeader(manager.accessToken));
    const pointedTask = await createTask(app, manager.accessToken, {
      title: 'Pointed task',
      project: projectA.id,
      priority: TaskPriority.P2,
      storyPoints: 5,
    });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${pointedTask.id}/sprint`)
      .set(...authHeader(manager.accessToken))
      .send({ sprintId: sprint.id });

    const res = await api(app)
      .get(`/${API_PREFIX}/projects/reports/roadmap`)
      .set(...authHeader(manager.accessToken));
    expect(res.status).toBe(200);

    const projectIds = res.body.data.projects.map((p: { id: string }) => p.id);
    expect(projectIds).toEqual(expect.arrayContaining([projectA.id, projectB.id]));

    const byEpicId = Object.fromEntries(
      res.body.data.epics.map((e: { epicId: string }) => [e.epicId, e]),
    );
    expect(byEpicId[epicA.id]).toMatchObject({
      progress: 100,
      linkedIssueCount: 1,
      doneCount: 1,
      project: { id: projectA.id },
    });
    expect(byEpicId[epicA.id].blockedByExternal).toEqual([
      expect.objectContaining({ epicId: epicB.id, projectName: 'Roadmap Project B' }),
    ]);
    // Epic B is the blocker, not the blocked side - it carries no warning of its own.
    expect(byEpicId[epicB.id].blockedByExternal).toEqual([]);

    const capacityByProject = Object.fromEntries(
      res.body.data.capacity.map((c: { projectId: string }) => [c.projectId, c]),
    );
    expect(capacityByProject[projectA.id]).toMatchObject({
      activeSprintId: sprint.id,
      committedPoints: 5,
    });
    expect(capacityByProject[projectB.id]).toMatchObject({
      activeSprintId: null,
      committedPoints: 0,
    });
  });

  it('does not surface a same-project blocking link as a cross-project warning', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, {
      name: 'Same Project Blocking',
    });
    const epicX = await createTask(app, manager.accessToken, {
      title: 'Epic X',
      project: project.id,
      priority: TaskPriority.P2,
      issueType: IssueType.EPIC,
    });
    const epicY = await createTask(app, manager.accessToken, {
      title: 'Epic Y',
      project: project.id,
      priority: TaskPriority.P2,
      issueType: IssueType.EPIC,
    });
    await api(app)
      .post(`/${API_PREFIX}/tasks/${epicY.id}/links`)
      .set(...authHeader(manager.accessToken))
      .send({ targetTaskId: epicX.id, linkTypeId: 'blocks' });

    const res = await api(app)
      .get(`/${API_PREFIX}/projects/reports/roadmap`)
      .set(...authHeader(manager.accessToken));
    const byEpicId = Object.fromEntries(
      res.body.data.epics.map((e: { epicId: string }) => [e.epicId, e]),
    );
    expect(byEpicId[epicX.id].blockedByExternal).toEqual([]);
  });

  it('filters by projectIds and by status', async () => {
    const { manager } = await seedManager();
    const projectA = await createProject(app, manager.accessToken, { name: 'Filter Roadmap A' });
    const projectB = await createProject(app, manager.accessToken, { name: 'Filter Roadmap B' });
    const epicA = await createTask(app, manager.accessToken, {
      title: 'Epic in A',
      project: projectA.id,
      priority: TaskPriority.P2,
      issueType: IssueType.EPIC,
    });
    await createTask(app, manager.accessToken, {
      title: 'Epic in B',
      project: projectB.id,
      priority: TaskPriority.P2,
      issueType: IssueType.EPIC,
    });

    const scoped = await api(app)
      .get(`/${API_PREFIX}/projects/reports/roadmap`)
      .query({ projectIds: [projectA.id] })
      .set(...authHeader(manager.accessToken));
    expect(scoped.body.data.projects).toHaveLength(1);
    expect(scoped.body.data.epics).toHaveLength(1);
    expect(scoped.body.data.epics[0].epicId).toBe(epicA.id);

    const byStatus = await api(app)
      .get(`/${API_PREFIX}/projects/reports/roadmap`)
      .query({ status: StatusCategory.DONE })
      .set(...authHeader(manager.accessToken));
    expect(byStatus.body.data.epics).toHaveLength(0);
  });

  it('only returns projects/epics the caller can access', async () => {
    const { org, manager } = await seedManager();
    await createProject(app, manager.accessToken, { name: 'Manager Only Project' });

    const outsider = await seedUserAndLogin(app, {
      email: 'roadmap-outsider@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });

    const res = await api(app)
      .get(`/${API_PREFIX}/projects/reports/roadmap`)
      .set(...authHeader(outsider.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ projects: [], epics: [], capacity: [] });
  });
});
