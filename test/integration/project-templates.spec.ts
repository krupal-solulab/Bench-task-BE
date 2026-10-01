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
import { api, createProject, createTask } from './setup/fixtures';

/** Module 8 gap-closure: project templates (`isTemplate` + `POST projects { templateProjectId }`). */
describe('project templates (integration)', () => {
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

  async function seedOrg(prefix = 'tpl') {
    const org = await seedOrganization(app, { name: `${prefix} org`, slug: `${prefix}-org` });
    const admin = await seedUserAndLogin(app, {
      email: `${prefix}-admin@example.com`,
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    return { org, admin };
  }

  async function seedConfiguredTemplate(token: string, memberIds: string[] = []) {
    const template = await createProject(app, token, {
      name: 'Delivery template',
      key: 'TPL',
      boardType: 'Kanban',
      isTemplate: true,
      memberIds,
    });
    const put = (path: string, body: Record<string, unknown>) =>
      api(app)
        .put(`/${API_PREFIX}/projects/${template.id}/${path}`)
        .set(...authHeader(token))
        .send(body);
    expect((await put('components', { names: ['API', 'Web'] })).status).toBe(200);
    expect(
      (
        await put('custom-fields', {
          fields: [{ name: 'Customer', type: 'Text', required: false }],
        })
      ).status,
    ).toBe(200);
    expect(
      (await put('sla-policy', { entries: [{ priority: 'P1', resolutionHours: 2 }] })).status,
    ).toBe(200);
    await createTask(app, token, { title: 'Template task', project: template.id, priority: 'P2' });
    const refreshed = await api(app)
      .get(`/${API_PREFIX}/projects/${template.id}`)
      .set(...authHeader(token));
    return refreshed.body.data;
  }

  it("copies a template's configuration, but never its tasks, members or issue key", async () => {
    const { org, admin } = await seedOrg();
    const dev = await seedUser(app, {
      email: 'tpl-dev@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const template = await seedConfiguredTemplate(admin.accessToken, [dev.id]);

    const created = await createProject(app, admin.accessToken, {
      name: 'From template',
      templateProjectId: template.id,
    });

    expect(created).toMatchObject({
      boardType: 'Kanban',
      components: ['API', 'Web'],
      isTemplate: false,
      key: null,
      taskCount: 0,
    });
    expect(created.customFields).toEqual([
      expect.objectContaining({ id: template.customFields[0].id, name: 'Customer' }),
    ]);
    expect(created.members).toHaveLength(1); // only the owner row - template members aren't copied

    const sla = await api(app)
      .get(`/${API_PREFIX}/projects/${created.id}/sla-policy`)
      .set(...authHeader(admin.accessToken));
    expect(sla.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ priority: 'P1', resolutionHours: 2 })]),
    );

    // The template itself is untouched.
    const source = await api(app)
      .get(`/${API_PREFIX}/projects/${template.id}`)
      .set(...authHeader(admin.accessToken));
    expect(source.body.data).toMatchObject({ key: 'TPL', isTemplate: true, taskCount: 1 });
  });

  it('lets explicit create fields override the template (board type)', async () => {
    const { admin } = await seedOrg('ovr');
    const template = await seedConfiguredTemplate(admin.accessToken);
    const created = await createProject(app, admin.accessToken, {
      name: 'Scrum override',
      templateProjectId: template.id,
      boardType: 'Scrum',
    });
    expect(created.boardType).toBe('Scrum');
    expect(created.components).toEqual(['API', 'Web']);
  });

  it('filters the project list to templates only', async () => {
    const { admin } = await seedOrg('lst');
    await seedConfiguredTemplate(admin.accessToken);
    await createProject(app, admin.accessToken, { name: 'Ordinary project' });

    const res = await api(app)
      .get(`/${API_PREFIX}/projects`)
      .query({ isTemplate: 'true' })
      .set(...authHeader(admin.accessToken));
    expect(res.body.data.map((p: { name: string }) => p.name)).toEqual(['Delivery template']);
  });

  it("rejects another org's project as a template (400) and a template the caller can't view (403)", async () => {
    const a = await seedOrg('tpla');
    const b = await seedOrg('tplb');
    const foreign = await seedConfiguredTemplate(b.admin.accessToken);

    const crossOrg = await api(app)
      .post(`/${API_PREFIX}/projects`)
      .set(...authHeader(a.admin.accessToken))
      .send({ name: 'Cross-org attempt', templateProjectId: foreign.id });
    expect(crossOrg.status).toBe(400);

    const privateTemplate = await seedConfiguredTemplate(a.admin.accessToken);
    const manager = await seedUserAndLogin(app, {
      email: 'tpla-mgr@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: a.org.id,
    });
    const notVisible = await api(app)
      .post(`/${API_PREFIX}/projects`)
      .set(...authHeader(manager.accessToken))
      .send({ name: 'Manager attempt', templateProjectId: privateTemplate.id });
    expect(notVisible.status).toBe(403);
  });
});
