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

describe('saved filters (integration)', () => {
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

  async function seedManager(email = 'saved-filters-manager@example.com') {
    const org = await seedOrganization(app);
    const manager = await seedUserAndLogin(app, {
      email,
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    return { org, manager };
  }

  it('starts with no saved filters (regression)', async () => {
    const { manager } = await seedManager();
    const res = await api(app)
      .get(`/${API_PREFIX}/saved-filters`)
      .set(...authHeader(manager.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('rejects a "project"-scoped filter with no projectId', async () => {
    const { manager } = await seedManager();
    const res = await api(app)
      .post(`/${API_PREFIX}/saved-filters`)
      .set(...authHeader(manager.accessToken))
      .send({ name: 'Bad', scope: 'project', query: {} });
    expect(res.status).toBe(400);
  });

  it('creates, lists, and deletes a saved filter', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'SF Project' });

    const created = await api(app)
      .post(`/${API_PREFIX}/saved-filters`)
      .set(...authHeader(manager.accessToken))
      .send({
        name: 'My open P1 bugs',
        scope: 'project',
        projectId: project.id,
        query: { priority: ['P1'], issueType: ['Bug'] },
      });
    expect(created.status).toBe(201);
    expect(created.body.data.name).toBe('My open P1 bugs');
    expect(created.body.data.query).toEqual({ priority: ['P1'], issueType: ['Bug'] });

    const listed = await api(app)
      .get(`/${API_PREFIX}/saved-filters`)
      .query({ scope: 'project', projectId: project.id })
      .set(...authHeader(manager.accessToken));
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].id).toBe(created.body.data.id);

    const deleted = await api(app)
      .delete(`/${API_PREFIX}/saved-filters/${created.body.data.id}`)
      .set(...authHeader(manager.accessToken));
    expect(deleted.status).toBe(204);

    const listedAfter = await api(app)
      .get(`/${API_PREFIX}/saved-filters`)
      .set(...authHeader(manager.accessToken));
    expect(listedAfter.body.data).toEqual([]);
  });

  it("never lets one user see or delete another user's saved filter", async () => {
    const { org, manager: ownerUser } = await seedManager('owner@example.com');
    const otherUser = await seedUserAndLogin(app, {
      email: 'other@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });

    const created = await api(app)
      .post(`/${API_PREFIX}/saved-filters`)
      .set(...authHeader(ownerUser.accessToken))
      .send({ name: 'Private filter', scope: 'myTasks', query: {} });

    const listedByOther = await api(app)
      .get(`/${API_PREFIX}/saved-filters`)
      .set(...authHeader(otherUser.accessToken));
    expect(listedByOther.body.data).toEqual([]);

    const deleteByOther = await api(app)
      .delete(`/${API_PREFIX}/saved-filters/${created.body.data.id}`)
      .set(...authHeader(otherUser.accessToken));
    expect(deleteByOther.status).toBe(404);
  });

  describe('sharing (Search/Dashboards v2)', () => {
    it('rejects visibility=shared on a myTasks-scoped filter', async () => {
      const { manager } = await seedManager();
      const res = await api(app)
        .post(`/${API_PREFIX}/saved-filters`)
        .set(...authHeader(manager.accessToken))
        .send({ name: 'Bad', scope: 'myTasks', visibility: 'shared', query: {} });
      expect(res.status).toBe(400);
    });

    it('a private project filter (the default) stays invisible to another user, exactly as before', async () => {
      const { org, manager: ownerUser } = await seedManager('private-owner@example.com');
      const otherUser = await seedUserAndLogin(app, {
        email: 'private-other@example.com',
        password: 'Password123',
        role: Role.MANAGER,
        organizationId: org.id,
      });
      const project = await createProject(app, ownerUser.accessToken, {
        name: 'Private SF Project',
      });

      await api(app)
        .post(`/${API_PREFIX}/saved-filters`)
        .set(...authHeader(ownerUser.accessToken))
        .send({
          name: 'Private project filter',
          scope: 'project',
          projectId: project.id,
          query: {},
        });

      const listedByOther = await api(app)
        .get(`/${API_PREFIX}/saved-filters`)
        .query({ scope: 'project', projectId: project.id })
        .set(...authHeader(otherUser.accessToken));
      expect(listedByOther.body.data).toEqual([]);
    });

    it('a shared project filter is visible (but not deletable) to another user', async () => {
      const { org, manager: ownerUser } = await seedManager('shared-owner@example.com');
      const otherUser = await seedUserAndLogin(app, {
        email: 'shared-other@example.com',
        password: 'Password123',
        role: Role.MANAGER,
        organizationId: org.id,
      });
      const project = await createProject(app, ownerUser.accessToken, {
        name: 'Shared SF Project',
      });

      const created = await api(app)
        .post(`/${API_PREFIX}/saved-filters`)
        .set(...authHeader(ownerUser.accessToken))
        .send({
          name: 'Team filter',
          scope: 'project',
          projectId: project.id,
          visibility: 'shared',
          query: { priority: ['P1'] },
        });
      expect(created.status).toBe(201);
      expect(created.body.data.visibility).toBe('shared');

      const listedByOther = await api(app)
        .get(`/${API_PREFIX}/saved-filters`)
        .query({ scope: 'project', projectId: project.id })
        .set(...authHeader(otherUser.accessToken));
      expect(listedByOther.body.data).toHaveLength(1);
      expect(listedByOther.body.data[0].id).toBe(created.body.data.id);
      expect(listedByOther.body.data[0].owner).toEqual(expect.any(String));

      const deleteByOther = await api(app)
        .delete(`/${API_PREFIX}/saved-filters/${created.body.data.id}`)
        .set(...authHeader(otherUser.accessToken));
      expect(deleteByOther.status).toBe(404);

      // The owner can still delete their own shared filter.
      const deleteByOwner = await api(app)
        .delete(`/${API_PREFIX}/saved-filters/${created.body.data.id}`)
        .set(...authHeader(ownerUser.accessToken));
      expect(deleteByOwner.status).toBe(204);
    });

    it('a shared filter for a different project is not returned', async () => {
      const { org, manager: ownerUser } = await seedManager('cross-owner@example.com');
      const otherUser = await seedUserAndLogin(app, {
        email: 'cross-other@example.com',
        password: 'Password123',
        role: Role.MANAGER,
        organizationId: org.id,
      });
      const projectA = await createProject(app, ownerUser.accessToken, { name: 'Project A' });
      const projectB = await createProject(app, ownerUser.accessToken, { name: 'Project B' });

      await api(app)
        .post(`/${API_PREFIX}/saved-filters`)
        .set(...authHeader(ownerUser.accessToken))
        .send({
          name: 'Team filter A',
          scope: 'project',
          projectId: projectA.id,
          visibility: 'shared',
          query: {},
        });

      const listedForB = await api(app)
        .get(`/${API_PREFIX}/saved-filters`)
        .query({ scope: 'project', projectId: projectB.id })
        .set(...authHeader(otherUser.accessToken));
      expect(listedForB.body.data).toEqual([]);
    });
  });
});
