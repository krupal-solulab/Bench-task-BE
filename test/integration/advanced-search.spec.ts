import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { CustomFieldType } from 'src/modules/projects/schemas/custom-field.schema';
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

describe('advanced search (integration)', () => {
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
      email: 'search-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    return { org, manager };
  }

  it('a plain project/task list is unaffected by this phase (regression)', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Untouched Project' });
    await createTask(app, manager.accessToken, {
      title: 'A plain task',
      project: project.id,
      priority: TaskPriority.P2,
    });

    const res = await api(app)
      .get(`/${API_PREFIX}/tasks`)
      .set(...authHeader(manager.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('filters tasks by a Text custom field value', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'CF Search Project' });
    const put = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/custom-fields`)
      .set(...authHeader(manager.accessToken))
      .send({ fields: [{ name: 'Root Cause', type: CustomFieldType.TEXT, required: false }] });
    const field = put.body.data.customFields[0];

    await createTask(app, manager.accessToken, {
      title: 'Disk full task',
      project: project.id,
      priority: TaskPriority.P2,
      customFieldValues: { [field.id]: 'disk full' },
    });
    await createTask(app, manager.accessToken, {
      title: 'Other task',
      project: project.id,
      priority: TaskPriority.P2,
      customFieldValues: { [field.id]: 'network timeout' },
    });

    const res = await api(app)
      .get(`/${API_PREFIX}/tasks`)
      .query({ customFieldFilters: JSON.stringify([{ fieldId: field.id, value: 'disk full' }]) })
      .set(...authHeader(manager.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Disk full task');
  });

  it('filters tasks by a Dropdown custom field value', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Dropdown Project' });
    const put = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/custom-fields`)
      .set(...authHeader(manager.accessToken))
      .send({
        fields: [
          {
            name: 'Severity',
            type: CustomFieldType.DROPDOWN,
            required: false,
            options: ['Low', 'High'],
          },
        ],
      });
    const field = put.body.data.customFields[0];

    await createTask(app, manager.accessToken, {
      title: 'High severity task',
      project: project.id,
      priority: TaskPriority.P2,
      customFieldValues: { [field.id]: 'High' },
    });
    await createTask(app, manager.accessToken, {
      title: 'Low severity task',
      project: project.id,
      priority: TaskPriority.P2,
      customFieldValues: { [field.id]: 'Low' },
    });

    const res = await api(app)
      .get(`/${API_PREFIX}/tasks`)
      .query({ customFieldFilters: JSON.stringify([{ fieldId: field.id, value: 'High' }]) })
      .set(...authHeader(manager.accessToken));
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('High severity task');
  });

  it('malformed customFieldFilters JSON is silently ignored, not a 400/500', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Malformed Project' });
    await createTask(app, manager.accessToken, {
      title: 'Task',
      project: project.id,
      priority: TaskPriority.P2,
    });

    const res = await api(app)
      .get(`/${API_PREFIX}/tasks`)
      .query({ customFieldFilters: '{not valid json' })
      .set(...authHeader(manager.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('free-text search matches the issue key', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Key Search Project' });
    const task = await createTask(app, manager.accessToken, {
      title: 'Totally unrelated title',
      project: project.id,
      priority: TaskPriority.P2,
    });
    expect(task.issueKey).toEqual(expect.any(String));

    const res = await api(app)
      .get(`/${API_PREFIX}/tasks`)
      .query({ search: task.issueKey })
      .set(...authHeader(manager.accessToken));
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(task.id);
  });

  describe('GET /tasks/search (JQL-lite, Search/Dashboards v2)', () => {
    it('a multi-clause AND/OR query with ORDER BY returns the correct, correctly-ordered set', async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, { name: 'JQL Project' });

      const bugP1 = await createTask(app, manager.accessToken, {
        title: 'Bug P1',
        project: project.id,
        priority: TaskPriority.P1,
        issueType: 'Bug',
      });
      const bugP3 = await createTask(app, manager.accessToken, {
        title: 'Bug P3',
        project: project.id,
        priority: TaskPriority.P3,
        issueType: 'Bug',
      });
      await createTask(app, manager.accessToken, {
        title: 'Story P1',
        project: project.id,
        priority: TaskPriority.P1,
        issueType: 'Story',
      });

      const res = await api(app)
        .get(`/${API_PREFIX}/tasks/search`)
        .query({
          jql: `project = "${project.id}" AND issueType = Bug ORDER BY priority ASC`,
        })
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data.map((t: { id: string }) => t.id)).toEqual([bugP1.id, bugP3.id]);
    });

    it('resolves currentUser() to the caller and only matches their own tasks', async () => {
      const { org, manager } = await seedManager();
      const dev = await seedUserAndLogin(app, {
        email: 'jql-dev@example.com',
        password: 'Password123',
        role: Role.DEVELOPER,
        organizationId: org.id,
      });
      const project = await createProject(app, manager.accessToken, {
        name: 'CurrentUser Project',
      });
      await api(app)
        .post(`/${API_PREFIX}/projects/${project.id}/members`)
        .set(...authHeader(manager.accessToken))
        .send({ userIds: [dev.userDoc.id] });

      const mine = await createTask(app, manager.accessToken, {
        title: 'Assigned to dev',
        project: project.id,
        priority: TaskPriority.P2,
        assignee: dev.userDoc.id,
      });
      await createTask(app, manager.accessToken, {
        title: 'Unassigned',
        project: project.id,
        priority: TaskPriority.P2,
      });

      const res = await api(app)
        .get(`/${API_PREFIX}/tasks/search`)
        .query({ jql: 'assignee = currentUser()' })
        .set(...authHeader(dev.accessToken));
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(mine.id);
    });

    it('rejects a syntactically invalid query with 400', async () => {
      const { manager } = await seedManager();

      const res = await api(app)
        .get(`/${API_PREFIX}/tasks/search`)
        .query({ jql: 'not a valid query (((' })
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(400);
    });

    it('rejects an unknown field with 400', async () => {
      const { manager } = await seedManager();

      const res = await api(app)
        .get(`/${API_PREFIX}/tasks/search`)
        .query({ jql: 'bogus = 1' })
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(400);
    });

    it("never returns a task from a project outside the caller's accessible scope", async () => {
      const { org, manager } = await seedManager();
      const other = await seedUserAndLogin(app, {
        email: 'jql-outsider@example.com',
        password: 'Password123',
        role: Role.MANAGER,
        organizationId: org.id,
      });
      const project = await createProject(app, manager.accessToken, { name: 'Private Project' });
      await createTask(app, manager.accessToken, {
        title: 'Private task',
        project: project.id,
        priority: TaskPriority.P2,
      });

      const res = await api(app)
        .get(`/${API_PREFIX}/tasks/search`)
        .query({ jql: `project = "${project.id}"` })
        .set(...authHeader(other.accessToken));
      expect(res.body.data).toHaveLength(0);
    });
  });
});
