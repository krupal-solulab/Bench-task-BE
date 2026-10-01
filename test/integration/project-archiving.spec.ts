import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import {
  API_PREFIX,
  createTestApp,
  closeTestApp,
  clearInMemoryMongo,
  seedOrganization,
  seedUser,
  seedUserAndLogin,
  authHeader,
} from './setup/test-app';
import { api, createProject, createSprint, createTask } from './setup/fixtures';

const ARCHIVED_MESSAGE = 'This project is archived and read-only - restore it to make changes';

/** Module 8 gap-closure: project archiving - hidden by default, fully readable, never writable. */
describe('project archiving (integration)', () => {
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

  async function seedArchivedProject() {
    const org = await seedOrganization(app, { name: 'arch org', slug: 'arch-org' });
    const admin = await seedUserAndLogin(app, {
      email: 'arch-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const project = await createProject(app, admin.accessToken, { name: 'To be archived' });
    const task = await createTask(app, admin.accessToken, {
      title: 'Existing task',
      project: project.id,
      priority: 'P2',
    });
    const sprint = await createSprint(app, admin.accessToken, project.id, {
      name: 'Sprint 1',
      startDate: new Date().toISOString(),
      durationWeeks: 2,
    });
    const comment = await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/comments`)
      .set(...authHeader(admin.accessToken))
      .send({ body: 'Before archiving' });

    const archived = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/archive`)
      .set(...authHeader(admin.accessToken));
    expect(archived.status).toBe(200);
    expect(archived.body.data.archivedAt).not.toBeNull();
    return { org, admin, project, task, sprint, commentId: comment.body.data.id as string };
  }

  it('hides an archived project from the default list but shows it with archived=true/all', async () => {
    const { admin, project } = await seedArchivedProject();
    await createProject(app, admin.accessToken, { name: 'Still active' });

    const list = (archived?: string) =>
      api(app)
        .get(`/${API_PREFIX}/projects`)
        .query(archived ? { archived } : {})
        .set(...authHeader(admin.accessToken));

    expect((await list()).body.data.map((p: { name: string }) => p.name)).toEqual(['Still active']);
    expect((await list('true')).body.data.map((p: { id: string }) => p.id)).toEqual([project.id]);
    expect((await list('all')).body.data).toHaveLength(2);
  });

  it('keeps an archived project and its tasks fully readable', async () => {
    const { admin, project, task } = await seedArchivedProject();
    const detail = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}`)
      .set(...authHeader(admin.accessToken));
    expect(detail.status).toBe(200);

    const tasks = await api(app)
      .get(`/${API_PREFIX}/tasks`)
      .query({ project: project.id })
      .set(...authHeader(admin.accessToken));
    expect(tasks.status).toBe(200);
    expect(tasks.body.data.map((t: { id: string }) => t.id)).toContain(task.id);

    const one = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(admin.accessToken));
    expect(one.status).toBe(200);
  });

  it('refuses every kind of write with 409 while archived', async () => {
    const { admin, project, task, sprint, commentId } = await seedArchivedProject();
    const auth = authHeader(admin.accessToken);
    const send = async (
      label: string,
      req: PromiseLike<{ status: number; body: { message?: string } }>,
    ) => {
      const res = await req;
      return { label, status: res.status, message: res.body.message };
    };
    const results = await Promise.all([
      send(
        'PATCH project',
        api(app)
          .patch(`/${API_PREFIX}/projects/${project.id}`)
          .set(...auth)
          .send({ name: 'Renamed' }),
      ),
      send(
        'PUT components',
        api(app)
          .put(`/${API_PREFIX}/projects/${project.id}/components`)
          .set(...auth)
          .send({ names: ['X'] }),
      ),
      send(
        'POST task',
        api(app)
          .post(`/${API_PREFIX}/tasks`)
          .set(...auth)
          .send({ title: 'New', project: project.id, priority: 'P2' }),
      ),
      send(
        'PATCH task',
        api(app)
          .patch(`/${API_PREFIX}/tasks/${task.id}`)
          .set(...auth)
          .send({ title: 'Edited' }),
      ),
      send(
        'POST watch',
        api(app)
          .post(`/${API_PREFIX}/tasks/${task.id}/watch`)
          .set(...auth),
      ),
      send(
        'POST comment',
        api(app)
          .post(`/${API_PREFIX}/tasks/${task.id}/comments`)
          .set(...auth)
          .send({ body: 'After archiving' }),
      ),
      send(
        'PATCH comment',
        api(app)
          .patch(`/${API_PREFIX}/comments/${commentId}`)
          .set(...auth)
          .send({ body: 'Edit' }),
      ),
      send(
        'POST worklog',
        api(app)
          .post(`/${API_PREFIX}/tasks/${task.id}/worklogs`)
          .set(...auth)
          .send({ hours: 1, workDate: new Date().toISOString() }),
      ),
      send(
        'PATCH sprint',
        api(app)
          .patch(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}`)
          .set(...auth)
          .send({ goal: 'New goal' }),
      ),
      send(
        'POST sprint',
        api(app)
          .post(`/${API_PREFIX}/projects/${project.id}/sprints`)
          .set(...auth)
          .send({ name: 'Sprint 2', startDate: new Date().toISOString(), durationWeeks: 2 }),
      ),
      send(
        'DELETE task',
        api(app)
          .delete(`/${API_PREFIX}/tasks/${task.id}`)
          .set(...auth),
      ),
    ]);
    for (const r of results) {
      expect(r).toEqual({ label: r.label, status: 409, message: ARCHIVED_MESSAGE });
    }
  });

  it('restores full write access on unarchive', async () => {
    const { admin, project, task } = await seedArchivedProject();
    const restored = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/unarchive`)
      .set(...authHeader(admin.accessToken));
    expect(restored.status).toBe(200);
    expect(restored.body.data.archivedAt).toBeNull();

    const edit = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(admin.accessToken))
      .send({ title: 'Edited after restore' });
    expect(edit.status).toBe(200);
  });

  it('only lets a project manager archive/restore (403 for a Developer member)', async () => {
    const org = await seedOrganization(app, { name: 'perm org', slug: 'perm-org' });
    const admin = await seedUserAndLogin(app, {
      email: 'perm-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const devUser = await seedUser(app, {
      email: 'perm-dev@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, admin.accessToken, {
      name: 'Guarded',
      memberIds: [devUser.id],
    });
    const dev = await seedUserAndLogin(app, {
      email: 'perm-dev2@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const res = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/archive`)
      .set(...authHeader(dev.accessToken));
    expect(res.status).toBe(403);
  });

  it('leaves archived projects out of the org-wide dashboard summary', async () => {
    const { admin } = await seedArchivedProject();
    await createProject(app, admin.accessToken, { name: 'Counted' });
    const summary = await api(app)
      .get(`/${API_PREFIX}/dashboard/summary`)
      .set(...authHeader(admin.accessToken));
    expect(summary.status).toBe(200);
    expect(summary.body.data.totalProjects).toBe(1);
    expect(summary.body.data.totalTasks).toBe(0);
  });
});
