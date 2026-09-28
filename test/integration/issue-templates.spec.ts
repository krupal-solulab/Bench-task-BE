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
import { api, createProject } from './setup/fixtures';

describe('issue templates (Module 12 - integration)', () => {
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

  async function seedOrgWithRoles(suffix: string) {
    const org = await seedOrganization(app, { name: `Issue Template Org ${suffix}` });
    const admin = await seedUserAndLogin(app, {
      email: `it-admin-${suffix}@example.com`,
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: `it-dev-${suffix}@example.com`,
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    return { org, admin, developer };
  }

  it('starts with no issue templates (regression)', async () => {
    const { admin } = await seedOrgWithRoles('empty');
    const res = await api(app)
      .get(`/${API_PREFIX}/issue-templates`)
      .set(...authHeader(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('an Admin creates an org-wide template; a Developer can list it but not create/edit/delete', async () => {
    const { admin, developer } = await seedOrgWithRoles('roles');

    const created = await api(app)
      .post(`/${API_PREFIX}/issue-templates`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Bug intake', issueType: 'Bug', titleTemplate: '[Bug] ', priority: 'P2' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ name: 'Bug intake', issueType: 'Bug' });
    // Regression: a trailing space in titleTemplate is meaningful (the prefix the applied title
    // continues from) and must survive verbatim, unlike `name`'s own trim-for-display convention.
    expect(created.body.data.titleTemplate).toBe('[Bug] ');

    const devCreate = await api(app)
      .post(`/${API_PREFIX}/issue-templates`)
      .set(...authHeader(developer.accessToken))
      .send({ name: 'Not allowed' });
    expect(devCreate.status).toBe(403);

    const devList = await api(app)
      .get(`/${API_PREFIX}/issue-templates`)
      .set(...authHeader(developer.accessToken));
    expect(devList.status).toBe(200);
    expect(devList.body.data).toHaveLength(1);

    const devUpdate = await api(app)
      .patch(`/${API_PREFIX}/issue-templates/${created.body.data.id}`)
      .set(...authHeader(developer.accessToken))
      .send({ name: 'Hijacked' });
    expect(devUpdate.status).toBe(403);

    const devDelete = await api(app)
      .delete(`/${API_PREFIX}/issue-templates/${created.body.data.id}`)
      .set(...authHeader(developer.accessToken));
    expect(devDelete.status).toBe(403);
  });

  it('an Admin can update and delete a template', async () => {
    const { admin } = await seedOrgWithRoles('crud');
    const created = await api(app)
      .post(`/${API_PREFIX}/issue-templates`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Original', issueType: 'Task' });

    const updated = await api(app)
      .patch(`/${API_PREFIX}/issue-templates/${created.body.data.id}`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Renamed' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe('Renamed');
    // Untouched field stays as-is on a partial patch.
    expect(updated.body.data.issueType).toBe('Task');

    const deleted = await api(app)
      .delete(`/${API_PREFIX}/issue-templates/${created.body.data.id}`)
      .set(...authHeader(admin.accessToken));
    expect(deleted.status).toBe(204);

    const listAfter = await api(app)
      .get(`/${API_PREFIX}/issue-templates`)
      .set(...authHeader(admin.accessToken));
    expect(listAfter.body.data).toEqual([]);
  });

  it('projectId=null (org-wide) templates always appear; project-scoped ones only appear for that project', async () => {
    const { admin } = await seedOrgWithRoles('scoping');
    const projectA = await createProject(app, admin.accessToken, { name: 'Project A' });
    const projectB = await createProject(app, admin.accessToken, { name: 'Project B' });

    const orgWide = await api(app)
      .post(`/${API_PREFIX}/issue-templates`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Org-wide template' });
    const scopedToA = await api(app)
      .post(`/${API_PREFIX}/issue-templates`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Project A only', projectId: projectA.id });
    expect(orgWide.status).toBe(201);
    expect(scopedToA.status).toBe(201);

    const forProjectA = await api(app)
      .get(`/${API_PREFIX}/issue-templates`)
      .query({ projectId: projectA.id })
      .set(...authHeader(admin.accessToken));
    expect(forProjectA.body.data.map((t: { name: string }) => t.name).sort()).toEqual([
      'Org-wide template',
      'Project A only',
    ]);

    const forProjectB = await api(app)
      .get(`/${API_PREFIX}/issue-templates`)
      .query({ projectId: projectB.id })
      .set(...authHeader(admin.accessToken));
    expect(forProjectB.body.data.map((t: { name: string }) => t.name)).toEqual([
      'Org-wide template',
    ]);

    const managementListing = await api(app)
      .get(`/${API_PREFIX}/issue-templates`)
      .set(...authHeader(admin.accessToken));
    expect(managementListing.body.data).toHaveLength(2);
  });

  it('rejects a projectId that belongs to another organization', async () => {
    const { admin } = await seedOrgWithRoles('cross-a');
    const { admin: adminB } = await seedOrgWithRoles('cross-b');
    const projectB = await createProject(app, adminB.accessToken, { name: 'Org B Project' });

    const res = await api(app)
      .post(`/${API_PREFIX}/issue-templates`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Cross-org attempt', projectId: projectB.id });
    expect(res.status).toBe(400);
  });

  it("never lets one organization see, edit, or delete another organization's templates", async () => {
    const { admin: adminA } = await seedOrgWithRoles('isolation-a');
    const { admin: adminB } = await seedOrgWithRoles('isolation-b');

    const created = await api(app)
      .post(`/${API_PREFIX}/issue-templates`)
      .set(...authHeader(adminA.accessToken))
      .send({ name: "Org A's template" });

    const listedByB = await api(app)
      .get(`/${API_PREFIX}/issue-templates`)
      .set(...authHeader(adminB.accessToken));
    expect(listedByB.body.data).toEqual([]);

    const editByB = await api(app)
      .patch(`/${API_PREFIX}/issue-templates/${created.body.data.id}`)
      .set(...authHeader(adminB.accessToken))
      .send({ name: 'Hijacked' });
    expect(editByB.status).toBe(404);

    const deleteByB = await api(app)
      .delete(`/${API_PREFIX}/issue-templates/${created.body.data.id}`)
      .set(...authHeader(adminB.accessToken));
    expect(deleteByB.status).toBe(404);
  });

  it('rejects a name longer than the configured limit', async () => {
    const { admin } = await seedOrgWithRoles('limits');
    const res = await api(app)
      .post(`/${API_PREFIX}/issue-templates`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'x'.repeat(101) });
    expect(res.status).toBe(400);
  });
});
