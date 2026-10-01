import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
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

/** Module 8 gap-closure: the org-wide custom field library (cross-project field config). */
describe('custom field library (integration)', () => {
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

  async function seedOrg(prefix = 'lib') {
    const org = await seedOrganization(app, { name: `${prefix} org`, slug: `${prefix}-org` });
    const admin = await seedUserAndLogin(app, {
      email: `${prefix}-admin@example.com`,
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    return { org, admin };
  }

  function createEntry(token: string, body: Record<string, unknown>) {
    return api(app)
      .post(`/${API_PREFIX}/custom-field-library`)
      .set(...authHeader(token))
      .send(body);
  }

  function adopt(token: string, projectId: string, entryId: string, body = {}) {
    return api(app)
      .post(`/${API_PREFIX}/projects/${projectId}/custom-fields/library/${entryId}`)
      .set(...authHeader(token))
      .send(body);
  }

  it('shares one field id across projects, so values and filters line up org-wide', async () => {
    const { admin } = await seedOrg();
    const entry = (
      await createEntry(admin.accessToken, {
        name: 'Severity',
        type: 'Dropdown',
        options: ['Low', 'High'],
      })
    ).body.data;

    const a = await createProject(app, admin.accessToken, { name: 'Project A' });
    const b = await createProject(app, admin.accessToken, { name: 'Project B' });
    const adoptedA = await adopt(admin.accessToken, a.id, entry.id, { required: true });
    expect(adoptedA.status).toBe(201);
    expect(adoptedA.body.data.customFields).toEqual([
      {
        id: entry.id,
        name: 'Severity',
        type: 'Dropdown',
        required: true,
        options: ['Low', 'High'],
      },
    ]);
    await adopt(admin.accessToken, b.id, entry.id);

    await createTask(app, admin.accessToken, {
      title: 'A high one',
      project: a.id,
      priority: 'P2',
      customFieldValues: { [entry.id]: 'High' },
    });
    await createTask(app, admin.accessToken, {
      title: 'B high one',
      project: b.id,
      priority: 'P2',
      customFieldValues: { [entry.id]: 'High' },
    });

    const list = await api(app)
      .get(`/${API_PREFIX}/custom-field-library`)
      .set(...authHeader(admin.accessToken));
    expect(list.body.data[0]).toMatchObject({ name: 'Severity', projectCount: 2 });
  });

  it("pushes a rename and new options to every adopting project's copy", async () => {
    const { admin } = await seedOrg('ren');
    const entry = (
      await createEntry(admin.accessToken, { name: 'Tier', type: 'Dropdown', options: ['Gold'] })
    ).body.data;
    const project = await createProject(app, admin.accessToken, { name: 'Adopter' });
    await adopt(admin.accessToken, project.id, entry.id);

    const renamed = await api(app)
      .patch(`/${API_PREFIX}/custom-field-library/${entry.id}`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Customer tier', options: ['Gold', 'Silver'] });
    expect(renamed.status).toBe(200);

    const refreshed = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}`)
      .set(...authHeader(admin.accessToken));
    expect(refreshed.body.data.customFields[0]).toMatchObject({
      id: entry.id,
      name: 'Customer tier',
      options: ['Gold', 'Silver'],
    });
  });

  it('refuses a rename that would clash with another field in an adopting project (409)', async () => {
    const { admin } = await seedOrg('clash');
    const entry = (await createEntry(admin.accessToken, { name: 'Region', type: 'Text' })).body
      .data;
    const project = await createProject(app, admin.accessToken, { name: 'Clashing' });
    await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/custom-fields`)
      .set(...authHeader(admin.accessToken))
      .send({ fields: [{ name: 'Market', type: 'Text', required: false }] });
    await adopt(admin.accessToken, project.id, entry.id);

    const res = await api(app)
      .patch(`/${API_PREFIX}/custom-field-library/${entry.id}`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'market' });
    expect(res.status).toBe(409);
  });

  it('rejects adopting twice, a name clash, and another org’s field; blocks deleting while in use', async () => {
    const { admin } = await seedOrg('rules');
    const other = await seedOrg('rulesother');
    const entry = (await createEntry(admin.accessToken, { name: 'Customer', type: 'Text' })).body
      .data;
    const foreign = (await createEntry(other.admin.accessToken, { name: 'Theirs', type: 'Text' }))
      .body.data;
    const project = await createProject(app, admin.accessToken, { name: 'Rules project' });

    expect((await adopt(admin.accessToken, project.id, entry.id)).status).toBe(201);
    expect((await adopt(admin.accessToken, project.id, entry.id)).status).toBe(409);
    expect((await adopt(admin.accessToken, project.id, foreign.id)).status).toBe(404);

    const clashProject = await createProject(app, admin.accessToken, { name: 'Has Customer' });
    await api(app)
      .put(`/${API_PREFIX}/projects/${clashProject.id}/custom-fields`)
      .set(...authHeader(admin.accessToken))
      .send({ fields: [{ name: 'customer', type: 'Text', required: false }] });
    expect((await adopt(admin.accessToken, clashProject.id, entry.id)).status).toBe(409);

    const blocked = await api(app)
      .delete(`/${API_PREFIX}/custom-field-library/${entry.id}`)
      .set(...authHeader(admin.accessToken));
    expect(blocked.status).toBe(409);
  });

  it('lets Managers read the library but not edit it; type and options rules are enforced', async () => {
    const { org, admin } = await seedOrg('perm');
    const manager = await seedUserAndLogin(app, {
      email: 'perm-mgr@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    expect((await createEntry(manager.accessToken, { name: 'X', type: 'Text' })).status).toBe(403);
    expect(
      (
        await api(app)
          .get(`/${API_PREFIX}/custom-field-library`)
          .set(...authHeader(manager.accessToken))
      ).status,
    ).toBe(200);

    // Dropdown without options, and options on a Text field, are both 400.
    expect((await createEntry(admin.accessToken, { name: 'D', type: 'Dropdown' })).status).toBe(
      400,
    );
    const text = (await createEntry(admin.accessToken, { name: 'T', type: 'Text' })).body.data;
    const res = await api(app)
      .patch(`/${API_PREFIX}/custom-field-library/${text.id}`)
      .set(...authHeader(admin.accessToken))
      .send({ options: ['a'] });
    expect(res.status).toBe(400);
    const typeChange = await api(app)
      .patch(`/${API_PREFIX}/custom-field-library/${text.id}`)
      .set(...authHeader(admin.accessToken))
      .send({ type: 'Number' });
    expect(typeChange.status).toBe(400);
  });
});
