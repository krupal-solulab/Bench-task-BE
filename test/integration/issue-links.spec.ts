import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
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

describe('issue links, link types & dependency graph (integration)', () => {
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
      email: 'links-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    return { org, manager };
  }

  it('creates a link, lists it resolved from both sides, and deletes it', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Link Project' });
    const taskA = await createTask(app, manager.accessToken, {
      title: 'Task A',
      project: project.id,
      priority: TaskPriority.P2,
    });
    const taskB = await createTask(app, manager.accessToken, {
      title: 'Task B',
      project: project.id,
      priority: TaskPriority.P2,
    });

    const createRes = await api(app)
      .post(`/${API_PREFIX}/tasks/${taskA.id}/links`)
      .set(...authHeader(manager.accessToken))
      .send({ targetTaskId: taskB.id, linkTypeId: 'blocks' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data).toMatchObject({
      linkTypeId: 'blocks',
      linkTypeName: 'Blocks',
      direction: 'outgoing',
      task: { id: taskB.id, title: 'Task B' },
    });
    const linkId = createRes.body.data.id;

    const fromA = await api(app)
      .get(`/${API_PREFIX}/tasks/${taskA.id}/links`)
      .set(...authHeader(manager.accessToken));
    expect(fromA.body.data).toHaveLength(1);
    expect(fromA.body.data[0]).toMatchObject({
      direction: 'outgoing',
      linkTypeName: 'Blocks',
      task: { id: taskB.id },
    });

    const fromB = await api(app)
      .get(`/${API_PREFIX}/tasks/${taskB.id}/links`)
      .set(...authHeader(manager.accessToken));
    expect(fromB.body.data).toHaveLength(1);
    expect(fromB.body.data[0]).toMatchObject({
      direction: 'incoming',
      linkTypeName: 'Is Blocked By',
      task: { id: taskA.id },
    });

    const deleteRes = await api(app)
      .delete(`/${API_PREFIX}/tasks/${taskA.id}/links/${linkId}`)
      .set(...authHeader(manager.accessToken));
    expect(deleteRes.status).toBe(204);

    const afterDelete = await api(app)
      .get(`/${API_PREFIX}/tasks/${taskA.id}/links`)
      .set(...authHeader(manager.accessToken));
    expect(afterDelete.body.data).toHaveLength(0);
  });

  it('rejects linking a task to itself', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Self Link Project' });
    const task = await createTask(app, manager.accessToken, {
      title: 'Solo task',
      project: project.id,
      priority: TaskPriority.P2,
    });

    const res = await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/links`)
      .set(...authHeader(manager.accessToken))
      .send({ targetTaskId: task.id, linkTypeId: 'relates-to' });
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate link (same source/target/type)', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Duplicate Project' });
    const taskA = await createTask(app, manager.accessToken, {
      title: 'Task A',
      project: project.id,
      priority: TaskPriority.P2,
    });
    const taskB = await createTask(app, manager.accessToken, {
      title: 'Task B',
      project: project.id,
      priority: TaskPriority.P2,
    });

    await api(app)
      .post(`/${API_PREFIX}/tasks/${taskA.id}/links`)
      .set(...authHeader(manager.accessToken))
      .send({ targetTaskId: taskB.id, linkTypeId: 'relates-to' });

    const dup = await api(app)
      .post(`/${API_PREFIX}/tasks/${taskA.id}/links`)
      .set(...authHeader(manager.accessToken))
      .send({ targetTaskId: taskB.id, linkTypeId: 'relates-to' });
    expect(dup.status).toBe(409);
  });

  it('rejects an unknown link type id', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Unknown Type Project' });
    const taskA = await createTask(app, manager.accessToken, {
      title: 'Task A',
      project: project.id,
      priority: TaskPriority.P2,
    });
    const taskB = await createTask(app, manager.accessToken, {
      title: 'Task B',
      project: project.id,
      priority: TaskPriority.P2,
    });

    const res = await api(app)
      .post(`/${API_PREFIX}/tasks/${taskA.id}/links`)
      .set(...authHeader(manager.accessToken))
      .send({ targetTaskId: taskB.id, linkTypeId: 'nonexistent-type' });
    expect(res.status).toBe(400);
  });

  it('rejects a blocking link that would close a cycle, even across projects', async () => {
    const { manager } = await seedManager();
    const projectA = await createProject(app, manager.accessToken, { name: 'Cycle Project A' });
    const projectB = await createProject(app, manager.accessToken, { name: 'Cycle Project B' });
    const taskA = await createTask(app, manager.accessToken, {
      title: 'Task A',
      project: projectA.id,
      priority: TaskPriority.P2,
    });
    const taskB = await createTask(app, manager.accessToken, {
      title: 'Task B',
      project: projectB.id,
      priority: TaskPriority.P2,
    });

    // A blocks B.
    const first = await api(app)
      .post(`/${API_PREFIX}/tasks/${taskA.id}/links`)
      .set(...authHeader(manager.accessToken))
      .send({ targetTaskId: taskB.id, linkTypeId: 'blocks' });
    expect(first.status).toBe(201);

    // B blocks A would close a 2-node cycle across projects - must be rejected.
    const second = await api(app)
      .post(`/${API_PREFIX}/tasks/${taskB.id}/links`)
      .set(...authHeader(manager.accessToken))
      .send({ targetTaskId: taskA.id, linkTypeId: 'blocks' });
    expect(second.status).toBe(400);
    expect(second.body.message).toContain(taskA.issueKey);
    expect(second.body.message).toContain(taskB.issueKey);
    expect(second.body.message).toContain('→');
  });

  it('a non-blocking link type never triggers cycle detection', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, {
      name: 'Relates Cycle Project',
    });
    const taskA = await createTask(app, manager.accessToken, {
      title: 'Task A',
      project: project.id,
      priority: TaskPriority.P2,
    });
    const taskB = await createTask(app, manager.accessToken, {
      title: 'Task B',
      project: project.id,
      priority: TaskPriority.P2,
    });

    await api(app)
      .post(`/${API_PREFIX}/tasks/${taskA.id}/links`)
      .set(...authHeader(manager.accessToken))
      .send({ targetTaskId: taskB.id, linkTypeId: 'relates-to' });

    const reverse = await api(app)
      .post(`/${API_PREFIX}/tasks/${taskB.id}/links`)
      .set(...authHeader(manager.accessToken))
      .send({ targetTaskId: taskA.id, linkTypeId: 'relates-to' });
    expect(reverse.status).toBe(201);
  });

  it('denies linking/viewing tasks in a project the caller cannot access', async () => {
    const { org, manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Private Project' });
    const taskA = await createTask(app, manager.accessToken, {
      title: 'Task A',
      project: project.id,
      priority: TaskPriority.P2,
    });
    const taskB = await createTask(app, manager.accessToken, {
      title: 'Task B',
      project: project.id,
      priority: TaskPriority.P2,
    });

    const outsider = await seedUserAndLogin(app, {
      email: 'outsider-dev@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });

    const res = await api(app)
      .post(`/${API_PREFIX}/tasks/${taskA.id}/links`)
      .set(...authHeader(outsider.accessToken))
      .send({ targetTaskId: taskB.id, linkTypeId: 'relates-to' });
    expect(res.status).toBe(403);

    const listRes = await api(app)
      .get(`/${API_PREFIX}/tasks/${taskA.id}/links`)
      .set(...authHeader(outsider.accessToken));
    expect(listRes.status).toBe(403);
  });

  describe('link types catalog', () => {
    it("returns the 5 default link types when the org hasn't customized any", async () => {
      const { manager } = await seedManager();
      const res = await api(app)
        .get(`/${API_PREFIX}/link-types`)
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(5);
      expect(res.body.data.map((t: { id: string }) => t.id)).toEqual(
        expect.arrayContaining(['blocks', 'relates-to', 'duplicates', 'clones', 'causes']),
      );
    });

    it('only an Admin may replace the link type catalog', async () => {
      const { org, manager } = await seedManager();
      const defaults = await api(app)
        .get(`/${API_PREFIX}/link-types`)
        .set(...authHeader(manager.accessToken));

      const managerAttempt = await api(app)
        .put(`/${API_PREFIX}/link-types`)
        .set(...authHeader(manager.accessToken))
        .send({ linkTypes: defaults.body.data });
      expect(managerAttempt.status).toBe(403);

      const admin = await seedUserAndLogin(app, {
        email: 'links-admin@example.com',
        password: 'Password123',
        role: Role.ADMIN,
        organizationId: org.id,
      });
      const adminAttempt = await api(app)
        .put(`/${API_PREFIX}/link-types`)
        .set(...authHeader(admin.accessToken))
        .send({
          linkTypes: [
            ...defaults.body.data,
            { name: 'Depends On', inverseName: 'Is Depended On By', isBlocking: true },
          ],
        });
      expect(adminAttempt.status).toBe(200);
      expect(adminAttempt.body.data).toHaveLength(6);
    });

    it('a newly-added blocking link type is usable and enforces cycle detection', async () => {
      const { org, manager } = await seedManager();
      const admin = await seedUserAndLogin(app, {
        email: 'links-admin-2@example.com',
        password: 'Password123',
        role: Role.ADMIN,
        organizationId: org.id,
      });
      const defaults = await api(app)
        .get(`/${API_PREFIX}/link-types`)
        .set(...authHeader(manager.accessToken));
      const updated = await api(app)
        .put(`/${API_PREFIX}/link-types`)
        .set(...authHeader(admin.accessToken))
        .send({
          linkTypes: [
            ...defaults.body.data,
            { name: 'Depends On', inverseName: 'Is Depended On By', isBlocking: true },
          ],
        });
      const dependsOn = updated.body.data.find((t: { name: string }) => t.name === 'Depends On');

      const project = await createProject(app, manager.accessToken, {
        name: 'Custom Type Project',
      });
      const taskA = await createTask(app, manager.accessToken, {
        title: 'Task A',
        project: project.id,
        priority: TaskPriority.P2,
      });
      const taskB = await createTask(app, manager.accessToken, {
        title: 'Task B',
        project: project.id,
        priority: TaskPriority.P2,
      });

      const created = await api(app)
        .post(`/${API_PREFIX}/tasks/${taskA.id}/links`)
        .set(...authHeader(manager.accessToken))
        .send({ targetTaskId: taskB.id, linkTypeId: dependsOn.id });
      expect(created.status).toBe(201);

      const cyclic = await api(app)
        .post(`/${API_PREFIX}/tasks/${taskB.id}/links`)
        .set(...authHeader(manager.accessToken))
        .send({ targetTaskId: taskA.id, linkTypeId: dependsOn.id });
      expect(cyclic.status).toBe(400);
    });

    it('rejects duplicate names and an unknown existing id on update', async () => {
      const { org, manager } = await seedManager();
      const admin = await seedUserAndLogin(app, {
        email: 'links-admin-3@example.com',
        password: 'Password123',
        role: Role.ADMIN,
        organizationId: org.id,
      });
      const defaults = await api(app)
        .get(`/${API_PREFIX}/link-types`)
        .set(...authHeader(manager.accessToken));

      const dupNames = await api(app)
        .put(`/${API_PREFIX}/link-types`)
        .set(...authHeader(admin.accessToken))
        .send({
          linkTypes: [
            { name: 'Same Name', inverseName: 'A', isBlocking: false },
            { name: 'Same Name', inverseName: 'B', isBlocking: false },
          ],
        });
      expect(dupNames.status).toBe(400);

      const unknownId = await api(app)
        .put(`/${API_PREFIX}/link-types`)
        .set(...authHeader(admin.accessToken))
        .send({
          linkTypes: [{ id: 'does-not-exist', name: 'X', inverseName: 'Y', isBlocking: false }],
        });
      expect(unknownId.status).toBe(400);
      void defaults;
    });
  });

  describe('dependency graph', () => {
    it('returns internal nodes/edges for a project, and marks a cross-project link external', async () => {
      const { manager } = await seedManager();
      const projectA = await createProject(app, manager.accessToken, { name: 'Graph Project A' });
      const projectB = await createProject(app, manager.accessToken, { name: 'Graph Project B' });
      const taskA1 = await createTask(app, manager.accessToken, {
        title: 'Task A1',
        project: projectA.id,
        priority: TaskPriority.P2,
      });
      const taskA2 = await createTask(app, manager.accessToken, {
        title: 'Task A2',
        project: projectA.id,
        priority: TaskPriority.P2,
      });
      const taskB1 = await createTask(app, manager.accessToken, {
        title: 'Task B1',
        project: projectB.id,
        priority: TaskPriority.P2,
      });

      await api(app)
        .post(`/${API_PREFIX}/tasks/${taskA1.id}/links`)
        .set(...authHeader(manager.accessToken))
        .send({ targetTaskId: taskA2.id, linkTypeId: 'relates-to' });
      await api(app)
        .post(`/${API_PREFIX}/tasks/${taskA1.id}/links`)
        .set(...authHeader(manager.accessToken))
        .send({ targetTaskId: taskB1.id, linkTypeId: 'blocks' });

      const res = await api(app)
        .get(`/${API_PREFIX}/projects/${projectA.id}/dependency-graph`)
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);

      const nodeIds = res.body.data.nodes.map((n: { id: string }) => n.id);
      expect(nodeIds).toEqual(expect.arrayContaining([taskA1.id, taskA2.id, taskB1.id]));
      const externalNode = res.body.data.nodes.find((n: { id: string }) => n.id === taskB1.id);
      expect(externalNode).toMatchObject({ external: true, projectName: 'Graph Project B' });
      const internalNode = res.body.data.nodes.find((n: { id: string }) => n.id === taskA1.id);
      expect(internalNode).toMatchObject({ external: false });

      expect(res.body.data.edges).toHaveLength(2);
      const blockingEdge = res.body.data.edges.find(
        (e: { linkTypeId: string }) => e.linkTypeId === 'blocks',
      );
      expect(blockingEdge).toMatchObject({
        source: taskA1.id,
        target: taskB1.id,
        isBlocking: true,
      });
    });

    it('denies the dependency graph to a caller who cannot view the project', async () => {
      const { org, manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, {
        name: 'Denied Graph Project',
      });
      const outsider = await seedUserAndLogin(app, {
        email: 'outsider-graph@example.com',
        password: 'Password123',
        role: Role.DEVELOPER,
        organizationId: org.id,
      });

      const res = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/dependency-graph`)
        .set(...authHeader(outsider.accessToken));
      expect(res.status).toBe(403);
    });
  });
});
