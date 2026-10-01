import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { AuditAction } from 'src/modules/audit-log/schemas/audit-log-entry.schema';
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

/** Module 8 gap-closure: org-wide project categories + `Project.categoryId`. */
describe('project categories (integration)', () => {
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

  async function seedOrg(prefix = 'cat') {
    const org = await seedOrganization(app, { name: `${prefix} org`, slug: `${prefix}-org` });
    const admin = await seedUserAndLogin(app, {
      email: `${prefix}-admin@example.com`,
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const manager = await seedUserAndLogin(app, {
      email: `${prefix}-manager@example.com`,
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    return { org, admin, manager };
  }

  function createCategory(token: string, body: Record<string, unknown>) {
    return api(app)
      .post(`/${API_PREFIX}/project-categories`)
      .set(...authHeader(token))
      .send(body);
  }

  it('lets an Admin create/rename/list categories, audit-logged; Managers can read but not write', async () => {
    const { admin, manager } = await seedOrg();

    const created = await createCategory(admin.accessToken, { name: 'Client Work' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ name: 'Client Work', description: '' });

    const renamed = await api(app)
      .patch(`/${API_PREFIX}/project-categories/${created.body.data.id}`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Clients' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toBe('Clients');

    const managerList = await api(app)
      .get(`/${API_PREFIX}/project-categories`)
      .set(...authHeader(manager.accessToken));
    expect(managerList.status).toBe(200);
    expect(managerList.body.data.map((c: { name: string }) => c.name)).toEqual(['Clients']);

    const managerCreate = await createCategory(manager.accessToken, { name: 'Nope' });
    expect(managerCreate.status).toBe(403);

    const audit = await api(app)
      .get(`/${API_PREFIX}/audit-log`)
      .set(...authHeader(admin.accessToken));
    const actions = audit.body.data.map((e: { action: string }) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        AuditAction.PROJECT_CATEGORY_CREATED,
        AuditAction.PROJECT_CATEGORY_UPDATED,
      ]),
    );
  });

  it('rejects a case-insensitive duplicate name with 409', async () => {
    const { admin } = await seedOrg();
    await createCategory(admin.accessToken, { name: 'Internal' });
    const dup = await createCategory(admin.accessToken, { name: 'internal' });
    expect(dup.status).toBe(409);
  });

  it('assigns a category on create, filters the project list by it, and clears it with null', async () => {
    const { admin } = await seedOrg();
    const category = (await createCategory(admin.accessToken, { name: 'Client Work' })).body.data;

    const inCategory = await createProject(app, admin.accessToken, {
      name: 'Categorized project',
      categoryId: category.id,
    });
    expect(inCategory.categoryId).toBe(category.id);
    const uncategorized = await createProject(app, admin.accessToken, { name: 'Plain project' });
    expect(uncategorized.categoryId).toBeNull();

    const filtered = await api(app)
      .get(`/${API_PREFIX}/projects`)
      .query({ category: category.id })
      .set(...authHeader(admin.accessToken));
    expect(filtered.body.data.map((p: { name: string }) => p.name)).toEqual([
      'Categorized project',
    ]);

    const cleared = await api(app)
      .patch(`/${API_PREFIX}/projects/${inCategory.id}`)
      .set(...authHeader(admin.accessToken))
      .send({ categoryId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.categoryId).toBeNull();

    // Omitting the field on a later update must leave an assigned category untouched.
    await api(app)
      .patch(`/${API_PREFIX}/projects/${inCategory.id}`)
      .set(...authHeader(admin.accessToken))
      .send({ categoryId: category.id });
    const renamedOnly = await api(app)
      .patch(`/${API_PREFIX}/projects/${inCategory.id}`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Renamed project' });
    expect(renamedOnly.body.data.categoryId).toBe(category.id);
  });

  it("rejects another org's category on a project (400) and hides it from 404 on edit", async () => {
    const a = await seedOrg('cata');
    const b = await seedOrg('catb');
    const foreign = (await createCategory(b.admin.accessToken, { name: 'Theirs' })).body.data;

    const res = await api(app)
      .post(`/${API_PREFIX}/projects`)
      .set(...authHeader(a.admin.accessToken))
      .send({ name: 'Cross-org attempt', categoryId: foreign.id });
    expect(res.status).toBe(400);

    const edit = await api(app)
      .patch(`/${API_PREFIX}/project-categories/${foreign.id}`)
      .set(...authHeader(a.admin.accessToken))
      .send({ name: 'Hijacked' });
    expect(edit.status).toBe(404);
  });

  it('blocks deleting a category still used by a project (409), then allows it once unassigned', async () => {
    const { admin } = await seedOrg();
    const category = (await createCategory(admin.accessToken, { name: 'Temporary' })).body.data;
    const project = await createProject(app, admin.accessToken, {
      name: 'Uses the category',
      categoryId: category.id,
    });

    const blocked = await api(app)
      .delete(`/${API_PREFIX}/project-categories/${category.id}`)
      .set(...authHeader(admin.accessToken));
    expect(blocked.status).toBe(409);

    await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}`)
      .set(...authHeader(admin.accessToken))
      .send({ categoryId: null });
    const removed = await api(app)
      .delete(`/${API_PREFIX}/project-categories/${category.id}`)
      .set(...authHeader(admin.accessToken));
    expect(removed.status).toBe(204);
  });
});
