import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { TaskPriority } from 'src/common/enums/task-priority.enum';
import {
  AutomationActionType,
  AutomationTriggerType,
} from 'src/modules/projects/schemas/automation-rule.schema';
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

describe('automation engine (integration)', () => {
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
      email: 'automation-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    return { org, manager };
  }

  async function seedDeveloper(orgId: string, email = 'automation-dev@example.com') {
    return seedUserAndLogin(app, {
      email,
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: orgId,
    });
  }

  it('a project with no automation rules behaves identically to today (regression)', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Untouched Project' });
    expect(project.automationRules).toEqual([]);

    const task = await createTask(app, manager.accessToken, {
      title: 'A plain task',
      project: project.id,
      priority: TaskPriority.P2,
    });
    expect(task.labels).toEqual([]);
  });

  it('rejects a StatusChanged trigger targeting a status outside the workflow', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Bad Rule Project' });

    const res = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/automation-rules`)
      .set(...authHeader(manager.accessToken))
      .send({
        rules: [
          {
            name: 'Bad status',
            enabled: true,
            trigger: { type: AutomationTriggerType.STATUS_CHANGED, toStatus: 'Nonexistent' },
            conditions: [],
            actions: [{ type: AutomationActionType.ADD_LABELS, value: 'x' }],
          },
        ],
      });
    expect(res.status).toBe(400);
  });

  it("creating a task fires an IssueCreated rule's AddLabels and AddComment actions", async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Auto Label Project' });

    const put = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/automation-rules`)
      .set(...authHeader(manager.accessToken))
      .send({
        rules: [
          {
            name: 'Welcome new issues',
            enabled: true,
            trigger: { type: AutomationTriggerType.ISSUE_CREATED },
            conditions: [],
            actions: [
              { type: AutomationActionType.ADD_LABELS, value: 'triage' },
              { type: AutomationActionType.ADD_COMMENT, value: 'Thanks for filing {{title}}!' },
            ],
          },
        ],
      });
    expect(put.status).toBe(200);

    const task = await createTask(app, manager.accessToken, {
      title: 'New bug report',
      project: project.id,
      priority: TaskPriority.P2,
    });
    expect(task.labels).toEqual(['triage']);

    const comments = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}/comments`)
      .set(...authHeader(manager.accessToken));
    expect(comments.body.data).toHaveLength(1);
    expect(comments.body.data[0].body).toBe('Thanks for filing New bug report!');
  });

  it("a Developer's status change fires a StatusChanged rule that reassigns the task, despite the Developer normally lacking reassign permission", async () => {
    const { org, manager } = await seedManager();
    const developer = await seedDeveloper(org.id, 'assignee-dev@example.com');
    const qaLead = await seedDeveloper(org.id, 'qa-lead@example.com');
    const project = await createProject(app, manager.accessToken, {
      name: 'Auto Reassign Project',
    });
    await addMembers(app, manager.accessToken, project.id, [
      developer.userDoc.id,
      qaLead.userDoc.id,
    ]);

    await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/automation-rules`)
      .set(...authHeader(manager.accessToken))
      .send({
        rules: [
          {
            name: 'Route to QA on Review',
            enabled: true,
            trigger: { type: AutomationTriggerType.STATUS_CHANGED, toStatus: 'Review' },
            conditions: [],
            actions: [{ type: AutomationActionType.SET_ASSIGNEE, value: qaLead.userDoc.id }],
          },
        ],
      });

    const task = await createTask(app, manager.accessToken, {
      title: 'Needs QA routing',
      project: project.id,
      priority: TaskPriority.P2,
      assignee: developer.userDoc.id,
    });

    // The default workflow requires Todo -> In Progress -> Review; the Developer drives both
    // legal transitions themselves (they're the assignee) - but could never reassign a task
    // themselves (that route is Admin/Manager only). The automation's bypass is what lets the
    // resulting reassignment on the second transition happen at all.
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(developer.accessToken))
      .send({ status: 'In Progress' });
    const statusChange = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(developer.accessToken))
      .send({ status: 'Review' });
    expect(statusChange.status).toBe(200);

    const updatedTask = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(manager.accessToken));
    expect(updatedTask.body.data.assignee.id).toBe(qaLead.userDoc.id);

    const activity = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}/activity`)
      .set(...authHeader(manager.accessToken));
    const reassignEntry = activity.body.data.find(
      (e: { action: string }) => e.action === 'reassigned',
    );
    expect(reassignEntry.viaAutomationRule).toBe('Route to QA on Review');
  });

  it('an automation action that would be an illegal transition is skipped, and the triggering status change still succeeds', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Bad Action Project' });

    await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/automation-rules`)
      .set(...authHeader(manager.accessToken))
      .send({
        rules: [
          {
            name: 'Jump straight to Done',
            enabled: true,
            trigger: { type: AutomationTriggerType.STATUS_CHANGED, toStatus: 'In Progress' },
            conditions: [],
            // Not a legal transition from In Progress in the default workflow.
            actions: [{ type: AutomationActionType.SET_STATUS, value: 'Done' }],
          },
        ],
      });

    const task = await createTask(app, manager.accessToken, {
      title: 'Task',
      project: project.id,
      priority: TaskPriority.P2,
    });

    const statusChange = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'In Progress' });
    expect(statusChange.status).toBe(200);
    expect(statusChange.body.data.status).toBe('In Progress');
  });
});
