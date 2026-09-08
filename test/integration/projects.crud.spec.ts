import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { ProjectStatus } from 'src/common/enums/project-status.enum';
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
import { api, createProject, createTask, addMembers } from './setup/fixtures';

describe('projects CRUD (integration)', () => {
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

  async function seedManagerAndDeveloper() {
    const org = await seedOrganization(app);
    const manager = await seedUserAndLogin(app, {
      email: 'proj-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: 'proj-developer@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    return { org, manager, developer };
  }

  it('creates, reads, updates and soft-deletes a project as Manager', async () => {
    const { manager } = await seedManagerAndDeveloper();

    const created = await createProject(app, manager.accessToken, {
      name: 'Website Redesign',
      description: 'Revamp the marketing site.',
    });
    expect(created.name).toBe('Website Redesign');
    expect(created.status).toBe(ProjectStatus.PLANNING);
    expect(created.owner.id).toBe(manager.userDoc.id);

    const getRes = await api(app)
      .get(`/${API_PREFIX}/projects/${created.id}`)
      .set(...authHeader(manager.accessToken));
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.id).toBe(created.id);

    const updateRes = await api(app)
      .patch(`/${API_PREFIX}/projects/${created.id}`)
      .set(...authHeader(manager.accessToken))
      .send({ description: 'Updated description' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.description).toBe('Updated description');

    const deleteRes = await api(app)
      .delete(`/${API_PREFIX}/projects/${created.id}`)
      .set(...authHeader(manager.accessToken));
    expect(deleteRes.status).toBe(204);

    const getAfterDelete = await api(app)
      .get(`/${API_PREFIX}/projects/${created.id}`)
      .set(...authHeader(manager.accessToken));
    expect(getAfterDelete.status).toBe(404);
  });

  it('rejects an illegal project status transition with 409 (Planning -> Completed is not allowed)', async () => {
    const { manager } = await seedManagerAndDeveloper();
    const project = await createProject(app, manager.accessToken, { name: 'Illegal Transition' });

    const res = await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: ProjectStatus.COMPLETED });
    expect(res.status).toBe(409);

    // Legal transition still works.
    const legal = await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: ProjectStatus.IN_PROGRESS });
    expect(legal.status).toBe(200);
    expect(legal.body.data.status).toBe(ProjectStatus.IN_PROGRESS);
  });

  it('blocks completing a project while it has open (non-Done) tasks', async () => {
    const { manager } = await seedManagerAndDeveloper();
    const project = await createProject(app, manager.accessToken, { name: 'Blocked Completion' });
    await createTask(app, manager.accessToken, {
      title: 'Unfinished task',
      project: project.id,
      priority: TaskPriority.P2,
    });
    await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: ProjectStatus.IN_PROGRESS });

    const res = await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: ProjectStatus.COMPLETED });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/not yet Done/);
  });

  it('adds and removes members; removing a member with open tasks and no reassignTo is a 409', async () => {
    const { org, manager, developer } = await seedManagerAndDeveloper();
    const secondDeveloper = await seedUserAndLogin(app, {
      email: 'proj-developer-2@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, { name: 'Membership Project' });

    const added = await addMembers(app, manager.accessToken, project.id, [
      developer.userDoc.id,
      secondDeveloper.userDoc.id,
    ]);
    expect(added.members).toHaveLength(3); // owner + 2 members

    const task = await createTask(app, manager.accessToken, {
      title: 'Assigned to developer',
      project: project.id,
      priority: TaskPriority.P1,
      assignee: developer.userDoc.id,
    });
    expect(task.assignee.id).toBe(developer.userDoc.id);

    // Removing a member with an open task and no reassignTo -> 409.
    const blocked = await api(app)
      .delete(`/${API_PREFIX}/projects/${project.id}/members/${developer.userDoc.id}`)
      .set(...authHeader(manager.accessToken));
    expect(blocked.status).toBe(409);

    // With reassignTo pointing at another member, it succeeds and reassigns the task.
    const removed = await api(app)
      .delete(`/${API_PREFIX}/projects/${project.id}/members/${developer.userDoc.id}`)
      .query({ reassignTo: secondDeveloper.userDoc.id })
      .set(...authHeader(manager.accessToken));
    expect(removed.status).toBe(200);
    expect(
      removed.body.data.members.some(
        (m: { user: { id: string } }) => m.user.id === developer.userDoc.id,
      ),
    ).toBe(false);

    const taskAfter = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(manager.accessToken));
    expect(taskAfter.body.data.assignee.id).toBe(secondDeveloper.userDoc.id);
  });

  it('Developer cannot create/update/delete a project (403) but can view one they are a member of', async () => {
    const { manager, developer } = await seedManagerAndDeveloper();
    const project = await createProject(app, manager.accessToken, {
      name: 'Dev View Project',
      memberIds: [developer.userDoc.id],
    });

    const createAttempt = await api(app)
      .post(`/${API_PREFIX}/projects`)
      .set(...authHeader(developer.accessToken))
      .send({ name: 'Should fail' });
    expect(createAttempt.status).toBe(403);

    const updateAttempt = await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}`)
      .set(...authHeader(developer.accessToken))
      .send({ description: 'nope' });
    expect(updateAttempt.status).toBe(403);

    const deleteAttempt = await api(app)
      .delete(`/${API_PREFIX}/projects/${project.id}`)
      .set(...authHeader(developer.accessToken));
    expect(deleteAttempt.status).toBe(403);

    const viewAsMember = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}`)
      .set(...authHeader(developer.accessToken));
    expect(viewAsMember.status).toBe(200);
  });

  it('a Developer who is not a member gets 403 (not 404) viewing an existing project', async () => {
    const { manager, developer } = await seedManagerAndDeveloper();
    // developer is NOT added as a member here.
    const project = await createProject(app, manager.accessToken, { name: 'Not A Member Project' });

    const res = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}`)
      .set(...authHeader(developer.accessToken));
    // projects.service.ts `assertCanView` throws ForbiddenException (not NotFoundException) for a
    // real, existing project the caller isn't a member of.
    expect(res.status).toBe(403);
  });

  it('a Developer only sees projects they are a member of when listing', async () => {
    const { manager, developer } = await seedManagerAndDeveloper();
    const memberProject = await createProject(app, manager.accessToken, {
      name: 'Member Of This One',
      memberIds: [developer.userDoc.id],
    });
    await createProject(app, manager.accessToken, { name: 'Not A Member Of This One' });

    const res = await api(app)
      .get(`/${API_PREFIX}/projects`)
      .set(...authHeader(developer.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(memberProject.id);
  });
});
