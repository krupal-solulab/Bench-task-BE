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

describe('teams (Module 6 - Teams, Project Roles & Security Schemes)', () => {
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
    const admin = await seedUserAndLogin(app, {
      email: 'team-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const manager = await seedUserAndLogin(app, {
      email: 'team-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: 'team-developer@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    return { org, admin, manager, developer };
  }

  it('starts with no teams (regression)', async () => {
    const { admin } = await seedFixtures();
    const res = await api(app)
      .get(`/${API_PREFIX}/teams`)
      .set(...authHeader(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('an Admin creates a team with a lead and members', async () => {
    const { admin, manager, developer } = await seedFixtures();
    const res = await api(app)
      .post(`/${API_PREFIX}/teams`)
      .set(...authHeader(admin.accessToken))
      .send({
        name: 'Backend Guild',
        description: 'Owns the API',
        leadId: manager.userDoc.id,
        memberIds: [manager.userDoc.id, developer.userDoc.id],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Backend Guild');
    expect(res.body.data.leadId.id).toBe(manager.userDoc.id);
    expect(res.body.data.memberIds).toHaveLength(2);
  });

  it('a Manager can also create a team', async () => {
    const { manager } = await seedFixtures();
    const res = await api(app)
      .post(`/${API_PREFIX}/teams`)
      .set(...authHeader(manager.accessToken))
      .send({ name: 'QA Guild' });
    expect(res.status).toBe(201);
  });

  it('rejects team creation from a Developer', async () => {
    const { developer } = await seedFixtures();
    const res = await api(app)
      .post(`/${API_PREFIX}/teams`)
      .set(...authHeader(developer.accessToken))
      .send({ name: 'Not allowed' });
    expect(res.status).toBe(403);
  });

  it('rejects a duplicate team name within the same org', async () => {
    const { admin } = await seedFixtures();
    await api(app)
      .post(`/${API_PREFIX}/teams`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Duplicate' });
    const res = await api(app)
      .post(`/${API_PREFIX}/teams`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Duplicate' });
    expect(res.status).toBe(400);
  });

  it('rejects a member id that does not exist in the organization', async () => {
    const { admin } = await seedFixtures();
    const res = await api(app)
      .post(`/${API_PREFIX}/teams`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Bad members', memberIds: ['507f1f77bcf86cd799439099'] });
    expect(res.status).toBe(400);
  });

  it('updates a team, replacing its member list', async () => {
    const { admin, developer } = await seedFixtures();
    const create = await api(app)
      .post(`/${API_PREFIX}/teams`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Growing Team' });

    const update = await api(app)
      .patch(`/${API_PREFIX}/teams/${create.body.data.id}`)
      .set(...authHeader(admin.accessToken))
      .send({ memberIds: [developer.userDoc.id] });
    expect(update.status).toBe(200);
    expect(update.body.data.memberIds).toHaveLength(1);
  });

  it('deletes a team', async () => {
    const { admin } = await seedFixtures();
    const create = await api(app)
      .post(`/${API_PREFIX}/teams`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'To delete' });

    const del = await api(app)
      .delete(`/${API_PREFIX}/teams/${create.body.data.id}`)
      .set(...authHeader(admin.accessToken));
    expect(del.status).toBe(204);

    const get = await api(app)
      .get(`/${API_PREFIX}/teams/${create.body.data.id}`)
      .set(...authHeader(admin.accessToken));
    expect(get.status).toBe(404);
  });

  it("never lets an Admin from a different org see another org's team", async () => {
    const { admin } = await seedFixtures();
    const otherOrg = await seedOrganization(app);
    const strangerAdmin = await seedUserAndLogin(app, {
      email: 'team-stranger@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: otherOrg.id,
    });

    const create = await api(app)
      .post(`/${API_PREFIX}/teams`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Private team' });

    const strangerGet = await api(app)
      .get(`/${API_PREFIX}/teams/${create.body.data.id}`)
      .set(...authHeader(strangerAdmin.accessToken));
    expect(strangerGet.status).toBe(404);
  });
});
