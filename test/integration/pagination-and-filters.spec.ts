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

describe('pagination and filters (integration)', () => {
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
    return seedUserAndLogin(app, {
      email: 'pag-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
    });
  }

  it('paginates a task list correctly across multiple pages', async () => {
    const manager = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Pagination Project' });

    for (let i = 1; i <= 25; i++) {
      await createTask(app, manager.accessToken, {
        title: `Task number ${String(i).padStart(2, '0')}`,
        project: project.id,
        priority: TaskPriority.P2,
      });
    }

    const page1 = await api(app)
      .get(`/${API_PREFIX}/tasks`)
      .query({ project: project.id, page: 1, limit: 10, sortBy: 'createdAt', sortOrder: 'asc' })
      .set(...authHeader(manager.accessToken));
    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(10);
    expect(page1.body.meta).toMatchObject({
      total: 25,
      page: 1,
      limit: 10,
      totalPages: 3,
      hasNextPage: true,
      hasPrevPage: false,
    });

    const page2 = await api(app)
      .get(`/${API_PREFIX}/tasks`)
      .query({ project: project.id, page: 2, limit: 10, sortBy: 'createdAt', sortOrder: 'asc' })
      .set(...authHeader(manager.accessToken));
    expect(page2.body.meta).toMatchObject({ page: 2, hasNextPage: true, hasPrevPage: true });
    expect(page2.body.data).toHaveLength(10);

    const page3 = await api(app)
      .get(`/${API_PREFIX}/tasks`)
      .query({ project: project.id, page: 3, limit: 10, sortBy: 'createdAt', sortOrder: 'asc' })
      .set(...authHeader(manager.accessToken));
    expect(page3.body.meta).toMatchObject({
      page: 3,
      hasNextPage: false,
      hasPrevPage: true,
      total: 25,
    });
    expect(page3.body.data).toHaveLength(5);

    // No overlap/duplication across pages.
    const allIds = new Set([
      ...page1.body.data.map((t: { id: string }) => t.id),
      ...page2.body.data.map((t: { id: string }) => t.id),
      ...page3.body.data.map((t: { id: string }) => t.id),
    ]);
    expect(allIds.size).toBe(25);
  });

  it('filters tasks by status and priority', async () => {
    const manager = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Filter Project' });

    const p1Task = await createTask(app, manager.accessToken, {
      title: 'High priority task',
      project: project.id,
      priority: TaskPriority.P1,
    });
    await createTask(app, manager.accessToken, {
      title: 'Low priority task',
      project: project.id,
      priority: TaskPriority.P3,
    });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${p1Task.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TaskStatus.IN_PROGRESS });

    const byPriority = await api(app)
      .get(`/${API_PREFIX}/tasks`)
      .query({ project: project.id, priority: TaskPriority.P1 })
      .set(...authHeader(manager.accessToken));
    expect(byPriority.body.data).toHaveLength(1);
    expect(byPriority.body.data[0].id).toBe(p1Task.id);

    const byStatus = await api(app)
      .get(`/${API_PREFIX}/tasks`)
      .query({ project: project.id, status: TaskStatus.IN_PROGRESS })
      .set(...authHeader(manager.accessToken));
    expect(byStatus.body.data).toHaveLength(1);
    expect(byStatus.body.data[0].id).toBe(p1Task.id);

    const bySearch = await api(app)
      .get(`/${API_PREFIX}/tasks`)
      .query({ project: project.id, search: 'Low priority' })
      .set(...authHeader(manager.accessToken));
    expect(bySearch.body.data).toHaveLength(1);
    expect(bySearch.body.data[0].title).toBe('Low priority task');
  });

  it('GET /tasks/overdue returns only tasks with a past due date that are not Done', async () => {
    const manager = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Overdue Project' });

    const past = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();

    const overdueTask = await createTask(app, manager.accessToken, {
      title: 'Overdue task',
      project: project.id,
      priority: TaskPriority.P2,
      dueDate: past,
    });
    await createTask(app, manager.accessToken, {
      title: 'Future task',
      project: project.id,
      priority: TaskPriority.P2,
      dueDate: future,
    });
    const overdueButDone = await createTask(app, manager.accessToken, {
      title: 'Overdue but done',
      project: project.id,
      priority: TaskPriority.P2,
      dueDate: past,
    });
    // Walk it to Done through the legal transition path.
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${overdueButDone.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TaskStatus.IN_PROGRESS });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${overdueButDone.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TaskStatus.REVIEW });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${overdueButDone.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TaskStatus.DONE });

    const res = await api(app)
      .get(`/${API_PREFIX}/tasks/overdue`)
      .query({ project: project.id })
      .set(...authHeader(manager.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(overdueTask.id);
  });
});
