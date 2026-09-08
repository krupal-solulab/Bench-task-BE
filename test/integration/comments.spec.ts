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

describe('comments (integration)', () => {
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
      email: 'comment-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const manager = await seedUserAndLogin(app, {
      email: 'comment-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const member = await seedUserAndLogin(app, {
      email: 'comment-member@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const nonMember = await seedUserAndLogin(app, {
      email: 'comment-nonmember@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, {
      name: 'Comments Project',
      memberIds: [member.userDoc.id],
    });
    const task = await createTask(app, manager.accessToken, {
      title: 'Commentable task',
      project: project.id,
      priority: TaskPriority.P2,
    });
    return { org, admin, manager, member, nonMember, project, task };
  }

  it('a project member can post and list comments on a task', async () => {
    const { member, task } = await seedFixtures();

    const postRes = await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/comments`)
      .set(...authHeader(member.accessToken))
      .send({ body: 'Looks good, ready for review.' });
    expect(postRes.status).toBe(201);
    expect(postRes.body.data.body).toBe('Looks good, ready for review.');
    expect(postRes.body.data.taskId).toBe(task.id);

    const listRes = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}/comments`)
      .set(...authHeader(member.accessToken));
    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);
  });

  it('a non-member gets 403 posting or listing comments on a task', async () => {
    const { nonMember, task } = await seedFixtures();

    const postRes = await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/comments`)
      .set(...authHeader(nonMember.accessToken))
      .send({ body: 'I should not be able to do this.' });
    expect(postRes.status).toBe(403);

    const listRes = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}/comments`)
      .set(...authHeader(nonMember.accessToken));
    expect(listRes.status).toBe(403);
  });

  it('the comment author can edit and delete their own comment', async () => {
    const { member, task } = await seedFixtures();
    const created = await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/comments`)
      .set(...authHeader(member.accessToken))
      .send({ body: 'Original body' });

    const editRes = await api(app)
      .patch(`/${API_PREFIX}/comments/${created.body.data.id}`)
      .set(...authHeader(member.accessToken))
      .send({ body: 'Edited body' });
    expect(editRes.status).toBe(200);
    expect(editRes.body.data.body).toBe('Edited body');

    const deleteRes = await api(app)
      .delete(`/${API_PREFIX}/comments/${created.body.data.id}`)
      .set(...authHeader(member.accessToken));
    expect(deleteRes.status).toBe(204);

    const listRes = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}/comments`)
      .set(...authHeader(member.accessToken));
    expect(listRes.body.data).toHaveLength(0);
  });

  it("another non-admin project member gets 403 editing or deleting someone else's comment", async () => {
    const { org, manager, member, project, task } = await seedFixtures();
    // Add the manager as an explicit member too so they can view/comment, to isolate the
    // "not the author, not Admin" check rather than a membership check.
    const otherMember = await seedUserAndLogin(app, {
      email: 'comment-other-member@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/members`)
      .set(...authHeader(manager.accessToken))
      .send({ userIds: [otherMember.userDoc.id] });

    const created = await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/comments`)
      .set(...authHeader(member.accessToken))
      .send({ body: 'Author-only comment' });

    const editAttempt = await api(app)
      .patch(`/${API_PREFIX}/comments/${created.body.data.id}`)
      .set(...authHeader(otherMember.accessToken))
      .send({ body: "Trying to edit someone else's comment" });
    expect(editAttempt.status).toBe(403);

    const deleteAttempt = await api(app)
      .delete(`/${API_PREFIX}/comments/${created.body.data.id}`)
      .set(...authHeader(otherMember.accessToken));
    expect(deleteAttempt.status).toBe(403);
  });

  it('Admin can edit and delete any comment', async () => {
    const { admin, member, task } = await seedFixtures();
    const created = await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/comments`)
      .set(...authHeader(member.accessToken))
      .send({ body: 'Member comment' });

    const editRes = await api(app)
      .patch(`/${API_PREFIX}/comments/${created.body.data.id}`)
      .set(...authHeader(admin.accessToken))
      .send({ body: 'Admin edited this' });
    expect(editRes.status).toBe(200);
    expect(editRes.body.data.body).toBe('Admin edited this');

    const deleteRes = await api(app)
      .delete(`/${API_PREFIX}/comments/${created.body.data.id}`)
      .set(...authHeader(admin.accessToken));
    expect(deleteRes.status).toBe(204);
  });
});
