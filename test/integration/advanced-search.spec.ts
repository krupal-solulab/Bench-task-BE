import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { CustomFieldType } from 'src/modules/projects/schemas/custom-field.schema';
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
import { api, createProject, createSprint, createTask } from './setup/fixtures';

describe('advanced search (integration)', () => {
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
      email: 'search-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    return { org, manager };
  }

  it('a plain project/task list is unaffected by this phase (regression)', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Untouched Project' });
    await createTask(app, manager.accessToken, {
      title: 'A plain task',
      project: project.id,
      priority: TaskPriority.P2,
    });

    const res = await api(app)
      .get(`/${API_PREFIX}/tasks`)
      .set(...authHeader(manager.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('filters tasks by a Text custom field value', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'CF Search Project' });
    const put = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/custom-fields`)
      .set(...authHeader(manager.accessToken))
      .send({ fields: [{ name: 'Root Cause', type: CustomFieldType.TEXT, required: false }] });
    const field = put.body.data.customFields[0];

    await createTask(app, manager.accessToken, {
      title: 'Disk full task',
      project: project.id,
      priority: TaskPriority.P2,
      customFieldValues: { [field.id]: 'disk full' },
    });
    await createTask(app, manager.accessToken, {
      title: 'Other task',
      project: project.id,
      priority: TaskPriority.P2,
      customFieldValues: { [field.id]: 'network timeout' },
    });

    const res = await api(app)
      .get(`/${API_PREFIX}/tasks`)
      .query({ customFieldFilters: JSON.stringify([{ fieldId: field.id, value: 'disk full' }]) })
      .set(...authHeader(manager.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Disk full task');
  });

  it('filters tasks by a Dropdown custom field value', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Dropdown Project' });
    const put = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/custom-fields`)
      .set(...authHeader(manager.accessToken))
      .send({
        fields: [
          {
            name: 'Severity',
            type: CustomFieldType.DROPDOWN,
            required: false,
            options: ['Low', 'High'],
          },
        ],
      });
    const field = put.body.data.customFields[0];

    await createTask(app, manager.accessToken, {
      title: 'High severity task',
      project: project.id,
      priority: TaskPriority.P2,
      customFieldValues: { [field.id]: 'High' },
    });
    await createTask(app, manager.accessToken, {
      title: 'Low severity task',
      project: project.id,
      priority: TaskPriority.P2,
      customFieldValues: { [field.id]: 'Low' },
    });

    const res = await api(app)
      .get(`/${API_PREFIX}/tasks`)
      .query({ customFieldFilters: JSON.stringify([{ fieldId: field.id, value: 'High' }]) })
      .set(...authHeader(manager.accessToken));
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('High severity task');
  });

  it('malformed customFieldFilters JSON is silently ignored, not a 400/500', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Malformed Project' });
    await createTask(app, manager.accessToken, {
      title: 'Task',
      project: project.id,
      priority: TaskPriority.P2,
    });

    const res = await api(app)
      .get(`/${API_PREFIX}/tasks`)
      .query({ customFieldFilters: '{not valid json' })
      .set(...authHeader(manager.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('free-text search matches the issue key', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Key Search Project' });
    const task = await createTask(app, manager.accessToken, {
      title: 'Totally unrelated title',
      project: project.id,
      priority: TaskPriority.P2,
    });
    expect(task.issueKey).toEqual(expect.any(String));

    const res = await api(app)
      .get(`/${API_PREFIX}/tasks`)
      .query({ search: task.issueKey })
      .set(...authHeader(manager.accessToken));
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(task.id);
  });

  describe('GET /tasks/search (JQL-lite, Search/Dashboards v2)', () => {
    it('a multi-clause AND/OR query with ORDER BY returns the correct, correctly-ordered set', async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, { name: 'JQL Project' });

      const bugP1 = await createTask(app, manager.accessToken, {
        title: 'Bug P1',
        project: project.id,
        priority: TaskPriority.P1,
        issueType: 'Bug',
      });
      const bugP3 = await createTask(app, manager.accessToken, {
        title: 'Bug P3',
        project: project.id,
        priority: TaskPriority.P3,
        issueType: 'Bug',
      });
      await createTask(app, manager.accessToken, {
        title: 'Story P1',
        project: project.id,
        priority: TaskPriority.P1,
        issueType: 'Story',
      });

      const res = await api(app)
        .get(`/${API_PREFIX}/tasks/search`)
        .query({
          jql: `project = "${project.id}" AND issueType = Bug ORDER BY priority ASC`,
        })
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data.map((t: { id: string }) => t.id)).toEqual([bugP1.id, bugP3.id]);
    });

    it('resolves currentUser() to the caller and only matches their own tasks', async () => {
      const { org, manager } = await seedManager();
      const dev = await seedUserAndLogin(app, {
        email: 'jql-dev@example.com',
        password: 'Password123',
        role: Role.DEVELOPER,
        organizationId: org.id,
      });
      const project = await createProject(app, manager.accessToken, {
        name: 'CurrentUser Project',
      });
      await api(app)
        .post(`/${API_PREFIX}/projects/${project.id}/members`)
        .set(...authHeader(manager.accessToken))
        .send({ userIds: [dev.userDoc.id] });

      const mine = await createTask(app, manager.accessToken, {
        title: 'Assigned to dev',
        project: project.id,
        priority: TaskPriority.P2,
        assignee: dev.userDoc.id,
      });
      await createTask(app, manager.accessToken, {
        title: 'Unassigned',
        project: project.id,
        priority: TaskPriority.P2,
      });

      const res = await api(app)
        .get(`/${API_PREFIX}/tasks/search`)
        .query({ jql: 'assignee = currentUser()' })
        .set(...authHeader(dev.accessToken));
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(mine.id);
    });

    it('rejects a syntactically invalid query with 400', async () => {
      const { manager } = await seedManager();

      const res = await api(app)
        .get(`/${API_PREFIX}/tasks/search`)
        .query({ jql: 'not a valid query (((' })
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(400);
    });

    it('rejects an unknown field with 400', async () => {
      const { manager } = await seedManager();

      const res = await api(app)
        .get(`/${API_PREFIX}/tasks/search`)
        .query({ jql: 'bogus = 1' })
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(400);
    });

    it("never returns a task from a project outside the caller's accessible scope", async () => {
      const { org, manager } = await seedManager();
      const other = await seedUserAndLogin(app, {
        email: 'jql-outsider@example.com',
        password: 'Password123',
        role: Role.MANAGER,
        organizationId: org.id,
      });
      const project = await createProject(app, manager.accessToken, { name: 'Private Project' });
      await createTask(app, manager.accessToken, {
        title: 'Private task',
        project: project.id,
        priority: TaskPriority.P2,
      });

      const res = await api(app)
        .get(`/${API_PREFIX}/tasks/search`)
        .query({ jql: `project = "${project.id}"` })
        .set(...authHeader(other.accessToken));
      expect(res.body.data).toHaveLength(0);
    });

    it('resolves "sprint = current" to the project\'s active sprint', async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, { name: 'Sprint JQL Project' });
      const sprint1 = await createSprint(app, manager.accessToken, project.id, {
        name: 'Sprint 1',
        startDate: '2026-01-01',
        endDate: '2026-01-14',
      });
      const sprint2 = await createSprint(app, manager.accessToken, project.id, {
        name: 'Sprint 2',
        startDate: '2026-01-15',
        endDate: '2026-01-28',
      });
      await api(app)
        .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint1.id}/start`)
        .set(...authHeader(manager.accessToken));

      const inActiveSprint = await createTask(app, manager.accessToken, {
        title: 'In the active sprint',
        project: project.id,
        priority: TaskPriority.P2,
      });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${inActiveSprint.id}/sprint`)
        .set(...authHeader(manager.accessToken))
        .send({ sprintId: sprint1.id });

      const inOtherSprint = await createTask(app, manager.accessToken, {
        title: 'In the planned sprint',
        project: project.id,
        priority: TaskPriority.P2,
      });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${inOtherSprint.id}/sprint`)
        .set(...authHeader(manager.accessToken))
        .send({ sprintId: sprint2.id });

      const res = await api(app)
        .get(`/${API_PREFIX}/tasks/search`)
        .query({ jql: `project = "${project.id}" AND sprint = current` })
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data.map((t: { id: string }) => t.id)).toEqual([inActiveSprint.id]);
    });

    it('rejects "sprint = current" when the query is not scoped to exactly one project', async () => {
      const { manager } = await seedManager();

      const res = await api(app)
        .get(`/${API_PREFIX}/tasks/search`)
        .query({ jql: 'sprint = current' })
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(400);
    });

    it('rejects "sprint = current" when the project has no active sprint', async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, { name: 'No Active Sprint' });

      const res = await api(app)
        .get(`/${API_PREFIX}/tasks/search`)
        .query({ jql: `project = "${project.id}" AND sprint = current` })
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(400);
    });

    describe('Module 4: real JQL engine (IN / NOT IN, multi-field ORDER BY)', () => {
      it('"priority IN (...)" matches any listed value', async () => {
        const { manager } = await seedManager();
        const project = await createProject(app, manager.accessToken, { name: 'IN Project' });
        const p1 = await createTask(app, manager.accessToken, {
          title: 'P1 task',
          project: project.id,
          priority: TaskPriority.P1,
        });
        const p2 = await createTask(app, manager.accessToken, {
          title: 'P2 task',
          project: project.id,
          priority: TaskPriority.P2,
        });
        await createTask(app, manager.accessToken, {
          title: 'P3 task',
          project: project.id,
          priority: TaskPriority.P3,
        });

        const res = await api(app)
          .get(`/${API_PREFIX}/tasks/search`)
          .query({ jql: `project = "${project.id}" AND priority IN (P1, P2)` })
          .set(...authHeader(manager.accessToken));
        expect(res.status).toBe(200);
        expect(res.body.data.map((t: { id: string }) => t.id).sort()).toEqual(
          [p1.id, p2.id].sort(),
        );
      });

      it('"status NOT IN (...)" excludes every listed value', async () => {
        const { manager } = await seedManager();
        const project = await createProject(app, manager.accessToken, { name: 'NOT IN Project' });
        const todo = await createTask(app, manager.accessToken, {
          title: 'Todo task',
          project: project.id,
          priority: TaskPriority.P2,
        });
        const inProgress = await createTask(app, manager.accessToken, {
          title: 'In progress task',
          project: project.id,
          priority: TaskPriority.P2,
        });
        await api(app)
          .patch(`/${API_PREFIX}/tasks/${inProgress.id}/status`)
          .set(...authHeader(manager.accessToken))
          .send({ status: 'In Progress' });
        const done = await createTask(app, manager.accessToken, {
          title: 'Done task',
          project: project.id,
          priority: TaskPriority.P2,
        });
        await api(app)
          .patch(`/${API_PREFIX}/tasks/${done.id}/status`)
          .set(...authHeader(manager.accessToken))
          .send({ status: 'In Progress' });
        await api(app)
          .patch(`/${API_PREFIX}/tasks/${done.id}/status`)
          .set(...authHeader(manager.accessToken))
          .send({ status: 'Review' });
        await api(app)
          .patch(`/${API_PREFIX}/tasks/${done.id}/status`)
          .set(...authHeader(manager.accessToken))
          .send({ status: 'Done' });

        const res = await api(app)
          .get(`/${API_PREFIX}/tasks/search`)
          .query({ jql: `project = "${project.id}" AND status NOT IN (Done, "In Progress")` })
          .set(...authHeader(manager.accessToken));
        expect(res.status).toBe(200);
        expect(res.body.data.map((t: { id: string }) => t.id)).toEqual([todo.id]);
      });

      it('sorts by multiple ORDER BY fields, later fields breaking ties in earlier ones', async () => {
        const { manager } = await seedManager();
        const project = await createProject(app, manager.accessToken, {
          name: 'Multi-sort Project',
        });
        const p1Early = await createTask(app, manager.accessToken, {
          title: 'P1 due early',
          project: project.id,
          priority: TaskPriority.P1,
          dueDate: '2026-01-01',
        });
        const p1Late = await createTask(app, manager.accessToken, {
          title: 'P1 due late',
          project: project.id,
          priority: TaskPriority.P1,
          dueDate: '2026-06-01',
        });
        const p2 = await createTask(app, manager.accessToken, {
          title: 'P2 task',
          project: project.id,
          priority: TaskPriority.P2,
          dueDate: '2026-03-01',
        });

        const res = await api(app)
          .get(`/${API_PREFIX}/tasks/search`)
          .query({ jql: `project = "${project.id}" ORDER BY priority ASC, dueDate DESC` })
          .set(...authHeader(manager.accessToken));
        expect(res.status).toBe(200);
        expect(res.body.data.map((t: { id: string }) => t.id)).toEqual([
          p1Late.id,
          p1Early.id,
          p2.id,
        ]);
      });

      it('rejects an IN clause missing its value list with 400', async () => {
        const { manager } = await seedManager();
        const res = await api(app)
          .get(`/${API_PREFIX}/tasks/search`)
          .query({ jql: 'priority IN P1' })
          .set(...authHeader(manager.accessToken));
        expect(res.status).toBe(400);
      });
    });
  });

  describe('GET /tasks/search/autocomplete-fields (Module 4)', () => {
    it('returns field metadata and keywords, requiring no query params', async () => {
      const { manager } = await seedManager();
      const res = await api(app)
        .get(`/${API_PREFIX}/tasks/search/autocomplete-fields`)
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data.fields.length).toBeGreaterThan(0);
      const priorityField = res.body.data.fields.find(
        (f: { field: string }) => f.field === 'priority',
      );
      expect(priorityField).toMatchObject({ label: 'Priority' });
      expect(priorityField.operators).toEqual(expect.arrayContaining(['=', 'in', 'not in']));
      expect(res.body.data.keywords).toEqual(expect.arrayContaining(['AND', 'OR', 'IN']));
    });
  });

  describe('GET /tasks/search/autocomplete-values (Module 4)', () => {
    it('returns distinct, currently-in-use issueType values for the org', async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, {
        name: 'Autocomplete Project',
      });
      await createTask(app, manager.accessToken, {
        title: 'A bug',
        project: project.id,
        priority: TaskPriority.P2,
        issueType: 'Bug',
      });
      await createTask(app, manager.accessToken, {
        title: 'A task',
        project: project.id,
        priority: TaskPriority.P2,
      });

      const res = await api(app)
        .get(`/${API_PREFIX}/tasks/search/autocomplete-values`)
        .query({ field: 'issueType' })
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(expect.arrayContaining(['Bug', 'Task']));
    });

    it('rejects an unsupported field with 400', async () => {
      const { manager } = await seedManager();
      const res = await api(app)
        .get(`/${API_PREFIX}/tasks/search/autocomplete-values`)
        .query({ field: 'assignee' })
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(400);
    });

    it("scopes distinct values to the caller's own organization", async () => {
      const { manager } = await seedManager();
      const otherOrg = await seedOrganization(app);
      const otherManager = await seedUserAndLogin(app, {
        email: 'autocomplete-other-org-manager@example.com',
        password: 'Password123',
        role: Role.MANAGER,
        organizationId: otherOrg.id,
      });
      const projectA = await createProject(app, manager.accessToken, { name: 'Org A Project' });
      const projectB = await createProject(app, otherManager.accessToken, {
        name: 'Org B Project',
      });
      await createTask(app, manager.accessToken, {
        title: 'Org A task',
        project: projectA.id,
        priority: TaskPriority.P2,
        labels: ['org-a-only'],
      });
      await createTask(app, otherManager.accessToken, {
        title: 'Org B task',
        project: projectB.id,
        priority: TaskPriority.P2,
        labels: ['org-b-only'],
      });

      const res = await api(app)
        .get(`/${API_PREFIX}/tasks/search/autocomplete-values`)
        .query({ field: 'labels' })
        .set(...authHeader(manager.accessToken));
      expect(res.body.data).toContain('org-a-only');
      expect(res.body.data).not.toContain('org-b-only');
    });
  });
});
