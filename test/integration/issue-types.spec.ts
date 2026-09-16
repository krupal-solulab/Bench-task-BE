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
import { api, createProject, createTask } from './setup/fixtures';

const DEFAULT_TYPES = [
  { name: 'Epic', level: 'epic', icon: 'Zap', color: 'purple' },
  { name: 'Story', level: 'standard', icon: 'Bookmark', color: 'green' },
  { name: 'Task', level: 'standard', icon: 'CheckSquare', color: 'blue' },
  { name: 'Bug', level: 'standard', icon: 'Bug', color: 'red' },
  { name: 'Sub-task', level: 'subtask', icon: 'ListChecks', color: 'slate' },
];

describe('issue types (integration)', () => {
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

  async function seedAdmin() {
    const org = await seedOrganization(app);
    const admin = await seedUserAndLogin(app, {
      email: 'issue-types-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    return { org, admin };
  }

  it('a fresh project resolves to the 5 built-in issue types (regression)', async () => {
    const { admin } = await seedAdmin();
    const project = await createProject(app, admin.accessToken, { name: 'Fresh Project' });
    expect(project.issueTypes).toEqual(expect.arrayContaining(DEFAULT_TYPES));
    expect(project.issueTypes).toHaveLength(5);
  });

  it('a project with no custom issue types still creates every built-in type exactly as before (regression)', async () => {
    const { admin } = await seedAdmin();
    const project = await createProject(app, admin.accessToken, { name: 'Unconfigured Project' });

    const epic = await createTask(app, admin.accessToken, {
      title: 'An epic',
      project: project.id,
      priority: 'P2',
      issueType: 'Epic',
    });
    const story = await createTask(app, admin.accessToken, {
      title: 'A story',
      project: project.id,
      priority: 'P2',
      issueType: 'Story',
      parent: epic.id,
    });
    const subtask = await createTask(app, admin.accessToken, {
      title: 'A sub-task',
      project: project.id,
      priority: 'P2',
      issueType: 'Sub-task',
      parent: story.id,
    });
    expect(subtask.parent.id).toBe(story.id);
  });

  it('rejects a Put with no Epic-level row, and rejects renaming Epic away from "Epic"', async () => {
    const { admin } = await seedAdmin();
    const project = await createProject(app, admin.accessToken, { name: 'Bad Config Project' });

    const missingEpic = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/issue-types`)
      .set(...authHeader(admin.accessToken))
      .send({ issueTypes: DEFAULT_TYPES.filter((t) => t.level !== 'epic') });
    expect(missingEpic.status).toBe(400);

    const renamedEpic = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/issue-types`)
      .set(...authHeader(admin.accessToken))
      .send({
        issueTypes: DEFAULT_TYPES.map((t) =>
          t.level === 'epic' ? { ...t, name: 'Initiative' } : t,
        ),
      });
    expect(renamedEpic.status).toBe(400);
  });

  it('adds a custom Standard-level issue type and a task can be created with it (the extensible level)', async () => {
    const { admin } = await seedAdmin();
    const project = await createProject(app, admin.accessToken, { name: 'Extensible Project' });

    const withChore = [
      ...DEFAULT_TYPES,
      { name: 'Chore', level: 'standard', icon: 'Wrench', color: 'slate' },
    ];
    const updated = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/issue-types`)
      .set(...authHeader(admin.accessToken))
      .send({ issueTypes: withChore });
    expect(updated.status).toBe(200);
    expect(updated.body.data.issueTypes).toHaveLength(6);

    const chore = await createTask(app, admin.accessToken, {
      title: 'Update dependencies',
      project: project.id,
      priority: 'P3',
      issueType: 'Chore',
    });
    expect(chore.issueType).toBe('Chore');
  });

  it('rejects removing a Standard type still in use, but allows disabling an unused one', async () => {
    const { admin } = await seedAdmin();
    const project = await createProject(app, admin.accessToken, { name: 'Orphan Check Project' });
    await createTask(app, admin.accessToken, {
      title: 'A bug',
      project: project.id,
      priority: 'P2',
      issueType: 'Bug',
    });

    const withoutBug = DEFAULT_TYPES.filter((t) => t.name !== 'Bug');
    const blocked = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/issue-types`)
      .set(...authHeader(admin.accessToken))
      .send({ issueTypes: withoutBug });
    expect(blocked.status).toBe(409);

    const withoutStory = DEFAULT_TYPES.filter((t) => t.name !== 'Story');
    const allowed = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/issue-types`)
      .set(...authHeader(admin.accessToken))
      .send({ issueTypes: withoutStory });
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.issueTypes.map((t: { name: string }) => t.name)).not.toContain(
      'Story',
    );
  });

  it('rejects creating a task with a disabled/unknown issue type', async () => {
    const { admin } = await seedAdmin();
    const project = await createProject(app, admin.accessToken, { name: 'Strict Types Project' });
    await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/issue-types`)
      .set(...authHeader(admin.accessToken))
      .send({ issueTypes: DEFAULT_TYPES.filter((t) => t.name !== 'Bug') });

    const res = await api(app)
      .post(`/${API_PREFIX}/tasks`)
      .set(...authHeader(admin.accessToken))
      .send({ title: 'A bug', project: project.id, priority: 'P2', issueType: 'Bug' });
    expect(res.status).toBe(400);
  });
});
