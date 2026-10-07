import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { StatusCategory } from 'src/common/enums/status-category.enum';
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

/** Post-BRD clean-up: the six small limitations left after the 12 gap-closure modules. */
describe('post-BRD clean-up (integration)', () => {
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

  async function seed() {
    const org = await seedOrganization(app, { name: 'g2 org', slug: 'g2-org' });
    const admin = await seedUserAndLogin(app, {
      email: 'g2-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const manager = await seedUserAndLogin(app, {
      email: 'g2-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: 'g2-dev@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, {
      name: 'G2 Project',
      memberIds: [developer.userDoc.id],
    });
    // Lets the developer edit any task in the project (field permissions then narrow it).
    await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/members/${developer.userDoc.id}/permissions`)
      .set(...authHeader(manager.accessToken))
      .send({ canEditAnyTask: true, canChangeAnyTaskStatus: true });
    return { org, admin, manager, developer, project };
  }

  async function assignFieldScheme(
    adminToken: string,
    projectId: string,
    rules: Array<{ fieldId: string; hiddenFromRoles: Role[]; readOnlyForRoles: Role[] }>,
  ) {
    const scheme = await api(app)
      .post(`/${API_PREFIX}/field-permission-schemes`)
      .set(...authHeader(adminToken))
      .send({ name: 'G2 rules', rules });
    expect(scheme.status).toBe(201);
    const assigned = await api(app)
      .patch(`/${API_PREFIX}/projects/${projectId}/field-permission-scheme`)
      .set(...authHeader(adminToken))
      .send({ fieldPermissionSchemeId: scheme.body.data.id });
    expect(assigned.status).toBe(200);
  }

  const patchTask = (token: string, taskId: string, body: Record<string, unknown>) =>
    api(app)
      .patch(`/${API_PREFIX}/tasks/${taskId}`)
      .set(...authHeader(token))
      .send(body);

  it('bulk status preview reports every real blocker, matching the real change', async () => {
    const { manager, developer, project } = await seed();
    await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/workflow`)
      .set(...authHeader(manager.accessToken))
      .send({
        statuses: [
          { name: 'Todo', category: StatusCategory.TODO },
          { name: 'Done', category: StatusCategory.DONE },
        ],
        transitions: [{ from: 'Todo', to: 'Done', requireComment: true }],
        initialStatus: 'Todo',
      });
    const task = await createTask(app, manager.accessToken, {
      title: 'Needs a comment first',
      project: project.id,
      priority: TaskPriority.P2,
      assignee: developer.userDoc.id,
    });

    const preview = await api(app)
      .post(`/${API_PREFIX}/tasks/bulk-status/preview`)
      .set(...authHeader(developer.accessToken))
      .send({ taskIds: [task.id], status: 'Done' });
    expect(preview.body.data.entries[0]).toMatchObject({
      willSucceed: false,
      reason: 'This transition requires a comment on the task first',
    });
    const real = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(developer.accessToken))
      .send({ status: 'Done' });
    expect(real.status).toBe(400);
    expect(real.body.message).toBe(preview.body.data.entries[0].reason);

    // Once the comment exists, the preview flips to success.
    await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/comments`)
      .set(...authHeader(developer.accessToken))
      .send({ body: 'Resolved in PR #12' });
    const after = await api(app)
      .post(`/${API_PREFIX}/tasks/bulk-status/preview`)
      .set(...authHeader(developer.accessToken))
      .send({ taskIds: [task.id], status: 'Done' });
    expect(after.body.data.entries[0]).toMatchObject({ willSucceed: true, reason: null });
  });

  it('saves story points edited after creation (and records the change)', async () => {
    const { manager, project } = await seed();
    const task = await createTask(app, manager.accessToken, {
      title: 'Estimate me',
      project: project.id,
      priority: TaskPriority.P2,
      storyPoints: 3,
    });
    const updated = await patchTask(manager.accessToken, task.id, { storyPoints: 8 });
    expect(updated.body.data.storyPoints).toBe(8);
    const cleared = await patchTask(manager.accessToken, task.id, { storyPoints: null });
    expect(cleared.body.data.storyPoints).toBeNull();

    const activity = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}/activity`)
      .set(...authHeader(manager.accessToken));
    expect(activity.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'storyPoints', from: '3', to: '8' }),
      ]),
    );
  });

  it('release comparison lists issues later moved out of a release', async () => {
    const { manager, project } = await seed();
    const createRelease = async (name: string) =>
      (
        await api(app)
          .post(`/${API_PREFIX}/projects/${project.id}/releases`)
          .set(...authHeader(manager.accessToken))
          .send({ name })
      ).body.data;
    const v1 = await createRelease('v1.0');
    const v2 = await createRelease('v2.0');
    const task = await createTask(app, manager.accessToken, {
      title: 'Slipped feature',
      project: project.id,
      priority: TaskPriority.P2,
    });
    await patchTask(manager.accessToken, task.id, { fixVersions: [v1.id] });
    await patchTask(manager.accessToken, task.id, { fixVersions: [v2.id] });

    const compare = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/releases/compare`)
      .query({ a: v1.id, b: v2.id })
      .set(...authHeader(manager.accessToken));
    expect(compare.status).toBe(200);
    expect(compare.body.data.onlyInB.map((t: { id: string }) => t.id)).toEqual([task.id]);
    expect(compare.body.data.movedOutOfA).toEqual([
      expect.objectContaining({ id: task.id, title: 'Slipped feature' }),
    ]);
    expect(compare.body.data.movedOutOfB).toEqual([]);

    // Moving it back into v1 takes it off the "moved out" list.
    await patchTask(manager.accessToken, task.id, { fixVersions: [v1.id, v2.id] });
    const again = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/releases/compare`)
      .query({ a: v1.id, b: v2.id })
      .set(...authHeader(manager.accessToken));
    expect(again.body.data.movedOutOfA).toEqual([]);
  });

  it('a read-only field no longer blocks saving other fields; changing it is still refused', async () => {
    const { admin, manager, developer, project } = await seed();
    await assignFieldScheme(admin.accessToken, project.id, [
      { fieldId: 'priority', hiddenFromRoles: [], readOnlyForRoles: [Role.DEVELOPER] },
      { fieldId: 'labels', hiddenFromRoles: [], readOnlyForRoles: [Role.DEVELOPER] },
    ]);
    const task = await createTask(app, manager.accessToken, {
      title: 'Original title',
      project: project.id,
      priority: TaskPriority.P2,
      labels: ['b', 'a'],
    });

    // What the edit form sends: every field, read-only ones unchanged (labels reordered).
    const saved = await patchTask(developer.accessToken, task.id, {
      title: 'Edited by developer',
      priority: TaskPriority.P2,
      labels: ['a', 'b'],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data.title).toBe('Edited by developer');

    const blocked = await patchTask(developer.accessToken, task.id, { priority: TaskPriority.P1 });
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toContain('priority');
  });

  it('lets a Manager (not a Developer) read the project role list', async () => {
    const { admin, manager, developer } = await seed();
    await api(app)
      .post(`/${API_PREFIX}/project-roles`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Reviewers' });
    const asManager = await api(app)
      .get(`/${API_PREFIX}/project-roles`)
      .set(...authHeader(manager.accessToken));
    expect(asManager.status).toBe(200);
    expect(asManager.body.data.map((r: { name: string }) => r.name)).toEqual(['Reviewers']);
    const asDeveloper = await api(app)
      .get(`/${API_PREFIX}/project-roles`)
      .set(...authHeader(developer.accessToken));
    expect(asDeveloper.status).toBe(403);
    // Creating stays Admin-only.
    const create = await api(app)
      .post(`/${API_PREFIX}/project-roles`)
      .set(...authHeader(manager.accessToken))
      .send({ name: 'Nope' });
    expect(create.status).toBe(403);
  });

  it('hides restricted fields in lists, search and exports - keeping their types', async () => {
    const { admin, manager, developer, project } = await seed();
    const task = await createTask(app, manager.accessToken, {
      title: 'Secret roadmap item',
      project: project.id,
      priority: TaskPriority.P1,
      labels: ['confidential'],
    });
    await assignFieldScheme(admin.accessToken, project.id, [
      { fieldId: 'priority', hiddenFromRoles: [Role.DEVELOPER], readOnlyForRoles: [] },
      { fieldId: 'labels', hiddenFromRoles: [Role.DEVELOPER], readOnlyForRoles: [] },
    ]);

    const list = await api(app)
      .get(`/${API_PREFIX}/tasks`)
      .query({ project: project.id })
      .set(...authHeader(developer.accessToken));
    const listed = list.body.data.find((t: { id: string }) => t.id === task.id);
    expect(listed).toMatchObject({
      title: 'Secret roadmap item',
      priority: null,
      labels: [],
      redactedFields: ['priority', 'labels'],
    });

    const search = await api(app)
      .get(`/${API_PREFIX}/tasks/search`)
      .query({ jql: `project = "${project.id}"` })
      .set(...authHeader(developer.accessToken));
    expect(search.body.data[0]).toMatchObject({ priority: null, labels: [] });

    const single = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(developer.accessToken));
    // Arrays stay arrays (a hidden Labels field used to come back as null).
    expect(single.body.data).toMatchObject({ priority: null, labels: [] });

    const exported = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/tasks/export`)
      .set(...authHeader(developer.accessToken));
    expect(exported.body.data.csv).toContain('Secret roadmap item');
    expect(exported.body.data.csv).not.toContain('confidential');
    expect(exported.body.data.csv).not.toContain('P1');

    // The manager is not restricted and still sees everything, unchanged.
    const managerList = await api(app)
      .get(`/${API_PREFIX}/tasks`)
      .query({ project: project.id })
      .set(...authHeader(manager.accessToken));
    const managerSees = managerList.body.data.find((t: { id: string }) => t.id === task.id);
    expect(managerSees).toMatchObject({ priority: 'P1', labels: ['confidential'] });
    expect(managerSees.redactedFields).toBeUndefined();
  });

  it("the project page's own task list applies security levels and field redaction", async () => {
    const { admin, manager, developer, project } = await seed();
    const scheme = await api(app)
      .post(`/${API_PREFIX}/security-schemes`)
      .set(...authHeader(admin.accessToken))
      .send({
        name: 'Confidentiality',
        levels: [{ name: 'Confidential', allowedRoles: ['Manager'], allowedUserIds: [] }],
      });
    await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/security-scheme`)
      .set(...authHeader(admin.accessToken))
      .send({ securitySchemeId: scheme.body.data.id });
    await createTask(app, manager.accessToken, {
      title: 'Visible task',
      project: project.id,
      priority: TaskPriority.P1,
    });
    await createTask(app, manager.accessToken, {
      title: 'Secret task',
      project: project.id,
      priority: TaskPriority.P2,
      securityLevel: 'Confidential',
    });
    await assignFieldScheme(admin.accessToken, project.id, [
      { fieldId: 'priority', hiddenFromRoles: [Role.DEVELOPER], readOnlyForRoles: [] },
    ]);

    const devList = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/tasks`)
      .set(...authHeader(developer.accessToken));
    expect(devList.status).toBe(200);
    expect(devList.body.meta.total).toBe(1);
    expect(devList.body.data[0]).toMatchObject({ title: 'Visible task', priority: null });

    const managerList = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/tasks`)
      .set(...authHeader(manager.accessToken));
    expect(managerList.body.meta.total).toBe(2);
    expect(managerList.body.data.map((t: { title: string }) => t.title).sort()).toEqual([
      'Secret task',
      'Visible task',
    ]);
    // The project CSV export leaves the restricted issue out for the developer too.
    const devExport = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/tasks/export`)
      .set(...authHeader(developer.accessToken));
    expect(devExport.body.data.csv).toContain('Visible task');
    expect(devExport.body.data.csv).not.toContain('Secret task');
    const managerExport = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/tasks/export`)
      .set(...authHeader(manager.accessToken));
    expect(managerExport.body.data.csv).toContain('Secret task');

    // Same populated shape as before the route moved.
    expect(managerList.body.data[0].createdBy).toMatchObject({ email: 'g2-manager@example.com' });
  });
});
