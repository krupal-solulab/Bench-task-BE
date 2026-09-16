import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { StatusCategory } from 'src/common/enums/status-category.enum';
import { TaskPriority } from 'src/common/enums/task-priority.enum';
import { TaskStatus } from 'src/common/enums/task-status.enum';
import {
  API_PREFIX,
  createTestApp,
  closeTestApp,
  clearInMemoryMongo,
  seedOrganization,
  seedUserAndLogin,
  authHeader,
} from './setup/test-app';
import { addMembers, api, createProject, createSprint, createTask } from './setup/fixtures';

const CUSTOM_WORKFLOW_BODY = {
  statuses: [
    { name: 'Backlog', category: StatusCategory.TODO },
    { name: 'Building', category: StatusCategory.IN_PROGRESS },
    { name: 'Shipped', category: StatusCategory.DONE },
  ],
  transitions: [
    { from: 'Backlog', to: 'Building' },
    { from: 'Building', to: 'Shipped' },
  ],
  initialStatus: 'Backlog',
};

describe('configurable workflow engine (integration)', () => {
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
      email: 'workflow-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    return { org, manager };
  }

  it('a project with no custom workflow behaves exactly like today (regression)', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Untouched Project' });

    const workflow = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/workflow`)
      .set(...authHeader(manager.accessToken));
    expect(workflow.status).toBe(200);
    expect(workflow.body.data.initialStatus).toBe(TaskStatus.TODO);
    expect(workflow.body.data.statuses.map((s: { name: string }) => s.name)).toEqual([
      TaskStatus.TODO,
      TaskStatus.IN_PROGRESS,
      TaskStatus.REVIEW,
      TaskStatus.DONE,
    ]);

    const task = await createTask(app, manager.accessToken, {
      title: 'A plain task',
      project: project.id,
      priority: TaskPriority.P2,
    });
    expect(task.status).toBe(TaskStatus.TODO);
  });

  it('sets a custom workflow, creates a task on it, and walks it through custom transitions', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Custom Flow Project' });

    const put = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/workflow`)
      .set(...authHeader(manager.accessToken))
      .send(CUSTOM_WORKFLOW_BODY);
    expect(put.status).toBe(200);

    const task = await createTask(app, manager.accessToken, {
      title: 'Ship the feature',
      project: project.id,
      priority: TaskPriority.P2,
    });
    expect(task.status).toBe('Backlog');

    const illegal = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'Shipped' });
    expect(illegal.status).toBe(409);

    const unknown = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'Todo' });
    expect(unknown.status).toBe(400);

    const toBuilding = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'Building' });
    expect(toBuilding.status).toBe(200);
    expect(toBuilding.body.data.status).toBe('Building');

    const toShipped = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'Shipped' });
    expect(toShipped.status).toBe(200);
    expect(toShipped.body.data.status).toBe('Shipped');
    expect(toShipped.body.data.completedAt).not.toBeNull();
  });

  it('rejects an invalid workflow definition (duplicate status names)', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Invalid Workflow' });

    const res = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/workflow`)
      .set(...authHeader(manager.accessToken))
      .send({
        statuses: [
          { name: 'Todo', category: StatusCategory.TODO },
          { name: 'Todo', category: StatusCategory.TODO },
        ],
        transitions: [],
        initialStatus: 'Todo',
      });
    expect(res.status).toBe(400);
  });

  it('rejects dropping a status that an active task still holds, then allows it after moving the task off it', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Orphan Guard Project' });
    await createTask(app, manager.accessToken, {
      title: 'Still on Todo',
      project: project.id,
      priority: TaskPriority.P2,
    });

    const blocked = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/workflow`)
      .set(...authHeader(manager.accessToken))
      .send(CUSTOM_WORKFLOW_BODY);
    expect(blocked.status).toBe(409);

    // Reset attempt on a project that has no custom workflow yet is a no-op, not an error.
    const noopReset = await api(app)
      .delete(`/${API_PREFIX}/projects/${project.id}/workflow`)
      .set(...authHeader(manager.accessToken));
    expect(noopReset.status).toBe(200);
  });

  it("a sprint completes correctly under a custom workflow whose Done-category status isn't named 'Done'", async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, {
      name: 'Custom Sprint Project',
    });
    await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/workflow`)
      .set(...authHeader(manager.accessToken))
      .send(CUSTOM_WORKFLOW_BODY);

    const sprint = await createSprint(app, manager.accessToken, project.id, {
      name: 'Sprint 1',
      startDate: '2026-01-01',
      endDate: '2026-01-14',
    });
    await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/start`)
      .set(...authHeader(manager.accessToken));

    const shippedTask = await createTask(app, manager.accessToken, {
      title: 'Will be Shipped',
      project: project.id,
      priority: TaskPriority.P2,
    });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${shippedTask.id}/sprint`)
      .set(...authHeader(manager.accessToken))
      .send({ sprintId: sprint.id });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${shippedTask.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'Building' });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${shippedTask.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'Shipped' });

    const stillBuildingTask = await createTask(app, manager.accessToken, {
      title: 'Still in progress',
      project: project.id,
      priority: TaskPriority.P2,
    });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${stillBuildingTask.id}/sprint`)
      .set(...authHeader(manager.accessToken))
      .send({ sprintId: sprint.id });

    const complete = await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/sprints/${sprint.id}/complete`)
      .set(...authHeader(manager.accessToken));
    expect(complete.status).toBe(201);

    const shippedAfter = await api(app)
      .get(`/${API_PREFIX}/tasks/${shippedTask.id}`)
      .set(...authHeader(manager.accessToken));
    expect(shippedAfter.body.data.sprint.id).toBe(sprint.id);

    const stillBuildingAfter = await api(app)
      .get(`/${API_PREFIX}/tasks/${stillBuildingTask.id}`)
      .set(...authHeader(manager.accessToken));
    expect(stillBuildingAfter.body.data.sprint).toBeNull();
  });

  it("a project's stats endpoint zero-fills from its own custom workflow's status names", async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Stats Project' });
    await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/workflow`)
      .set(...authHeader(manager.accessToken))
      .send(CUSTOM_WORKFLOW_BODY);
    await createTask(app, manager.accessToken, {
      title: 'A task',
      project: project.id,
      priority: TaskPriority.P2,
    });

    const stats = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/stats`)
      .set(...authHeader(manager.accessToken));
    expect(stats.status).toBe(200);
    expect(stats.body.data.tasksByStatus).toEqual({ Backlog: 1, Building: 0, Shipped: 0 });
  });

  it('resets a project back to the system default workflow once no task holds a non-default status', async () => {
    const { manager } = await seedManager();
    const project = await createProject(app, manager.accessToken, { name: 'Reset Project' });
    await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/workflow`)
      .set(...authHeader(manager.accessToken))
      .send(CUSTOM_WORKFLOW_BODY);

    const reset = await api(app)
      .delete(`/${API_PREFIX}/projects/${project.id}/workflow`)
      .set(...authHeader(manager.accessToken));
    expect(reset.status).toBe(200);
    expect(reset.body.data.initialStatus).toBe(TaskStatus.TODO);

    const task = await createTask(app, manager.accessToken, {
      title: 'Back to default',
      project: project.id,
      priority: TaskPriority.P2,
    });
    expect(task.status).toBe(TaskStatus.TODO);
  });

  describe('per-issue-type workflows (Workflow Engine v2)', () => {
    it('sets a workflow override for Bug only; Bugs use it while other types keep the project default', async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, {
        name: 'Per-Type Workflow Project',
      });

      const put = await api(app)
        .put(`/${API_PREFIX}/projects/${project.id}/workflow?issueType=Bug`)
        .set(...authHeader(manager.accessToken))
        .send(CUSTOM_WORKFLOW_BODY);
      expect(put.status).toBe(200);
      expect(put.body.data.initialStatus).toBe('Backlog');

      const bugTask = await createTask(app, manager.accessToken, {
        title: 'A bug',
        project: project.id,
        priority: TaskPriority.P2,
        issueType: 'Bug',
      });
      expect(bugTask.status).toBe('Backlog');

      const plainTask = await createTask(app, manager.accessToken, {
        title: 'A regular task',
        project: project.id,
        priority: TaskPriority.P2,
        issueType: 'Task',
      });
      expect(plainTask.status).toBe(TaskStatus.TODO);

      const projectDefault = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/workflow`)
        .set(...authHeader(manager.accessToken));
      expect(projectDefault.body.data.initialStatus).toBe(TaskStatus.TODO);

      const bugWorkflow = await api(app)
        .get(`/${API_PREFIX}/projects/${project.id}/workflow?issueType=Bug`)
        .set(...authHeader(manager.accessToken));
      expect(bugWorkflow.body.data.initialStatus).toBe('Backlog');
    });

    it('removes only the Bug-type override on reset, leaving the project default and any other type untouched', async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, {
        name: 'Per-Type Reset Project',
      });
      await api(app)
        .put(`/${API_PREFIX}/projects/${project.id}/workflow?issueType=Bug`)
        .set(...authHeader(manager.accessToken))
        .send(CUSTOM_WORKFLOW_BODY);

      const reset = await api(app)
        .delete(`/${API_PREFIX}/projects/${project.id}/workflow?issueType=Bug`)
        .set(...authHeader(manager.accessToken));
      expect(reset.status).toBe(200);
      expect(reset.body.data.initialStatus).toBe(TaskStatus.TODO);

      const bugTask = await createTask(app, manager.accessToken, {
        title: 'A bug, now on the default workflow',
        project: project.id,
        priority: TaskPriority.P2,
        issueType: 'Bug',
      });
      expect(bugTask.status).toBe(TaskStatus.TODO);
    });
  });

  describe('transition Conditions & Validators (Workflow Engine v2)', () => {
    const ROLE_GATED_WORKFLOW = {
      statuses: CUSTOM_WORKFLOW_BODY.statuses,
      transitions: [
        { from: 'Backlog', to: 'Building' },
        { from: 'Building', to: 'Shipped', allowedRoles: [Role.ADMIN, Role.MANAGER] },
      ],
      initialStatus: 'Backlog',
    };
    const COMMENT_GATED_WORKFLOW = {
      statuses: CUSTOM_WORKFLOW_BODY.statuses,
      transitions: [
        { from: 'Backlog', to: 'Building' },
        { from: 'Building', to: 'Shipped', requireComment: true },
      ],
      initialStatus: 'Backlog',
    };

    it('Condition: rejects a transition attempted by a role not listed in allowedRoles', async () => {
      const { org, manager } = await seedManager();
      const developer = await seedUserAndLogin(app, {
        email: 'wf-condition-dev@example.com',
        password: 'Password123',
        role: Role.DEVELOPER,
        organizationId: org.id,
      });
      const project = await createProject(app, manager.accessToken, {
        name: 'Role Gated Project',
      });
      await addMembers(app, manager.accessToken, project.id, [developer.userDoc.id]);
      await api(app)
        .put(`/${API_PREFIX}/projects/${project.id}/workflow`)
        .set(...authHeader(manager.accessToken))
        .send(ROLE_GATED_WORKFLOW);
      const task = await createTask(app, manager.accessToken, {
        title: 'Gated task',
        project: project.id,
        priority: TaskPriority.P2,
        assignee: developer.userDoc.id,
      });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
        .set(...authHeader(manager.accessToken))
        .send({ status: 'Building' });

      const denied = await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
        .set(...authHeader(developer.accessToken))
        .send({ status: 'Shipped' });
      expect(denied.status).toBe(403);

      const allowed = await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
        .set(...authHeader(manager.accessToken))
        .send({ status: 'Shipped' });
      expect(allowed.status).toBe(200);
      expect(allowed.body.data.status).toBe('Shipped');
    });

    it('Validator: blocks a transition requiring a comment until one exists on the task', async () => {
      const { manager } = await seedManager();
      const project = await createProject(app, manager.accessToken, {
        name: 'Comment Gated Project',
      });
      await api(app)
        .put(`/${API_PREFIX}/projects/${project.id}/workflow`)
        .set(...authHeader(manager.accessToken))
        .send(COMMENT_GATED_WORKFLOW);
      const task = await createTask(app, manager.accessToken, {
        title: 'Needs a comment before shipping',
        project: project.id,
        priority: TaskPriority.P2,
      });
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
        .set(...authHeader(manager.accessToken))
        .send({ status: 'Building' });

      const blocked = await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
        .set(...authHeader(manager.accessToken))
        .send({ status: 'Shipped' });
      expect(blocked.status).toBe(400);

      await api(app)
        .post(`/${API_PREFIX}/tasks/${task.id}/comments`)
        .set(...authHeader(manager.accessToken))
        .send({ body: 'Verified locally, ready to ship' });

      const allowed = await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
        .set(...authHeader(manager.accessToken))
        .send({ status: 'Shipped' });
      expect(allowed.status).toBe(200);
      expect(allowed.body.data.status).toBe('Shipped');
    });
  });
});
