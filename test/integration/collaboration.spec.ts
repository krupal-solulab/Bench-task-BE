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

describe('collaboration: mentions, watchers, voting & activity history (Module 7)', () => {
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
    const manager = await seedUserAndLogin(app, {
      email: 'collab-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: 'collab-developer@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const otherDeveloper = await seedUserAndLogin(app, {
      email: 'collab-other-developer@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, {
      name: 'Collaboration Project',
      memberIds: [developer.userDoc.id, otherDeveloper.userDoc.id],
    });
    return { org, manager, developer, otherDeveloper, project };
  }

  describe('Watchers', () => {
    it('auto-watches the reporter on task creation', async () => {
      const { manager, project } = await seedFixtures();
      const task = await createTask(app, manager.accessToken, {
        title: 'Reporter watches',
        project: project.id,
        priority: TaskPriority.P2,
      });
      expect(task.watcherIds.map((u: { id: string }) => u.id)).toEqual([manager.userDoc.id]);
    });

    it('auto-watches a newly assigned user, without removing the reporter', async () => {
      const { manager, developer, project } = await seedFixtures();
      const task = await createTask(app, manager.accessToken, {
        title: 'Assignee watches too',
        project: project.id,
        priority: TaskPriority.P2,
      });

      const res = await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}/assignee`)
        .set(...authHeader(manager.accessToken))
        .send({ assignee: developer.userDoc.id });

      const watcherIds = res.body.data.watcherIds.map((u: { id: string }) => u.id).sort();
      expect(watcherIds).toEqual([developer.userDoc.id, manager.userDoc.id].sort());
    });

    it('lets a project member explicitly watch and unwatch a task', async () => {
      const { manager, otherDeveloper, project } = await seedFixtures();
      const task = await createTask(app, manager.accessToken, {
        title: 'Explicit watch',
        project: project.id,
        priority: TaskPriority.P2,
      });

      const watch = await api(app)
        .post(`/${API_PREFIX}/tasks/${task.id}/watch`)
        .set(...authHeader(otherDeveloper.accessToken));
      expect(watch.status).toBe(201);
      expect(watch.body.data.watcherIds.map((u: { id: string }) => u.id)).toContain(
        otherDeveloper.userDoc.id,
      );

      const unwatch = await api(app)
        .delete(`/${API_PREFIX}/tasks/${task.id}/watch`)
        .set(...authHeader(otherDeveloper.accessToken));
      expect(unwatch.status).toBe(200);
      expect(unwatch.body.data.watcherIds.map((u: { id: string }) => u.id)).not.toContain(
        otherDeveloper.userDoc.id,
      );
    });

    it('watching twice is a harmless no-op (idempotent)', async () => {
      const { manager, otherDeveloper, project } = await seedFixtures();
      const task = await createTask(app, manager.accessToken, {
        title: 'Idempotent watch',
        project: project.id,
        priority: TaskPriority.P2,
      });

      await api(app)
        .post(`/${API_PREFIX}/tasks/${task.id}/watch`)
        .set(...authHeader(otherDeveloper.accessToken));
      const second = await api(app)
        .post(`/${API_PREFIX}/tasks/${task.id}/watch`)
        .set(...authHeader(otherDeveloper.accessToken));

      expect(second.status).toBe(201);
      const watcherIds = second.body.data.watcherIds.map((u: { id: string }) => u.id);
      expect(watcherIds.filter((id: string) => id === otherDeveloper.userDoc.id)).toHaveLength(1);
    });

    it('notifies a watcher (who is not the assignee) when the status changes', async () => {
      const { manager, developer, otherDeveloper, project } = await seedFixtures();
      const task = await createTask(app, manager.accessToken, {
        title: 'Watched task',
        project: project.id,
        priority: TaskPriority.P2,
        assignee: developer.userDoc.id,
      });
      await api(app)
        .post(`/${API_PREFIX}/tasks/${task.id}/watch`)
        .set(...authHeader(otherDeveloper.accessToken));

      await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
        .set(...authHeader(developer.accessToken))
        .send({ status: 'In Progress' });

      const notifications = await api(app)
        .get(`/${API_PREFIX}/notifications`)
        .set(...authHeader(otherDeveloper.accessToken));
      expect(
        notifications.body.data.some((n: { type: string }) => n.type === 'WatchedTaskUpdated'),
      ).toBe(true);
    });
  });

  describe('Voting', () => {
    it('lets a user vote and unvote for a task', async () => {
      const { manager, developer, project } = await seedFixtures();
      const task = await createTask(app, manager.accessToken, {
        title: 'Vote for me',
        project: project.id,
        priority: TaskPriority.P2,
      });

      const vote = await api(app)
        .post(`/${API_PREFIX}/tasks/${task.id}/vote`)
        .set(...authHeader(developer.accessToken));
      expect(vote.status).toBe(201);
      expect(vote.body.data.voterIds.map((u: { id: string }) => u.id)).toEqual([
        developer.userDoc.id,
      ]);

      const unvote = await api(app)
        .delete(`/${API_PREFIX}/tasks/${task.id}/vote`)
        .set(...authHeader(developer.accessToken));
      expect(unvote.status).toBe(200);
      expect(unvote.body.data.voterIds).toEqual([]);
    });

    it('unvoting when not currently voted is a harmless no-op', async () => {
      const { manager, developer, project } = await seedFixtures();
      const task = await createTask(app, manager.accessToken, {
        title: 'No vote yet',
        project: project.id,
        priority: TaskPriority.P2,
      });

      const res = await api(app)
        .delete(`/${API_PREFIX}/tasks/${task.id}/vote`)
        .set(...authHeader(developer.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data.voterIds).toEqual([]);
    });

    it('rejects watch/vote from a user with no view access to the task', async () => {
      const { manager, project } = await seedFixtures();
      const task = await createTask(app, manager.accessToken, {
        title: 'Private-ish task',
        project: project.id,
        priority: TaskPriority.P2,
      });
      const otherOrg = await seedOrganization(app);
      const stranger = await seedUserAndLogin(app, {
        email: 'collab-stranger@example.com',
        password: 'Password123',
        role: Role.DEVELOPER,
        organizationId: otherOrg.id,
      });

      const res = await api(app)
        .post(`/${API_PREFIX}/tasks/${task.id}/vote`)
        .set(...authHeader(stranger.accessToken));
      expect(res.status).toBe(403);
    });
  });

  describe('Mentions', () => {
    it('extracts a mention from comment markup, notifies the mentioned user, and returns it populated', async () => {
      const { manager, developer, otherDeveloper, project } = await seedFixtures();
      const task = await createTask(app, manager.accessToken, {
        title: 'Mention task',
        project: project.id,
        priority: TaskPriority.P2,
      });

      const comment = await api(app)
        .post(`/${API_PREFIX}/tasks/${task.id}/comments`)
        .set(...authHeader(developer.accessToken))
        .send({ body: `Hey @[Other Dev](${otherDeveloper.userDoc.id}) can you check this?` });
      expect(comment.status).toBe(201);
      expect(comment.body.data.mentionedUserIds.map((u: { id: string }) => u.id)).toEqual([
        otherDeveloper.userDoc.id,
      ]);

      const notifications = await api(app)
        .get(`/${API_PREFIX}/notifications`)
        .set(...authHeader(otherDeveloper.accessToken));
      expect(notifications.body.data.some((n: { type: string }) => n.type === 'Mentioned')).toBe(
        true,
      );
    });

    it('silently drops a mention referencing a user outside the organization', async () => {
      const { manager, developer, project } = await seedFixtures();
      const task = await createTask(app, manager.accessToken, {
        title: 'Bad mention',
        project: project.id,
        priority: TaskPriority.P2,
      });

      const comment = await api(app)
        .post(`/${API_PREFIX}/tasks/${task.id}/comments`)
        .set(...authHeader(developer.accessToken))
        .send({ body: 'Hey @[Ghost](507f1f77bcf86cd799439099) are you real?' });
      expect(comment.status).toBe(201);
      expect(comment.body.data.mentionedUserIds).toEqual([]);
    });

    it('does not notify the author for self-mentioning', async () => {
      const { manager, developer, project } = await seedFixtures();
      const task = await createTask(app, manager.accessToken, {
        title: 'Self mention',
        project: project.id,
        priority: TaskPriority.P2,
      });

      await api(app)
        .post(`/${API_PREFIX}/tasks/${task.id}/comments`)
        .set(...authHeader(developer.accessToken))
        .send({ body: `Note to self @[Me](${developer.userDoc.id})` });

      const notifications = await api(app)
        .get(`/${API_PREFIX}/notifications`)
        .set(...authHeader(developer.accessToken));
      expect(notifications.body.data.some((n: { type: string }) => n.type === 'Mentioned')).toBe(
        false,
      );
    });
  });

  describe('Activity History', () => {
    it('logs a COMMENTED activity entry when a comment is created', async () => {
      const { manager, project } = await seedFixtures();
      const task = await createTask(app, manager.accessToken, {
        title: 'Commented task',
        project: project.id,
        priority: TaskPriority.P2,
      });

      await api(app)
        .post(`/${API_PREFIX}/tasks/${task.id}/comments`)
        .set(...authHeader(manager.accessToken))
        .send({ body: 'First comment' });

      const activity = await api(app)
        .get(`/${API_PREFIX}/tasks/${task.id}/activity`)
        .set(...authHeader(manager.accessToken));
      expect(
        activity.body.data.some((entry: { action: string }) => entry.action === 'commented'),
      ).toBe(true);
    });
  });
});
