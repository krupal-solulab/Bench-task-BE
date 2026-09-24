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

describe('releases & version management (integration)', () => {
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
      email: 'release-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    return { org, manager };
  }

  async function createRelease(
    token: string,
    projectId: string,
    body: Record<string, unknown> = {},
  ) {
    const res = await api(app)
      .post(`/${API_PREFIX}/projects/${projectId}/releases`)
      .set(...authHeader(token))
      .send({ name: 'v1.0.0', ...body });
    if (res.status !== 201) {
      throw new Error(`createRelease failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body.data;
  }

  it('creates, lists, updates, and deletes a release', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Release Project' });

    const created = await createRelease(manager.accessToken, project.id, {
      name: 'v1.0.0',
      description: 'First cut',
      releaseDate: '2026-03-01',
    });
    expect(created).toMatchObject({ name: 'v1.0.0', status: 'Unreleased' });

    const list = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/releases`)
      .set(...authHeader(manager.accessToken));
    expect(list.body.data).toHaveLength(1);

    const updated = await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/releases/${created.id}`)
      .set(...authHeader(manager.accessToken))
      .send({ description: 'Updated notes' });
    expect(updated.body.data.description).toBe('Updated notes');

    const deleted = await api(app)
      .delete(`/${API_PREFIX}/projects/${project.id}/releases/${created.id}`)
      .set(...authHeader(manager.accessToken));
    expect(deleted.status).toBe(204);

    const listAfter = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/releases`)
      .set(...authHeader(manager.accessToken));
    expect(listAfter.body.data).toHaveLength(0);
  });

  it('rejects a duplicate release name within the same project', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Dup Release Project' });
    await createRelease(manager.accessToken, project.id, { name: 'v1.0.0' });

    const res = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/releases`)
      .set(...authHeader(manager.accessToken))
      .send({ name: 'v1.0.0' });
    expect(res.status).toBe(409);
  });

  it('walks the release lifecycle: Unreleased -> Released -> Unreleased -> Archived', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Lifecycle Project' });
    const release = await createRelease(manager.accessToken, project.id);

    const released = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/releases/${release.id}/release`)
      .set(...authHeader(manager.accessToken));
    expect(released.body.data.status).toBe('Released');
    expect(released.body.data.releasedAt).not.toBeNull();

    const unreleased = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/releases/${release.id}/unrelease`)
      .set(...authHeader(manager.accessToken));
    expect(unreleased.body.data.status).toBe('Unreleased');
    // releasedAt is preserved even after reverting, so "was this ever released" stays answerable.
    expect(unreleased.body.data.releasedAt).not.toBeNull();

    const archived = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/releases/${release.id}/archive`)
      .set(...authHeader(manager.accessToken));
    expect(archived.body.data.status).toBe('Archived');

    const reRelease = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/releases/${release.id}/release`)
      .set(...authHeader(manager.accessToken));
    expect(reRelease.status).toBe(409);
  });

  it('rejects editing an archived release', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, {
      name: 'Archived Edit Project',
    });
    const release = await createRelease(manager.accessToken, project.id);
    await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/releases/${release.id}/archive`)
      .set(...authHeader(manager.accessToken));

    const res = await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/releases/${release.id}`)
      .set(...authHeader(manager.accessToken))
      .send({ description: 'too late' });
    expect(res.status).toBe(409);
  });

  it('only a Manager/Admin may create or manage a release; Developers may only view', async () => {
    const { org, manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Dev View Project' });
    const dev = await seedUserAndLogin(app, {
      email: 'release-dev@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/members`)
      .set(...authHeader(manager.accessToken))
      .send({ userIds: [dev.userDoc.id] });

    const res = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/releases`)
      .set(...authHeader(dev.accessToken))
      .send({ name: 'v1.0.0' });
    expect(res.status).toBe(403);

    const release = await createRelease(manager.accessToken, project.id);
    const viewRes = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/releases/${release.id}`)
      .set(...authHeader(dev.accessToken));
    expect(viewRes.status).toBe(200);
  });

  describe('fixVersions / affectsVersions on tasks', () => {
    it('attaches a release to a task via fixVersions and populates it back', async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, { name: 'FixVersion Project' });
      const release = await createRelease(manager.accessToken, project.id);

      const task = await createTask(app, manager.accessToken, {
        title: 'Ship the export feature',
        project: project.id,
        priority: TaskPriority.P2,
        fixVersions: [release.id],
      });
      expect(task.fixVersions).toHaveLength(1);
      expect(task.fixVersions[0]).toMatchObject({ id: release.id, name: 'v1.0.0' });
    });

    it('rejects a fixVersion/affectsVersion id from a different project', async () => {
      const { manager } = await seedManager();
      const projectA = await createProject(app, manager.accessToken, { name: 'Project A' });
      const projectB = await createProject(app, manager.accessToken, { name: 'Project B' });
      const releaseInB = await createRelease(manager.accessToken, projectB.id);

      const res = await api(app)
        .post(`/${API_PREFIX}/tasks`)
        .set(...authHeader(manager.accessToken))
        .send({
          title: 'Cross project task',
          project: projectA.id,
          priority: TaskPriority.P2,
          fixVersions: [releaseInB.id],
        });
      expect(res.status).toBe(400);
    });

    it('rejects an unknown release id', async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, {
        name: 'Unknown Release Project',
      });

      const res = await api(app)
        .post(`/${API_PREFIX}/tasks`)
        .set(...authHeader(manager.accessToken))
        .send({
          title: 'Task with bad release',
          project: project.id,
          priority: TaskPriority.P2,
          affectsVersions: ['507f1f77bcf86cd799439099'],
        });
      expect(res.status).toBe(400);
    });

    it('updates fixVersions on an existing task', async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, {
        name: 'Update FixVersion Project',
      });
      const release = await createRelease(manager.accessToken, project.id);
      const task = await createTask(app, manager.accessToken, {
        title: 'A task',
        project: project.id,
        priority: TaskPriority.P2,
      });
      expect(task.fixVersions).toEqual([]);

      const res = await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}`)
        .set(...authHeader(manager.accessToken))
        .send({ fixVersions: [release.id] });
      expect(res.status).toBe(200);
      expect(res.body.data.fixVersions).toHaveLength(1);
    });

    it('detaches a deleted release from every task that referenced it', async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, { name: 'Detach Project' });
      const release = await createRelease(manager.accessToken, project.id);
      const task = await createTask(app, manager.accessToken, {
        title: 'Tagged task',
        project: project.id,
        priority: TaskPriority.P2,
        fixVersions: [release.id],
        affectsVersions: [release.id],
      });

      await api(app)
        .delete(`/${API_PREFIX}/projects/${project.id}/releases/${release.id}`)
        .set(...authHeader(manager.accessToken));

      const refetched = await api(app)
        .get(`/${API_PREFIX}/tasks/${task.id}`)
        .set(...authHeader(manager.accessToken));
      expect(refetched.body.data.fixVersions).toEqual([]);
      expect(refetched.body.data.affectsVersions).toEqual([]);
    });
  });

  describe('progress and release notes', () => {
    it('computes progress from tasks tagged with the release', async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, { name: 'Progress Project' });
      const release = await createRelease(manager.accessToken, project.id);
      const taskA = await createTask(app, manager.accessToken, {
        title: 'Task A',
        project: project.id,
        priority: TaskPriority.P2,
        fixVersions: [release.id],
      });
      await createTask(app, manager.accessToken, {
        title: 'Task B',
        project: project.id,
        priority: TaskPriority.P2,
        fixVersions: [release.id],
      });

      await api(app)
        .patch(`/${API_PREFIX}/tasks/${taskA.id}/status`)
        .set(...authHeader(manager.accessToken))
        .send({ status: 'In Progress' });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${taskA.id}/status`)
        .set(...authHeader(manager.accessToken))
        .send({ status: 'Review' });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${taskA.id}/status`)
        .set(...authHeader(manager.accessToken))
        .send({ status: 'Done' });

      const res = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/releases/${release.id}/progress`)
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        releaseId: release.id,
        totalIssues: 2,
        doneIssues: 1,
        progress: 50,
      });
    });

    it('generates release notes grouped by issue type, from completed issues only', async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, { name: 'Notes Project' });
      const release = await createRelease(manager.accessToken, project.id, { name: 'v3.0.0' });
      const doneTask = await createTask(app, manager.accessToken, {
        title: 'Fix the login bug',
        project: project.id,
        priority: TaskPriority.P1,
        fixVersions: [release.id],
      });
      await createTask(app, manager.accessToken, {
        title: 'Still in progress task',
        project: project.id,
        priority: TaskPriority.P2,
        fixVersions: [release.id],
      });

      await api(app)
        .patch(`/${API_PREFIX}/tasks/${doneTask.id}/status`)
        .set(...authHeader(manager.accessToken))
        .send({ status: 'In Progress' });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${doneTask.id}/status`)
        .set(...authHeader(manager.accessToken))
        .send({ status: 'Review' });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${doneTask.id}/status`)
        .set(...authHeader(manager.accessToken))
        .send({ status: 'Done' });

      const res = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/releases/${release.id}/release-notes`)
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data.issueCount).toBe(1);
      expect(res.body.data.markdown).toContain('v3.0.0');
      expect(res.body.data.markdown).toContain('Fix the login bug');
      expect(res.body.data.markdown).not.toContain('Still in progress task');
    });
  });
});
