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

describe('custom fields, labels & components (integration)', () => {
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
      email: 'fields-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    return { org, manager };
  }

  it('a project with no components/custom fields behaves identically to today (regression)', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Untouched Project' });
    expect(project.components).toEqual([]);
    expect(project.customFields).toEqual([]);

    const task = await createTask(app, manager.accessToken, {
      title: 'A plain task',
      project: project.id,
      priority: TaskPriority.P2,
    });
    expect(task.labels).toEqual([]);
    expect(task.components).toEqual([]);
    expect(task.customFieldValues).toEqual({});
  });

  it('sets components, tags a task with them, and rejects an unknown component', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Components Project' });

    const put = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/components`)
      .set(...authHeader(manager.accessToken))
      .send({ names: ['Frontend', 'API'] });
    expect(put.status).toBe(200);
    expect(put.body.data.components).toEqual(['Frontend', 'API']);

    const task = await createTask(app, manager.accessToken, {
      title: 'Tagged task',
      project: project.id,
      priority: TaskPriority.P2,
      components: ['Frontend'],
    });
    expect(task.components).toEqual(['Frontend']);

    const rejected = await api(app)
      .post(`/${API_PREFIX}/tasks`)
      .set(...authHeader(manager.accessToken))
      .send({
        title: 'Unknown component task',
        project: project.id,
        priority: TaskPriority.P2,
        components: ['Backend'],
      });
    expect(rejected.status).toBe(400);
  });

  it('rejects removing a component still in use, then allows it once the task is untagged', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, {
      name: 'Orphan Component Project',
    });
    await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/components`)
      .set(...authHeader(manager.accessToken))
      .send({ names: ['Frontend'] });
    const task = await createTask(app, manager.accessToken, {
      title: 'Tagged task',
      project: project.id,
      priority: TaskPriority.P2,
      components: ['Frontend'],
    });

    const blocked = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/components`)
      .set(...authHeader(manager.accessToken))
      .send({ names: [] });
    expect(blocked.status).toBe(409);

    await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(manager.accessToken))
      .send({ components: [] });

    const allowed = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/components`)
      .set(...authHeader(manager.accessToken))
      .send({ names: [] });
    expect(allowed.status).toBe(200);
  });

  it('filters tasks by label and by component', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Filter Project' });
    await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/components`)
      .set(...authHeader(manager.accessToken))
      .send({ names: ['Frontend', 'API'] });

    await createTask(app, manager.accessToken, {
      title: 'Frontend bug',
      project: project.id,
      priority: TaskPriority.P2,
      labels: ['bug'],
      components: ['Frontend'],
    });
    await createTask(app, manager.accessToken, {
      title: 'API task',
      project: project.id,
      priority: TaskPriority.P2,
      labels: ['chore'],
      components: ['API'],
    });

    const byLabel = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/tasks`)
      .query({ labels: 'bug' })
      .set(...authHeader(manager.accessToken));
    expect(byLabel.body.data).toHaveLength(1);
    expect(byLabel.body.data[0].title).toBe('Frontend bug');

    const byComponent = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/tasks`)
      .query({ components: 'API' })
      .set(...authHeader(manager.accessToken));
    expect(byComponent.body.data).toHaveLength(1);
    expect(byComponent.body.data[0].title).toBe('API task');
  });

  it('autocompletes labels from the distinct labels already in use', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Labels Project' });
    await createTask(app, manager.accessToken, {
      title: 'Task X',
      project: project.id,
      priority: TaskPriority.P2,
      labels: ['bug', 'urgent'],
    });
    await createTask(app, manager.accessToken, {
      title: 'Task Y',
      project: project.id,
      priority: TaskPriority.P2,
      labels: ['bug'],
    });

    const res = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/labels`)
      .set(...authHeader(manager.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.sort()).toEqual(['bug', 'urgent']);
  });

  it('creates custom fields of each type, enforces required, and rejects an unknown value', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, {
      name: 'Custom Fields Project',
    });

    const put = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/custom-fields`)
      .set(...authHeader(manager.accessToken))
      .send({
        fields: [
          { name: 'Root Cause', type: CustomFieldType.TEXT, required: true },
          {
            name: 'Severity',
            type: CustomFieldType.DROPDOWN,
            required: false,
            options: ['Low', 'High'],
          },
          { name: 'Needs QA', type: CustomFieldType.CHECKBOX, required: false },
        ],
      });
    expect(put.status).toBe(200);
    const [rootCause, severity] = put.body.data.customFields;

    const missingRequired = await api(app)
      .post(`/${API_PREFIX}/tasks`)
      .set(...authHeader(manager.accessToken))
      .send({ title: 'No root cause', project: project.id, priority: TaskPriority.P2 });
    expect(missingRequired.status).toBe(400);

    const badDropdown = await api(app)
      .post(`/${API_PREFIX}/tasks`)
      .set(...authHeader(manager.accessToken))
      .send({
        title: 'Bad dropdown',
        project: project.id,
        priority: TaskPriority.P2,
        customFieldValues: { [rootCause.id]: 'disk full', [severity.id]: 'Critical' },
      });
    expect(badDropdown.status).toBe(400);

    const task = await createTask(app, manager.accessToken, {
      title: 'Valid task',
      project: project.id,
      priority: TaskPriority.P2,
      customFieldValues: { [rootCause.id]: 'disk full', [severity.id]: 'High' },
    });
    expect(task.customFieldValues).toEqual({ [rootCause.id]: 'disk full', [severity.id]: 'High' });
  });

  it("rejects changing a custom field's type, and rejects removing one still holding a value", async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Field Guard Project' });
    const put = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/custom-fields`)
      .set(...authHeader(manager.accessToken))
      .send({ fields: [{ name: 'Cost', type: CustomFieldType.NUMBER, required: false }] });
    const field = put.body.data.customFields[0];

    const changeType = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/custom-fields`)
      .set(...authHeader(manager.accessToken))
      .send({
        fields: [{ id: field.id, name: 'Cost', type: CustomFieldType.TEXT, required: false }],
      });
    expect(changeType.status).toBe(400);

    await createTask(app, manager.accessToken, {
      title: 'Task with a cost',
      project: project.id,
      priority: TaskPriority.P2,
      customFieldValues: { [field.id]: 42 },
    });

    const removeInUse = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/custom-fields`)
      .set(...authHeader(manager.accessToken))
      .send({ fields: [] });
    expect(removeInUse.status).toBe(409);
  });

  it('merges (not replaces) customFieldValues on update', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Merge Project' });
    const put = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/custom-fields`)
      .set(...authHeader(manager.accessToken))
      .send({
        fields: [
          { name: 'A', type: CustomFieldType.TEXT, required: false },
          { name: 'B', type: CustomFieldType.TEXT, required: false },
        ],
      });
    const [fieldA, fieldB] = put.body.data.customFields;

    const task = await createTask(app, manager.accessToken, {
      title: 'Task',
      project: project.id,
      priority: TaskPriority.P2,
      customFieldValues: { [fieldA.id]: 'a1', [fieldB.id]: 'b1' },
    });

    const updated = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(manager.accessToken))
      .send({ customFieldValues: { [fieldA.id]: 'a2' } });
    expect(updated.status).toBe(200);
    expect(updated.body.data.customFieldValues).toEqual({ [fieldA.id]: 'a2', [fieldB.id]: 'b1' });
  });
});
