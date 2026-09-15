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
});
