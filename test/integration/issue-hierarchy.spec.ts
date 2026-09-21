import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { IssueType } from 'src/common/enums/issue-type.enum';
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

describe('issue type hierarchy (integration)', () => {
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
      email: 'hierarchy-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    return { org, manager };
  }

  it('creates an Epic, a linked Story, and a Sub-task, each with a sequential issue key', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Support Desk' });

    const epic = await createTask(app, manager.accessToken, {
      title: 'Billing overhaul',
      project: project.id,
      priority: TaskPriority.P1,
      issueType: IssueType.EPIC,
    });
    expect(epic.issueType).toBe(IssueType.EPIC);
    expect(epic.issueKey).toMatch(/^[A-Z]+-1$/);
    expect(epic.parent).toBeNull();

    const story = await createTask(app, manager.accessToken, {
      title: 'Add invoice export',
      project: project.id,
      priority: TaskPriority.P2,
      issueType: IssueType.STORY,
      parent: epic.id,
    });
    expect(story.issueType).toBe(IssueType.STORY);
    expect(story.parent.id).toBe(epic.id);
    expect(story.issueKey).toMatch(/-2$/);

    const subtask = await createTask(app, manager.accessToken, {
      title: 'Write export unit tests',
      project: project.id,
      priority: TaskPriority.P3,
      issueType: IssueType.SUBTASK,
      parent: story.id,
    });
    expect(subtask.issueType).toBe(IssueType.SUBTASK);
    expect(subtask.parent.id).toBe(story.id);
    expect(subtask.issueKey).toMatch(/-3$/);
  });

  it('rejects a Sub-task with no parent', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'No Parent Project' });

    const res = await api(app)
      .post(`/${API_PREFIX}/tasks`)
      .set(...authHeader(manager.accessToken))
      .send({
        title: 'Orphan sub-task',
        project: project.id,
        priority: TaskPriority.P2,
        issueType: IssueType.SUBTASK,
      });
    expect(res.status).toBe(400);
  });

  it('rejects a Sub-task whose parent is an Epic (must be Story/Task/Bug)', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Wrong Parent Project' });
    const epic = await createTask(app, manager.accessToken, {
      title: 'An epic',
      project: project.id,
      priority: TaskPriority.P2,
      issueType: IssueType.EPIC,
    });

    const res = await api(app)
      .post(`/${API_PREFIX}/tasks`)
      .set(...authHeader(manager.accessToken))
      .send({
        title: 'Sub-task under an Epic',
        project: project.id,
        priority: TaskPriority.P2,
        issueType: IssueType.SUBTASK,
        parent: epic.id,
      });
    expect(res.status).toBe(400);
  });

  it('rejects an Epic given a parent', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Epic Parent Project' });
    const otherEpic = await createTask(app, manager.accessToken, {
      title: 'Other epic',
      project: project.id,
      priority: TaskPriority.P2,
      issueType: IssueType.EPIC,
    });

    const res = await api(app)
      .post(`/${API_PREFIX}/tasks`)
      .set(...authHeader(manager.accessToken))
      .send({
        title: 'Epic with a parent',
        project: project.id,
        priority: TaskPriority.P2,
        issueType: IssueType.EPIC,
        parent: otherEpic.id,
      });
    expect(res.status).toBe(400);
  });

  it("rejects a Story whose parent isn't an Epic", async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Story Parent Project' });
    const otherStory = await createTask(app, manager.accessToken, {
      title: 'Another story',
      project: project.id,
      priority: TaskPriority.P2,
      issueType: IssueType.STORY,
    });

    const res = await api(app)
      .post(`/${API_PREFIX}/tasks`)
      .set(...authHeader(manager.accessToken))
      .send({
        title: 'Story linked to a Story',
        project: project.id,
        priority: TaskPriority.P2,
        issueType: IssueType.STORY,
        parent: otherStory.id,
      });
    expect(res.status).toBe(400);
  });

  it('rejects a parent from a different project', async () => {
    const { manager } = await seedManager();
    const projectA = await createProject(app, manager.accessToken, { name: 'Project A' });
    const projectB = await createProject(app, manager.accessToken, { name: 'Project B' });
    const epicInA = await createTask(app, manager.accessToken, {
      title: 'Epic in A',
      project: projectA.id,
      priority: TaskPriority.P2,
      issueType: IssueType.EPIC,
    });

    const res = await api(app)
      .post(`/${API_PREFIX}/tasks`)
      .set(...authHeader(manager.accessToken))
      .send({
        title: 'Story in B linked to an Epic in A',
        project: projectB.id,
        priority: TaskPriority.P2,
        issueType: IssueType.STORY,
        parent: epicInA.id,
      });
    expect(res.status).toBe(400);
  });

  it('filters tasks by issueType and by parent', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Filter Project' });
    const epic = await createTask(app, manager.accessToken, {
      title: 'Epic X',
      project: project.id,
      priority: TaskPriority.P2,
      issueType: IssueType.EPIC,
    });
    await createTask(app, manager.accessToken, {
      title: 'Story under Epic X',
      project: project.id,
      priority: TaskPriority.P2,
      issueType: IssueType.STORY,
      parent: epic.id,
    });
    await createTask(app, manager.accessToken, {
      title: 'Plain task',
      project: project.id,
      priority: TaskPriority.P2,
    });

    const epicsOnly = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/tasks`)
      .query({ issueType: IssueType.EPIC })
      .set(...authHeader(manager.accessToken));
    expect(epicsOnly.body.data).toHaveLength(1);
    expect(epicsOnly.body.data[0].issueType).toBe(IssueType.EPIC);

    const childrenOfEpic = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/tasks`)
      .query({ parent: epic.id })
      .set(...authHeader(manager.accessToken));
    expect(childrenOfEpic.body.data).toHaveLength(1);
    expect(childrenOfEpic.body.data[0].title).toBe('Story under Epic X');
  });

  it("computes an Epic's linked-issue progress", async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Progress Project' });
    const epic = await createTask(app, manager.accessToken, {
      title: 'Progress epic',
      project: project.id,
      priority: TaskPriority.P2,
      issueType: IssueType.EPIC,
    });
    const storyA = await createTask(app, manager.accessToken, {
      title: 'Story A',
      project: project.id,
      priority: TaskPriority.P2,
      issueType: IssueType.STORY,
      parent: epic.id,
    });
    await createTask(app, manager.accessToken, {
      title: 'Story B',
      project: project.id,
      priority: TaskPriority.P2,
      issueType: IssueType.STORY,
      parent: epic.id,
    });

    // Walk Story A through its legal transitions to Done.
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${storyA.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TaskStatus.IN_PROGRESS });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${storyA.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TaskStatus.REVIEW });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${storyA.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TaskStatus.DONE });

    const progress = await api(app)
      .get(`/${API_PREFIX}/tasks/${epic.id}/epic-progress`)
      .set(...authHeader(manager.accessToken));
    expect(progress.status).toBe(200);
    expect(progress.body.data).toEqual({ linkedIssueCount: 2, doneCount: 1, progress: 50 });
  });

  it('rejects epic-progress on a non-Epic issue', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Not An Epic Project' });
    const task = await createTask(app, manager.accessToken, {
      title: 'Plain task',
      project: project.id,
      priority: TaskPriority.P2,
    });

    const res = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}/epic-progress`)
      .set(...authHeader(manager.accessToken));
    expect(res.status).toBe(400);
  });

  it('the bulk epic-progress report covers every Epic in a project (Search/Dashboards v2)', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Report Project' });

    const epicDone = await createTask(app, manager.accessToken, {
      title: 'Fully done epic',
      project: project.id,
      priority: TaskPriority.P2,
      issueType: IssueType.EPIC,
    });
    const storyDone = await createTask(app, manager.accessToken, {
      title: 'Story under done epic',
      project: project.id,
      priority: TaskPriority.P2,
      issueType: IssueType.STORY,
      parent: epicDone.id,
    });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${storyDone.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TaskStatus.IN_PROGRESS });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${storyDone.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TaskStatus.REVIEW });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${storyDone.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TaskStatus.DONE });

    const epicEmpty = await createTask(app, manager.accessToken, {
      title: 'Epic with no linked issues',
      project: project.id,
      priority: TaskPriority.P2,
      issueType: IssueType.EPIC,
    });

    const res = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/reports/epic-progress`)
      .set(...authHeader(manager.accessToken));
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.data.map((e: { epicId: string }) => [e.epicId, e]));
    expect(byId[epicDone.id]).toMatchObject({ linkedIssueCount: 1, doneCount: 1, progress: 100 });
    expect(byId[epicEmpty.id]).toMatchObject({ linkedIssueCount: 0, doneCount: 0, progress: 0 });
    // BRD 6.4's Epics View target date + roadmap timeline (Phase 2 gap-closure) - reuses the
    // generic Task.dueDate/createdAt fields, surfaced here for the frontend's roadmap chart.
    expect(byId[epicEmpty.id]).toHaveProperty('dueDate');
    expect(byId[epicEmpty.id]).toHaveProperty('createdAt');
  });

  it('rejects assigning an Epic or a Sub-task to a sprint', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Sprint Guard Project' });
    const sprint = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints`)
      .set(...authHeader(manager.accessToken))
      .send({ name: 'Sprint 1', startDate: '2026-01-01', endDate: '2026-01-14' });

    const epic = await createTask(app, manager.accessToken, {
      title: 'An epic',
      project: project.id,
      priority: TaskPriority.P2,
      issueType: IssueType.EPIC,
    });

    const res = await api(app)
      .patch(`/${API_PREFIX}/tasks/${epic.id}/sprint`)
      .set(...authHeader(manager.accessToken))
      .send({ sprintId: sprint.body.data.id });
    expect(res.status).toBe(400);
  });

  it('respects an explicit project key, or derives and dedupes one automatically', async () => {
    const { manager } = await seedManager();
    const namedProject = await createProject(app, manager.accessToken, {
      name: 'Custom Key Project',
      key: 'CKP',
    });
    const task = await createTask(app, manager.accessToken, {
      title: 'First issue',
      project: namedProject.id,
      priority: TaskPriority.P2,
    });
    expect(task.issueKey).toBe('CKP-1');

    // "Ckp" derives to exactly "CKP" (only 3 letters), colliding with the explicit key above.
    const collidingProject = await createProject(app, manager.accessToken, { name: 'Ckp' });
    const collidingTask = await createTask(app, manager.accessToken, {
      title: 'Second issue',
      project: collidingProject.id,
      priority: TaskPriority.P2,
    });
    expect(collidingTask.issueKey).toBe('CKP2-1');
  });
});
