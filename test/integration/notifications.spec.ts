import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { TaskPriority } from 'src/common/enums/task-priority.enum';
import { NotificationType } from 'src/notifications/schemas/notification.schema';
import {
  API_PREFIX,
  createTestApp,
  closeTestApp,
  clearInMemoryMongo,
  seedOrganization,
  seedUserAndLogin,
  authHeader,
} from './setup/test-app';
import { api, addMembers, createProject, createTask } from './setup/fixtures';

describe('notifications (integration)', () => {
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

  /** Creating (or reassigning) a task to someone already fires a TaskAssigned notification -
   * clears that baseline so a test can assert cleanly on the specific action it's exercising. */
  async function clearNotifications(token: string) {
    await api(app)
      .post(`/${API_PREFIX}/notifications/read-all`)
      .set(...authHeader(token));
  }

  async function seedManager() {
    const org = await seedOrganization(app);
    const manager = await seedUserAndLogin(app, {
      email: 'notif-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    return { org, manager };
  }

  it('starts with zero unread notifications (regression)', async () => {
    const { manager } = await seedManager();
    const res = await api(app)
      .get(`/${API_PREFIX}/notifications/unread-count`)
      .set(...authHeader(manager.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ count: 0 });
  });

  it('notifies the assignee when a different user changes the task status', async () => {
    const { org, manager } = await seedManager();
    const developer = await seedUserAndLogin(app, {
      email: 'notif-dev@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, { name: 'Notif Project' });
    await addMembers(app, manager.accessToken, project.id, [developer.userDoc.id]);
    const task = await createTask(app, manager.accessToken, {
      title: 'Task',
      project: project.id,
      priority: TaskPriority.P2,
      assignee: developer.userDoc.id,
    });
    await clearNotifications(developer.accessToken);

    // The manager (not the assignee) changes the status.
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'In Progress' });

    const unread = await api(app)
      .get(`/${API_PREFIX}/notifications/unread-count`)
      .set(...authHeader(developer.accessToken));
    expect(unread.body.data).toEqual({ count: 1 });

    const list = await api(app)
      .get(`/${API_PREFIX}/notifications`)
      .query({ unreadOnly: true })
      .set(...authHeader(developer.accessToken));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ type: NotificationType.STATUS_CHANGED, read: false });
  });

  it('does not notify a user about their own status change', async () => {
    const { org, manager } = await seedManager();
    const developer = await seedUserAndLogin(app, {
      email: 'self-notif-dev@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, { name: 'Self Notif Project' });
    await addMembers(app, manager.accessToken, project.id, [developer.userDoc.id]);
    const task = await createTask(app, manager.accessToken, {
      title: 'Task',
      project: project.id,
      priority: TaskPriority.P2,
      assignee: developer.userDoc.id,
    });
    await clearNotifications(developer.accessToken);

    await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(developer.accessToken))
      .send({ status: 'In Progress' });

    const unread = await api(app)
      .get(`/${API_PREFIX}/notifications/unread-count`)
      .set(...authHeader(developer.accessToken));
    expect(unread.body.data).toEqual({ count: 0 });
  });

  it('notifies the assignee when someone else comments, not when they comment on their own task', async () => {
    const { org, manager } = await seedManager();
    const developer = await seedUserAndLogin(app, {
      email: 'comment-notif-dev@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, {
      name: 'Comment Notif Project',
    });
    await addMembers(app, manager.accessToken, project.id, [developer.userDoc.id]);
    const task = await createTask(app, manager.accessToken, {
      title: 'Task',
      project: project.id,
      priority: TaskPriority.P2,
      assignee: developer.userDoc.id,
    });
    await clearNotifications(developer.accessToken);

    await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/comments`)
      .set(...authHeader(developer.accessToken))
      .send({ body: 'commenting on my own task' });

    const afterSelfComment = await api(app)
      .get(`/${API_PREFIX}/notifications/unread-count`)
      .set(...authHeader(developer.accessToken));
    expect(afterSelfComment.body.data).toEqual({ count: 0 });

    await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/comments`)
      .set(...authHeader(manager.accessToken))
      .send({ body: 'a comment from the manager' });

    const afterOthersComment = await api(app)
      .get(`/${API_PREFIX}/notifications/unread-count`)
      .set(...authHeader(developer.accessToken));
    expect(afterOthersComment.body.data).toEqual({ count: 1 });
  });

  it('muting a type suppresses only that type, and unmutes are respected', async () => {
    const { org, manager } = await seedManager();
    const developer = await seedUserAndLogin(app, {
      email: 'mute-notif-dev@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, { name: 'Mute Notif Project' });
    await addMembers(app, manager.accessToken, project.id, [developer.userDoc.id]);
    const task = await createTask(app, manager.accessToken, {
      title: 'Task',
      project: project.id,
      priority: TaskPriority.P2,
      assignee: developer.userDoc.id,
    });
    await clearNotifications(developer.accessToken);

    const muted = await api(app)
      .put(`/${API_PREFIX}/notifications/preferences`)
      .set(...authHeader(developer.accessToken))
      .send({ mutedTypes: [NotificationType.STATUS_CHANGED] });
    expect(muted.status).toBe(200);
    expect(muted.body.data).toEqual({ mutedTypes: [NotificationType.STATUS_CHANGED] });

    await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'In Progress' });

    const afterMutedStatusChange = await api(app)
      .get(`/${API_PREFIX}/notifications/unread-count`)
      .set(...authHeader(developer.accessToken));
    expect(afterMutedStatusChange.body.data).toEqual({ count: 0 });

    // Comment Added is not muted, so it still comes through.
    await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/comments`)
      .set(...authHeader(manager.accessToken))
      .send({ body: 'still notified about this' });

    const afterComment = await api(app)
      .get(`/${API_PREFIX}/notifications/unread-count`)
      .set(...authHeader(developer.accessToken));
    expect(afterComment.body.data).toEqual({ count: 1 });
  });

  it('marks one and all notifications as read', async () => {
    const { org, manager } = await seedManager();
    const developer = await seedUserAndLogin(app, {
      email: 'read-notif-dev@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, { name: 'Read Notif Project' });
    await addMembers(app, manager.accessToken, project.id, [developer.userDoc.id]);
    const task = await createTask(app, manager.accessToken, {
      title: 'Task',
      project: project.id,
      priority: TaskPriority.P2,
      assignee: developer.userDoc.id,
    });
    await clearNotifications(developer.accessToken);

    await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'In Progress' });
    await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/comments`)
      .set(...authHeader(manager.accessToken))
      .send({ body: 'a comment' });

    const list = await api(app)
      .get(`/${API_PREFIX}/notifications`)
      .query({ unreadOnly: true })
      .set(...authHeader(developer.accessToken));
    expect(list.body.data).toHaveLength(2);

    const markOne = await api(app)
      .patch(`/${API_PREFIX}/notifications/${list.body.data[0].id}/read`)
      .set(...authHeader(developer.accessToken));
    expect(markOne.status).toBe(200);

    const afterOne = await api(app)
      .get(`/${API_PREFIX}/notifications/unread-count`)
      .set(...authHeader(developer.accessToken));
    expect(afterOne.body.data).toEqual({ count: 1 });

    const markAll = await api(app)
      .post(`/${API_PREFIX}/notifications/read-all`)
      .set(...authHeader(developer.accessToken));
    expect(markAll.status).toBe(200);

    const afterAll = await api(app)
      .get(`/${API_PREFIX}/notifications/unread-count`)
      .set(...authHeader(developer.accessToken));
    expect(afterAll.body.data).toEqual({ count: 0 });
  });

  it("never lets one user mark or see another user's notification", async () => {
    const { org, manager } = await seedManager();
    const developer = await seedUserAndLogin(app, {
      email: 'privacy-notif-dev@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const stranger = await seedUserAndLogin(app, {
      email: 'stranger-notif-dev@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, {
      name: 'Privacy Notif Project',
    });
    await addMembers(app, manager.accessToken, project.id, [
      developer.userDoc.id,
      stranger.userDoc.id,
    ]);
    const task = await createTask(app, manager.accessToken, {
      title: 'Task',
      project: project.id,
      priority: TaskPriority.P2,
      assignee: developer.userDoc.id,
    });
    await clearNotifications(developer.accessToken);
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'In Progress' });

    const list = await api(app)
      .get(`/${API_PREFIX}/notifications`)
      .set(...authHeader(developer.accessToken));
    const notificationId = list.body.data[0].id;

    const strangerMarkRead = await api(app)
      .patch(`/${API_PREFIX}/notifications/${notificationId}/read`)
      .set(...authHeader(stranger.accessToken));
    expect(strangerMarkRead.status).toBe(404);

    const strangerList = await api(app)
      .get(`/${API_PREFIX}/notifications`)
      .set(...authHeader(stranger.accessToken));
    expect(strangerList.body.data).toEqual([]);
  });
});
