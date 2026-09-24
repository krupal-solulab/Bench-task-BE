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

describe('CSV import/export & project backup (Module 5 - Bulk Operations & Import/Export)', () => {
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

  async function seedFixtures() {
    const org = await seedOrganization(app);
    const manager = await seedUserAndLogin(app, {
      email: 'ie-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: 'ie-developer@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, {
      name: 'Import Export Project',
      memberIds: [developer.userDoc.id],
    });
    return { org, manager, developer, project };
  }

  describe('GET projects/:id/tasks/export', () => {
    it('exports every active task as CSV, with header row and correct values', async () => {
      const { manager, project } = await seedFixtures();
      await createTask(app, manager.accessToken, {
        title: 'Fix, the login bug',
        project: project.id,
        priority: TaskPriority.P1,
        labels: ['urgent', 'auth'],
      });

      const res = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/tasks/export`)
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data.filename).toMatch(/\.csv$/);

      const lines = (res.body.data.csv as string).split('\r\n');
      expect(lines[0]?.split(',')).toEqual([
        'issueKey',
        'title',
        'description',
        'issueType',
        'status',
        'priority',
        'assignee',
        'storyPoints',
        'labels',
        'components',
        'dueDate',
        'createdAt',
      ]);
      expect(lines[1]).toContain('"Fix, the login bug"');
      expect(lines[1]).toContain('urgent;auth');
    });

    it('rejects export from a user with no view access to the project', async () => {
      const { project } = await seedFixtures();
      const org2 = await seedOrganization(app);
      const outsider = await seedUserAndLogin(app, {
        email: 'ie-outsider@example.com',
        password: 'Password123',
        role: Role.MANAGER,
        organizationId: org2.id,
      });

      const res = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/tasks/export`)
        .set(...authHeader(outsider.accessToken));
      expect(res.status).toBe(403);
    });
  });

  describe('POST projects/:id/tasks/import', () => {
    it('creates a task per valid row, reporting success with the assigned issue key', async () => {
      const { manager, project } = await seedFixtures();
      const csv =
        'title,priority,description\nImported task one,P1,First\nImported task two,P2,Second';

      const res = await api(app)
        .post(`/${API_PREFIX}/projects/${project.id}/tasks/import`)
        .set(...authHeader(manager.accessToken))
        .send({ csv });
      expect(res.status).toBe(201);
      expect(res.body.data.succeeded).toHaveLength(2);
      expect(res.body.data.failed).toEqual([]);
      expect(res.body.data.succeeded[0].issueKey).toEqual(expect.any(String));

      const list = await api(app)
        .get(`/${API_PREFIX}/tasks?project=${project.id}`)
        .set(...authHeader(manager.accessToken));
      expect(list.body.meta.total).toBe(2);
    });

    it('defaults a missing/unrecognized priority to P2 rather than rejecting the row', async () => {
      const { manager, project } = await seedFixtures();
      const csv = 'title,priority\nNo priority given,\nBogus priority,not-a-priority';

      const res = await api(app)
        .post(`/${API_PREFIX}/projects/${project.id}/tasks/import`)
        .set(...authHeader(manager.accessToken))
        .send({ csv });
      expect(res.status).toBe(201);
      expect(res.body.data.succeeded).toHaveLength(2);
    });

    it('reports a per-row failure for a missing title without failing the whole import', async () => {
      const { manager, project } = await seedFixtures();
      const csv = 'title,priority\nGood row,P1\n,P1';

      const res = await api(app)
        .post(`/${API_PREFIX}/projects/${project.id}/tasks/import`)
        .set(...authHeader(manager.accessToken))
        .send({ csv });
      expect(res.status).toBe(201);
      expect(res.body.data.succeeded).toHaveLength(1);
      expect(res.body.data.failed).toHaveLength(1);
      expect(res.body.data.failed[0].row).toBe(3);
    });

    it('rejects a CSV missing the required title column', async () => {
      const { manager, project } = await seedFixtures();
      const csv = 'description,priority\nno title column,P1';

      const res = await api(app)
        .post(`/${API_PREFIX}/projects/${project.id}/tasks/import`)
        .set(...authHeader(manager.accessToken))
        .send({ csv });
      expect(res.status).toBe(400);
    });
  });

  describe('GET projects/:id/backup', () => {
    it('returns the project configuration and its tasks for a Manager', async () => {
      const { manager, project } = await seedFixtures();
      await createTask(app, manager.accessToken, {
        title: 'Backed up task',
        project: project.id,
        priority: TaskPriority.P2,
      });

      const res = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/backup`)
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data.filename).toMatch(/\.json$/);
      expect(res.body.data.backup.project.name).toBe('Import Export Project');
      expect(res.body.data.backup.tasks).toHaveLength(1);
      expect(res.body.data.backup.tasks[0].title).toBe('Backed up task');
    });

    it('rejects a backup request from a Developer (Admin/Manager-only)', async () => {
      const { developer, project } = await seedFixtures();

      const res = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/backup`)
        .set(...authHeader(developer.accessToken));
      expect(res.status).toBe(403);
    });
  });
});
