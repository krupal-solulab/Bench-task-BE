import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role } from 'src/common/enums/role.enum';
import { TaskPriority } from 'src/common/enums/task-priority.enum';
import { NotificationType } from 'src/notifications/schemas/notification.schema';
import { Task, TaskDocument } from 'src/modules/tasks/schemas/task.schema';
import { TasksService } from 'src/modules/tasks/tasks.service';
import {
  API_PREFIX,
  createTestApp,
  closeTestApp,
  clearInMemoryMongo,
  seedOrganization,
  seedUserAndLogin,
  authHeader,
} from './setup/test-app';
import { api, addMembers, createProject, createTask, createSprint } from './setup/fixtures';

/**
 * Covers the Notification Schemes v2 feature: an Org Admin/Manager can configure, per project,
 * which roles get notified (over which channels) for the Assigned/Commented/Transitioned/
 * SprintStarted/SprintCompleted events - additive on top of the existing hardcoded assignee
 * notifications, which every other integration test (notifications.spec.ts) already covers
 * unmodified.
 */
describe('notification scheme (integration)', () => {
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

  async function seedManagerAndAdmin() {
    const org = await seedOrganization(app);
    const manager = await seedUserAndLogin(app, {
      email: 'scheme-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const admin = await seedUserAndLogin(app, {
      email: 'scheme-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    return { org, manager, admin };
  }

  async function clearNotifications(token: string) {
    await api(app)
      .post(`/${API_PREFIX}/notifications/read-all`)
      .set(...authHeader(token));
  }

  it('rejects a Developer from configuring the scheme', async () => {
    const { org, manager } = await seedManagerAndAdmin();
    const developer = await seedUserAndLogin(app, {
      email: 'scheme-dev-perm@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, { name: 'Scheme Perm Project' });

    const res = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/notification-scheme`)
      .set(...authHeader(developer.accessToken))
      .send({ rules: [] });
    expect(res.status).toBe(403);
  });

  it('rejects a duplicate event entry and roles with no channel selected', async () => {
    const { manager } = await seedManagerAndAdmin();
    const project = await createProject(app, manager.accessToken, { name: 'Scheme Validation' });

    const duplicate = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/notification-scheme`)
      .set(...authHeader(manager.accessToken))
      .send({
        rules: [
          { event: 'Assigned', notifyRoles: ['Manager'], channels: ['InApp'] },
          { event: 'Assigned', notifyRoles: ['Admin'], channels: ['Email'] },
        ],
      });
    expect(duplicate.status).toBe(400);

    const noChannel = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/notification-scheme`)
      .set(...authHeader(manager.accessToken))
      .send({ rules: [{ event: 'Commented', notifyRoles: ['Manager'], channels: [] }] });
    expect(noChannel.status).toBe(400);
  });

  it('a project with no scheme configured produces zero Scheme-type notifications (regression)', async () => {
    const { org, manager } = await seedManagerAndAdmin();
    const developer = await seedUserAndLogin(app, {
      email: 'scheme-dev-regression@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, {
      name: 'Unconfigured Scheme Project',
    });
    await addMembers(app, manager.accessToken, project.id, [developer.userDoc.id]);
    const task = await createTask(app, manager.accessToken, {
      title: 'A task',
      project: project.id,
      priority: TaskPriority.P2,
      assignee: developer.userDoc.id,
    });
    await clearNotifications(manager.accessToken);

    await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/comments`)
      .set(...authHeader(developer.accessToken))
      .send({ body: 'progress update' });

    const list = await api(app)
      .get(`/${API_PREFIX}/notifications`)
      .set(...authHeader(manager.accessToken));
    expect(
      list.body.data.filter((n: { type: string }) => n.type === NotificationType.SCHEME),
    ).toHaveLength(0);
  });

  it('additionally notifies a scheme-configured Manager on Commented, on top of the assignee notification', async () => {
    const { org, manager } = await seedManagerAndAdmin();
    const developer = await seedUserAndLogin(app, {
      email: 'scheme-dev-comment@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, {
      name: 'Comment Scheme Project',
    });
    await addMembers(app, manager.accessToken, project.id, [developer.userDoc.id]);

    const put = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/notification-scheme`)
      .set(...authHeader(manager.accessToken))
      .send({ rules: [{ event: 'Commented', notifyRoles: ['Manager'], channels: ['InApp'] }] });
    expect(put.status).toBe(200);
    // Regression: the PUT response (and every other project response) must actually echo back
    // notificationScheme - it was silently omitted from ProjectsService.toResponse() at first.
    expect(put.body.data.notificationScheme).toEqual([
      { event: 'Commented', notifyRoles: ['Manager'], channels: ['InApp'] },
    ]);
    const getProject = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}`)
      .set(...authHeader(manager.accessToken));
    expect(getProject.body.data.notificationScheme).toEqual([
      { event: 'Commented', notifyRoles: ['Manager'], channels: ['InApp'] },
    ]);

    const task = await createTask(app, manager.accessToken, {
      title: 'Needs review',
      project: project.id,
      priority: TaskPriority.P2,
      assignee: developer.userDoc.id,
    });
    await clearNotifications(manager.accessToken);

    await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/comments`)
      .set(...authHeader(developer.accessToken))
      .send({ body: 'left a comment' });

    const list = await api(app)
      .get(`/${API_PREFIX}/notifications`)
      .set(...authHeader(manager.accessToken));
    const schemeNotifications = list.body.data.filter(
      (n: { type: string }) => n.type === NotificationType.SCHEME,
    );
    expect(schemeNotifications).toHaveLength(1);
  });

  it('notifies a scheme-configured role on SprintStarted and SprintCompleted (events with no prior notification of any kind)', async () => {
    const { manager } = await seedManagerAndAdmin();
    // Sprint membership is owner-only (a project's `members` list only accepts active Developers,
    // and membersWithRole resolves against owner+members) - so the Manager-owner is the target
    // here; self-notification on a role a project's own owner holds is expected, not a bug (the
    // same NotifyRole automation action already behaves this way, with no self-skip).
    const project = await createProject(app, manager.accessToken, {
      name: 'Sprint Scheme Project',
    });

    await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/notification-scheme`)
      .set(...authHeader(manager.accessToken))
      .send({
        rules: [
          { event: 'SprintStarted', notifyRoles: ['Manager'], channels: ['InApp'] },
          { event: 'SprintCompleted', notifyRoles: ['Manager'], channels: ['InApp'] },
        ],
      });
    const sprint = await createSprint(app, manager.accessToken, project.id, {
      name: 'Sprint 1',
      startDate: '2026-01-01',
      endDate: '2026-01-14',
    });
    await clearNotifications(manager.accessToken);

    await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/start`)
      .set(...authHeader(manager.accessToken));

    const afterStart = await api(app)
      .get(`/${API_PREFIX}/notifications`)
      .query({ unreadOnly: true })
      .set(...authHeader(manager.accessToken));
    expect(
      afterStart.body.data.filter((n: { type: string }) => n.type === NotificationType.SCHEME),
    ).toHaveLength(1);

    await clearNotifications(manager.accessToken);
    await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/complete`)
      .set(...authHeader(manager.accessToken));

    const afterComplete = await api(app)
      .get(`/${API_PREFIX}/notifications`)
      .query({ unreadOnly: true })
      .set(...authHeader(manager.accessToken));
    expect(
      afterComplete.body.data.filter((n: { type: string }) => n.type === NotificationType.SCHEME),
    ).toHaveLength(1);
  });

  it('fires a SlaBreach scheme entry once a task has actually breached its SLA target (BRD 8)', async () => {
    const { manager } = await seedManagerAndAdmin();
    const project = await createProject(app, manager.accessToken, { name: 'SLA Scheme Project' });
    await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/notification-scheme`)
      .set(...authHeader(manager.accessToken))
      .send({ rules: [{ event: 'SlaBreach', notifyRoles: ['Manager'], channels: ['InApp'] }] });

    const task = await createTask(app, manager.accessToken, {
      title: 'Aging P1 task',
      project: project.id,
      priority: TaskPriority.P1, // default SLA policy: 8h target
    });
    await clearNotifications(manager.accessToken);

    const taskModel = app.get<Model<TaskDocument>>(getModelToken(Task.name));
    // Simulates the passage of time (100h since creation) rather than waiting for the real hourly
    // @Cron - the checker only cares about how old the still-open task is. Goes through the raw
    // MongoDB driver collection (bypassing Mongoose) since `timestamps: true` makes `createdAt`
    // immutable once set, silently ignoring a plain `updateOne` through the model.
    await taskModel.collection.updateOne(
      { _id: new Types.ObjectId(task.id) },
      { $set: { createdAt: new Date(Date.now() - 100 * 60 * 60 * 1000) } },
    );

    const tasksService = app.get(TasksService);
    await tasksService.checkSlaBreaches();

    const afterCheck = await api(app)
      .get(`/${API_PREFIX}/notifications`)
      .query({ unreadOnly: true })
      .set(...authHeader(manager.accessToken));
    expect(
      afterCheck.body.data.filter((n: { type: string }) => n.type === NotificationType.SCHEME),
    ).toHaveLength(1);

    // A second hourly run must not re-fire for the same already-notified breach.
    await clearNotifications(manager.accessToken);
    await tasksService.checkSlaBreaches();
    const afterSecondCheck = await api(app)
      .get(`/${API_PREFIX}/notifications`)
      .query({ unreadOnly: true })
      .set(...authHeader(manager.accessToken));
    expect(
      afterSecondCheck.body.data.filter(
        (n: { type: string }) => n.type === NotificationType.SCHEME,
      ),
    ).toHaveLength(0);
  });
});
