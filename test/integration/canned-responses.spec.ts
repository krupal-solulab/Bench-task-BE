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
import { api } from './setup/fixtures';

describe('canned responses (integration)', () => {
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
    const org = await seedOrganization(app, { name: `Canned Org ${suffix}` });
    const admin = await seedUserAndLogin(app, {
      email: `canned-admin-${suffix}@example.com`,
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: `canned-dev-${suffix}@example.com`,
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    return { org, admin, developer };
  }

  it('starts with no canned responses (regression)', async () => {
    const { admin } = await seedOrgWithRoles('empty');
    const res = await api(app)
      .get(`/${API_PREFIX}/canned-responses`)
      .set(...authHeader(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('a Developer can create a canned response, and an Admin in the same org sees it (shared, not owner-scoped)', async () => {
    const { admin, developer } = await seedOrgWithRoles('shared');

    const created = await api(app)
      .post(`/${API_PREFIX}/canned-responses`)
      .set(...authHeader(developer.accessToken))
      .send({ title: 'Investigating', body: "We're looking into it." });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ title: 'Investigating' });

    const listedByAdmin = await api(app)
      .get(`/${API_PREFIX}/canned-responses`)
      .set(...authHeader(admin.accessToken));
    expect(listedByAdmin.body.data).toHaveLength(1);
    expect(listedByAdmin.body.data[0].id).toBe(created.body.data.id);
  });

  it('an Admin can edit and delete a canned response created by a Developer (no ownership gate)', async () => {
    const { admin, developer } = await seedOrgWithRoles('edit');

    const created = await api(app)
      .post(`/${API_PREFIX}/canned-responses`)
      .set(...authHeader(developer.accessToken))
      .send({ title: 'Investigating', body: "We're looking into it." });

    const updated = await api(app)
      .patch(`/${API_PREFIX}/canned-responses/${created.body.data.id}`)
      .set(...authHeader(admin.accessToken))
      .send({ title: 'Resolved' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.title).toBe('Resolved');
    // Untouched field stays as-is on a partial patch.
    expect(updated.body.data.body).toBe("We're looking into it.");

    const deleted = await api(app)
      .delete(`/${API_PREFIX}/canned-responses/${created.body.data.id}`)
      .set(...authHeader(admin.accessToken));
    expect(deleted.status).toBe(204);

    const listedAfter = await api(app)
      .get(`/${API_PREFIX}/canned-responses`)
      .set(...authHeader(developer.accessToken));
    expect(listedAfter.body.data).toEqual([]);
  });

  it("never lets one organization see, edit, or delete another organization's canned responses", async () => {
    const { admin: adminA, developer: developerA } = await seedOrgWithRoles('cross-a');
    const { admin: adminB } = await seedOrgWithRoles('cross-b');

    const created = await api(app)
      .post(`/${API_PREFIX}/canned-responses`)
      .set(...authHeader(developerA.accessToken))
      .send({ title: "Org A's snippet", body: 'Only for org A.' });

    const listedByB = await api(app)
      .get(`/${API_PREFIX}/canned-responses`)
      .set(...authHeader(adminB.accessToken));
    expect(listedByB.body.data).toEqual([]);

    const editByB = await api(app)
      .patch(`/${API_PREFIX}/canned-responses/${created.body.data.id}`)
      .set(...authHeader(adminB.accessToken))
      .send({ title: 'Hijacked' });
    expect(editByB.status).toBe(404);

    const deleteByB = await api(app)
      .delete(`/${API_PREFIX}/canned-responses/${created.body.data.id}`)
      .set(...authHeader(adminB.accessToken));
    expect(deleteByB.status).toBe(404);

    // Still intact for org A.
    const listedByA = await api(app)
      .get(`/${API_PREFIX}/canned-responses`)
      .set(...authHeader(adminA.accessToken));
    expect(listedByA.body.data).toHaveLength(1);
  });

  it('rejects a title/body longer than the configured limits', async () => {
    const { admin } = await seedOrgWithRoles('limits');

    const res = await api(app)
      .post(`/${API_PREFIX}/canned-responses`)
      .set(...authHeader(admin.accessToken))
      .send({ title: 'x'.repeat(61), body: 'ok' });
    expect(res.status).toBe(400);
  });
});
