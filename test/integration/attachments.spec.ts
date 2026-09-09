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
  TestAppContext,
} from './setup/test-app';
import { api, createProject, createTask } from './setup/fixtures';

describe('attachments (integration)', () => {
  let ctx: TestAppContext;
  let app: INestApplication;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  afterEach(async () => {
    await clearInMemoryMongo();
    ctx.fakeStorage.clear();
  });

  async function seedFixtures() {
    const org = await seedOrganization(app);
    const admin = await seedUserAndLogin(app, {
      email: 'attach-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const manager = await seedUserAndLogin(app, {
      email: 'attach-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const member = await seedUserAndLogin(app, {
      email: 'attach-member@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const nonMember = await seedUserAndLogin(app, {
      email: 'attach-nonmember@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, {
      name: 'Attachments Project',
      memberIds: [member.userDoc.id],
    });
    const task = await createTask(app, manager.accessToken, {
      title: 'Task with attachments',
      project: project.id,
      priority: TaskPriority.P2,
    });
    return { org, admin, manager, member, nonMember, project, task };
  }

  it('a project member can upload, list, and download an attachment', async () => {
    const { member, task } = await seedFixtures();

    const uploadRes = await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/attachments`)
      .set(...authHeader(member.accessToken))
      .attach('file', Buffer.from('hello world'), 'notes.txt');
    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.data.filename).toBe('notes.txt');
    expect(uploadRes.body.data.taskId).toBe(task.id);
    expect(uploadRes.body.data.storageKey).toBeUndefined();

    const listRes = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}/attachments`)
      .set(...authHeader(member.accessToken));
    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);

    const downloadRes = await api(app)
      .get(`/${API_PREFIX}/attachments/${uploadRes.body.data.id}/download`)
      .set(...authHeader(member.accessToken));
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.body.data.url).toContain('fake-storage.test');
  });

  it('a non-member gets 403 uploading, listing, or downloading', async () => {
    const { member, nonMember, task } = await seedFixtures();
    const uploaded = await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/attachments`)
      .set(...authHeader(member.accessToken))
      .attach('file', Buffer.from('hello'), 'a.txt');

    const uploadAttempt = await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/attachments`)
      .set(...authHeader(nonMember.accessToken))
      .attach('file', Buffer.from('hello'), 'b.txt');
    expect(uploadAttempt.status).toBe(403);

    const listAttempt = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}/attachments`)
      .set(...authHeader(nonMember.accessToken));
    expect(listAttempt.status).toBe(403);

    const downloadAttempt = await api(app)
      .get(`/${API_PREFIX}/attachments/${uploaded.body.data.id}/download`)
      .set(...authHeader(nonMember.accessToken));
    expect(downloadAttempt.status).toBe(403);
  });

  it('rejects blocked executable file extensions', async () => {
    const { member, task } = await seedFixtures();
    const res = await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/attachments`)
      .set(...authHeader(member.accessToken))
      .attach('file', Buffer.from('MZ'), 'virus.exe');
    expect(res.status).toBe(400);
  });

  it('the uploader can delete their own attachment; another member cannot', async () => {
    const { org, member, task } = await seedFixtures();
    const otherMember = await seedUserAndLogin(app, {
      email: 'attach-other-member@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });

    const uploaded = await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/attachments`)
      .set(...authHeader(member.accessToken))
      .attach('file', Buffer.from('hello'), 'mine.txt');

    const deleteAttempt = await api(app)
      .delete(`/${API_PREFIX}/attachments/${uploaded.body.data.id}`)
      .set(...authHeader(otherMember.accessToken));
    expect(deleteAttempt.status).toBe(403);

    const deleteRes = await api(app)
      .delete(`/${API_PREFIX}/attachments/${uploaded.body.data.id}`)
      .set(...authHeader(member.accessToken));
    expect(deleteRes.status).toBe(204);

    const listRes = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}/attachments`)
      .set(...authHeader(member.accessToken));
    expect(listRes.body.data).toHaveLength(0);
  });

  it('Admin of the same org can delete any attachment; Admin of another org gets 403', async () => {
    const { admin, member, task } = await seedFixtures();
    const otherOrg = await seedOrganization(app);
    const otherOrgAdmin = await seedUserAndLogin(app, {
      email: 'attach-other-org-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: otherOrg.id,
    });

    const uploaded = await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/attachments`)
      .set(...authHeader(member.accessToken))
      .attach('file', Buffer.from('hello'), 'shared.txt');

    const crossOrgAttempt = await api(app)
      .delete(`/${API_PREFIX}/attachments/${uploaded.body.data.id}`)
      .set(...authHeader(otherOrgAdmin.accessToken));
    expect(crossOrgAttempt.status).toBe(403);

    const deleteRes = await api(app)
      .delete(`/${API_PREFIX}/attachments/${uploaded.body.data.id}`)
      .set(...authHeader(admin.accessToken));
    expect(deleteRes.status).toBe(204);
  });
});
