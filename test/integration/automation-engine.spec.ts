import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Role } from 'src/common/enums/role.enum';
import { IssueType } from 'src/common/enums/issue-type.enum';
import { TaskPriority } from 'src/common/enums/task-priority.enum';
import {
  AutomationActionType,
  AutomationTriggerType,
} from 'src/modules/projects/schemas/automation-rule.schema';
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

  it("persists a StatusChanged rule's fromStatus and only fires it from that source status (regression: fromStatus was validated on save but silently dropped, so it always matched any source)", async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'FromStatus Project' });

    await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/workflow`)
      .set(...authHeader(manager.accessToken))
      .send({
        statuses: [
          { name: 'Todo', category: 'To Do' },
          { name: 'InProgress', category: 'In Progress' },
          { name: 'Blocked', category: 'In Progress' },
          { name: 'Done', category: 'Done' },
        ],
        transitions: [
          { from: 'Todo', to: 'InProgress' },
          { from: 'Todo', to: 'Blocked' },
          { from: 'InProgress', to: 'Done' },
          { from: 'Blocked', to: 'Done' },
        ],
        initialStatus: 'Todo',
      });

    await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/automation-rules`)
      .set(...authHeader(manager.accessToken))
      .send({
        rules: [
          {
            name: 'Only from InProgress',
            enabled: true,
            trigger: {
              type: AutomationTriggerType.STATUS_CHANGED,
              toStatus: 'Done',
              fromStatus: 'InProgress',
            },
            conditions: [],
            actions: [{ type: AutomationActionType.ADD_LABELS, value: 'from-in-progress' }],
          },
        ],
      });

    const viaInProgress = await createTask(app, manager.accessToken, {
      title: 'Via InProgress',
      project: project.id,
      priority: TaskPriority.P2,
    });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${viaInProgress.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'InProgress' });
    const doneViaInProgress = await api(app)
      .patch(`/${API_PREFIX}/tasks/${viaInProgress.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'Done' });
    expect(doneViaInProgress.body.data.labels).toContain('from-in-progress');

    const viaBlocked = await createTask(app, manager.accessToken, {
      title: 'Via Blocked',
      project: project.id,
      priority: TaskPriority.P2,
    });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${viaBlocked.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'Blocked' });
    const doneViaBlocked = await api(app)
      .patch(`/${API_PREFIX}/tasks/${viaBlocked.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'Done' });
    expect(doneViaBlocked.body.data.labels).not.toContain('from-in-progress');
  });

  async function moveToDone(app: INestApplication, token: string, taskId: string) {
    for (const status of ['In Progress', 'Review', 'Done']) {
      const res = await api(app)
        .patch(`/${API_PREFIX}/tasks/${taskId}/status`)
        .set(...authHeader(token))
        .send({ status });
      expect(res.status).toBe(200);
    }
  }

  it('an AllSubtasksDone rule fires on the PARENT once every sub-task reaches Done', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Cross-Issue Project' });

    await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/automation-rules`)
      .set(...authHeader(manager.accessToken))
      .send({
        rules: [
          {
            name: 'Ready for release',
            enabled: true,
            trigger: { type: AutomationTriggerType.ALL_SUBTASKS_DONE },
            conditions: [],
            actions: [{ type: AutomationActionType.ADD_LABELS, value: 'ready-for-release' }],
          },
        ],
      });

    const story = await createTask(app, manager.accessToken, {
      title: 'Parent story',
      project: project.id,
      priority: TaskPriority.P2,
      issueType: IssueType.STORY,
    });
    const subtaskA = await createTask(app, manager.accessToken, {
      title: 'Sub-task A',
      project: project.id,
      priority: TaskPriority.P2,
      issueType: IssueType.SUBTASK,
      parent: story.id,
    });
    const subtaskB = await createTask(app, manager.accessToken, {
      title: 'Sub-task B',
      project: project.id,
      priority: TaskPriority.P2,
      issueType: IssueType.SUBTASK,
      parent: story.id,
    });

    await moveToDone(app, manager.accessToken, subtaskA.id);
    const storyAfterFirstSubtask = await api(app)
      .get(`/${API_PREFIX}/tasks/${story.id}`)
      .set(...authHeader(manager.accessToken));
    expect(storyAfterFirstSubtask.body.data.labels).not.toContain('ready-for-release');

    await moveToDone(app, manager.accessToken, subtaskB.id);
    const storyAfterAllSubtasks = await api(app)
      .get(`/${API_PREFIX}/tasks/${story.id}`)
      .set(...authHeader(manager.accessToken));
    expect(storyAfterAllSubtasks.body.data.labels).toContain('ready-for-release');
  });

  it('an UnassignedForDuration rule fires once a task has been unassigned past its threshold, and never refires the same episode', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Idle Task Project' });

    await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/automation-rules`)
      .set(...authHeader(manager.accessToken))
      .send({
        rules: [
          {
            name: 'Escalate idle tasks',
            enabled: true,
            trigger: { type: AutomationTriggerType.UNASSIGNED_FOR_DURATION, afterHours: 24 },
            conditions: [],
            actions: [{ type: AutomationActionType.ADD_LABELS, value: 'stale' }],
          },
        ],
      });

    const task = await createTask(app, manager.accessToken, {
      title: 'Idle since creation',
      project: project.id,
      priority: TaskPriority.P2,
    });

    const taskModel = app.get<Model<TaskDocument>>(getModelToken(Task.name));
    // Simulates the passage of time (25h since it became unassigned) rather than waiting for the
    // real hourly @Cron - the trigger only cares about `assigneeClearedAt`'s age.
    await taskModel.updateOne(
      { _id: task.id },
      { assigneeClearedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    );

    const tasksService = app.get(TasksService);
    await tasksService.checkUnassignedForDurationRules();

    const afterFirstCheck = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(manager.accessToken));
    expect(afterFirstCheck.body.data.labels).toContain('stale');

    // A second hourly run for the same still-unassigned episode must not re-fire the rule (no
    // duplicate label entries, no duplicate automation-log entry).
    await tasksService.checkUnassignedForDurationRules();
    const afterSecondCheck = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(manager.accessToken));
    expect(afterSecondCheck.body.data.labels).toEqual(['stale']);
  });

  it("exposes every fired rule's outcome through GET projects/:id/automation-log", async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Audit Log Project' });

    await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/automation-rules`)
      .set(...authHeader(manager.accessToken))
      .send({
        rules: [
          {
            name: 'Welcome new issues',
            enabled: true,
            trigger: { type: AutomationTriggerType.ISSUE_CREATED },
            conditions: [],
            actions: [{ type: AutomationActionType.ADD_LABELS, value: 'triage' }],
          },
        ],
      });

    const task = await createTask(app, manager.accessToken, {
      title: 'Logged task',
      project: project.id,
      priority: TaskPriority.P2,
    });

    const log = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/automation-log`)
      .set(...authHeader(manager.accessToken));
    expect(log.status).toBe(200);
    expect(log.body.data).toHaveLength(1);
    expect(log.body.data[0]).toMatchObject({
      ruleName: 'Welcome new issues',
      triggerType: AutomationTriggerType.ISSUE_CREATED,
      outcome: 'success',
    });
    expect(log.body.data[0].task.id).toBe(task.id);
  });
});
