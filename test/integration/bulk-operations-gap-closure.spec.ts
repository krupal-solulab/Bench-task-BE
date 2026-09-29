import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role } from 'src/common/enums/role.enum';
import { IssueType } from 'src/common/enums/issue-type.enum';
import { TaskPriority } from 'src/common/enums/task-priority.enum';
import { CustomFieldType } from 'src/modules/projects/schemas/custom-field.schema';
import {
  BulkOperationLog,
  BulkOperationLogDocument,
} from 'src/modules/tasks/schemas/bulk-operation-log.schema';
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

describe('bulk operations gap-closure: fix-version/custom-field/move-project/preview/undo (Module 5)', () => {
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
      email: 'bulk5b-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: 'bulk5b-developer@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, {
      name: 'Bulk5b Project',
      memberIds: [developer.userDoc.id],
    });
    return { org, manager, developer, project };
  }

  async function createRelease(token: string, projectId: string, name: string) {
    const res = await api(app)
      .post(`/${API_PREFIX}/projects/${projectId}/releases`)
      .set(...authHeader(token))
      .send({ name });
    if (res.status !== 201) {
      throw new Error(`createRelease failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body.data;
  }

  async function addTextCustomField(token: string, projectId: string) {
    const res = await api(app)
      .put(`/${API_PREFIX}/projects/${projectId}/custom-fields`)
      .set(...authHeader(token))
      .send({ fields: [{ name: 'Root Cause', type: CustomFieldType.TEXT, required: false }] });
    if (res.status !== 200) {
      throw new Error(`addTextCustomField failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body.data.customFields[0];
  }

  describe('bulk-fix-version', () => {
    it('adds a fix version to multiple tasks, unioned with any it already had', async () => {
      const { manager, project } = await seedFixtures();
      const release = await createRelease(manager.accessToken, project.id, 'v1.0.0');
      const taskA = await createTask(app, manager.accessToken, {
        title: 'Task A',
        project: project.id,
        priority: TaskPriority.P2,
      });
      const taskB = await createTask(app, manager.accessToken, {
        title: 'Task B',
        project: project.id,
        priority: TaskPriority.P2,
      });

      const res = await api(app)
        .patch(`/${API_PREFIX}/tasks/bulk-fix-version`)
        .set(...authHeader(manager.accessToken))
        .send({ taskIds: [taskA.id, taskB.id], fixVersions: [release.id] });
      expect(res.status).toBe(200);
      expect(res.body.data.succeeded).toEqual(expect.arrayContaining([taskA.id, taskB.id]));
      expect(res.body.data.undoToken).toEqual(expect.any(String));

      const detailA = await api(app)
        .get(`/${API_PREFIX}/tasks/${taskA.id}`)
        .set(...authHeader(manager.accessToken));
      expect(detailA.body.data.fixVersions.map((v: { id: string }) => v.id)).toEqual([release.id]);
    });

    it("rejects a release id that does not belong to the task's project, per-task", async () => {
      const { manager, project } = await seedFixtures();
      const otherProject = await createProject(app, manager.accessToken, { name: 'Other Project' });
      const foreignRelease = await createRelease(manager.accessToken, otherProject.id, 'v9.9.9');
      const taskA = await createTask(app, manager.accessToken, {
        title: 'Task A',
        project: project.id,
        priority: TaskPriority.P2,
      });

      const res = await api(app)
        .patch(`/${API_PREFIX}/tasks/bulk-fix-version`)
        .set(...authHeader(manager.accessToken))
        .send({ taskIds: [taskA.id], fixVersions: [foreignRelease.id] });
      expect(res.status).toBe(200);
      expect(res.body.data.succeeded).toEqual([]);
      expect(res.body.data.failed).toHaveLength(1);
    });
  });

  describe('bulk-custom-field', () => {
    it('sets one custom field to one value across multiple tasks', async () => {
      const { manager, project } = await seedFixtures();
      const field = await addTextCustomField(manager.accessToken, project.id);
      const taskA = await createTask(app, manager.accessToken, {
        title: 'Task A',
        project: project.id,
        priority: TaskPriority.P2,
      });
      const taskB = await createTask(app, manager.accessToken, {
        title: 'Task B',
        project: project.id,
        priority: TaskPriority.P2,
      });

      const res = await api(app)
        .patch(`/${API_PREFIX}/tasks/bulk-custom-field`)
        .set(...authHeader(manager.accessToken))
        .send({ taskIds: [taskA.id, taskB.id], fieldId: field.id, value: 'Disk full' });
      expect(res.status).toBe(200);
      expect(res.body.data.succeeded).toEqual(expect.arrayContaining([taskA.id, taskB.id]));

      const detailB = await api(app)
        .get(`/${API_PREFIX}/tasks/${taskB.id}`)
        .set(...authHeader(manager.accessToken));
      expect(detailB.body.data.customFieldValues[field.id]).toBe('Disk full');
    });
  });

  describe('bulk-status/preview', () => {
    it('reports which tasks would succeed/fail without changing anything', async () => {
      const { manager, project } = await seedFixtures();
      const taskA = await createTask(app, manager.accessToken, {
        title: 'Task A',
        project: project.id,
        priority: TaskPriority.P2,
      });

      const res = await api(app)
        .post(`/${API_PREFIX}/tasks/bulk-status/preview`)
        .set(...authHeader(manager.accessToken))
        .send({ taskIds: [taskA.id], status: 'In Progress' });
      expect(res.status).toBe(201);
      expect(res.body.data.willSucceedCount).toBe(1);
      expect(res.body.data.willFailCount).toBe(0);
      expect(res.body.data.entries[0]).toMatchObject({ taskId: taskA.id, willSucceed: true });

      const badRes = await api(app)
        .post(`/${API_PREFIX}/tasks/bulk-status/preview`)
        .set(...authHeader(manager.accessToken))
        .send({ taskIds: [taskA.id], status: 'Not A Real Status' });
      expect(badRes.status).toBe(201);
      expect(badRes.body.data.willSucceedCount).toBe(0);
      expect(badRes.body.data.willFailCount).toBe(1);
      expect(badRes.body.data.entries[0].reason).toMatch(/not a valid status/);

      // Neither preview call actually mutated the task.
      const detail = await api(app)
        .get(`/${API_PREFIX}/tasks/${taskA.id}`)
        .set(...authHeader(manager.accessToken));
      expect(detail.body.data.status).not.toBe('In Progress');
    });
  });

  describe('move-project (single task)', () => {
    it('moves a task to another project, regenerating its key and resetting per-project fields', async () => {
      const { manager, project } = await seedFixtures();
      const targetProject = await createProject(app, manager.accessToken, {
        name: 'Target Project',
      });
      const task = await createTask(app, manager.accessToken, {
        title: 'Movable task',
        project: project.id,
        priority: TaskPriority.P2,
      });

      const res = await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}/move-project`)
        .set(...authHeader(manager.accessToken))
        .send({ targetProjectId: targetProject.id });
      expect(res.status).toBe(200);
      expect(res.body.data.project.id ?? res.body.data.project).toBe(targetProject.id);
      expect(res.body.data.issueKey).not.toBe(task.issueKey);
      expect(res.body.data.sprint).toBeNull();
      expect(res.body.data.fixVersions).toEqual([]);
    });

    it('rejects moving a task into the project it is already in', async () => {
      const { manager, project } = await seedFixtures();
      const task = await createTask(app, manager.accessToken, {
        title: 'Task A',
        project: project.id,
        priority: TaskPriority.P2,
      });

      const res = await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}/move-project`)
        .set(...authHeader(manager.accessToken))
        .send({ targetProjectId: project.id });
      expect(res.status).toBe(400);
    });

    it('rejects moving a task that has children', async () => {
      const { manager, project } = await seedFixtures();
      const targetProject = await createProject(app, manager.accessToken, {
        name: 'Target Project',
      });
      const epic = await createTask(app, manager.accessToken, {
        title: 'Epic with a child',
        project: project.id,
        priority: TaskPriority.P1,
        issueType: IssueType.EPIC,
      });
      await createTask(app, manager.accessToken, {
        title: 'Child story',
        project: project.id,
        priority: TaskPriority.P2,
        issueType: IssueType.STORY,
        parent: epic.id,
      });

      const res = await api(app)
        .patch(`/${API_PREFIX}/tasks/${epic.id}/move-project`)
        .set(...authHeader(manager.accessToken))
        .send({ targetProjectId: targetProject.id });
      expect(res.status).toBe(409);
    });

    it('rejects the move for a Developer with no manage grant on the source project', async () => {
      const { manager, developer, project } = await seedFixtures();
      const targetProject = await createProject(app, manager.accessToken, {
        name: 'Target Project',
      });
      const task = await createTask(app, manager.accessToken, {
        title: 'Task A',
        project: project.id,
        priority: TaskPriority.P2,
      });

      const res = await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}/move-project`)
        .set(...authHeader(developer.accessToken))
        .send({ targetProjectId: targetProject.id });
      expect(res.status).toBe(403);
    });
  });

  describe('bulk-move-project', () => {
    it('moves multiple tasks to another project, partial-success style', async () => {
      const { manager, project } = await seedFixtures();
      const targetProject = await createProject(app, manager.accessToken, {
        name: 'Target Project',
      });
      const taskA = await createTask(app, manager.accessToken, {
        title: 'Task A',
        project: project.id,
        priority: TaskPriority.P2,
      });
      const taskB = await createTask(app, manager.accessToken, {
        title: 'Task B',
        project: project.id,
        priority: TaskPriority.P2,
      });

      const res = await api(app)
        .patch(`/${API_PREFIX}/tasks/bulk-move-project`)
        .set(...authHeader(manager.accessToken))
        .send({ taskIds: [taskA.id, taskB.id], targetProjectId: targetProject.id });
      expect(res.status).toBe(200);
      expect(res.body.data.succeeded).toEqual(expect.arrayContaining([taskA.id, taskB.id]));

      const detailA = await api(app)
        .get(`/${API_PREFIX}/tasks/${taskA.id}`)
        .set(...authHeader(manager.accessToken));
      expect(detailA.body.data.project.id ?? detailA.body.data.project).toBe(targetProject.id);
    });
  });

  describe('undo window', () => {
    it('undoes a bulk-priority change, restoring the previous priority', async () => {
      const { manager, project } = await seedFixtures();
      const taskA = await createTask(app, manager.accessToken, {
        title: 'Task A',
        project: project.id,
        priority: TaskPriority.P3,
      });

      const bulkRes = await api(app)
        .patch(`/${API_PREFIX}/tasks/bulk-priority`)
        .set(...authHeader(manager.accessToken))
        .send({ taskIds: [taskA.id], priority: TaskPriority.P1 });
      expect(bulkRes.status).toBe(200);
      const undoToken = bulkRes.body.data.undoToken;
      expect(undoToken).toEqual(expect.any(String));

      const undoRes = await api(app)
        .post(`/${API_PREFIX}/tasks/bulk-operations/${undoToken}/undo`)
        .set(...authHeader(manager.accessToken));
      expect(undoRes.status).toBe(201);
      expect(undoRes.body.data.succeeded).toEqual([taskA.id]);

      const detail = await api(app)
        .get(`/${API_PREFIX}/tasks/${taskA.id}`)
        .set(...authHeader(manager.accessToken));
      expect(detail.body.data.priority).toBe(TaskPriority.P3);
    });

    it('undoes a bulk-delete, restoring the task to the active list', async () => {
      const { manager, project } = await seedFixtures();
      const taskA = await createTask(app, manager.accessToken, {
        title: 'Task A',
        project: project.id,
        priority: TaskPriority.P2,
      });

      const bulkRes = await api(app)
        .patch(`/${API_PREFIX}/tasks/bulk-delete`)
        .set(...authHeader(manager.accessToken))
        .send({ taskIds: [taskA.id] });
      const undoToken = bulkRes.body.data.undoToken;

      const deletedCheck = await api(app)
        .get(`/${API_PREFIX}/tasks/${taskA.id}`)
        .set(...authHeader(manager.accessToken));
      expect(deletedCheck.status).toBe(404);

      const undoRes = await api(app)
        .post(`/${API_PREFIX}/tasks/bulk-operations/${undoToken}/undo`)
        .set(...authHeader(manager.accessToken));
      expect(undoRes.status).toBe(201);
      expect(undoRes.body.data.succeeded).toEqual([taskA.id]);

      const restoredCheck = await api(app)
        .get(`/${API_PREFIX}/tasks/${taskA.id}`)
        .set(...authHeader(manager.accessToken));
      expect(restoredCheck.status).toBe(200);
    });

    it('rejects undoing the same log twice', async () => {
      const { manager, project } = await seedFixtures();
      const taskA = await createTask(app, manager.accessToken, {
        title: 'Task A',
        project: project.id,
        priority: TaskPriority.P3,
      });
      const bulkRes = await api(app)
        .patch(`/${API_PREFIX}/tasks/bulk-priority`)
        .set(...authHeader(manager.accessToken))
        .send({ taskIds: [taskA.id], priority: TaskPriority.P1 });
      const undoToken = bulkRes.body.data.undoToken;

      const first = await api(app)
        .post(`/${API_PREFIX}/tasks/bulk-operations/${undoToken}/undo`)
        .set(...authHeader(manager.accessToken));
      expect(first.status).toBe(201);

      const second = await api(app)
        .post(`/${API_PREFIX}/tasks/bulk-operations/${undoToken}/undo`)
        .set(...authHeader(manager.accessToken));
      expect(second.status).toBe(409);
    });

    it('rejects undoing a log whose undo window has expired', async () => {
      const { manager, project } = await seedFixtures();
      const taskA = await createTask(app, manager.accessToken, {
        title: 'Task A',
        project: project.id,
        priority: TaskPriority.P3,
      });
      const bulkRes = await api(app)
        .patch(`/${API_PREFIX}/tasks/bulk-priority`)
        .set(...authHeader(manager.accessToken))
        .send({ taskIds: [taskA.id], priority: TaskPriority.P1 });
      const undoToken = bulkRes.body.data.undoToken;

      // Simulates the passage of time (6 minutes, past the 5-minute undo window) rather than
      // waiting for real time to elapse - mirrors automation-engine.spec.ts's direct-model-write
      // pattern for time-dependent checks.
      // Mongoose's `timestamps` plugin otherwise silently strips/no-ops a manually-set `createdAt`
      // on a Model-level updateOne (it only ever sets createdAt via $setOnInsert) - going through
      // the raw driver collection bypasses that middleware entirely so the backdated value sticks.
      const logModel = app.get<Model<BulkOperationLogDocument>>(
        getModelToken(BulkOperationLog.name),
      );
      await logModel.collection.updateOne(
        { _id: new Types.ObjectId(undoToken) },
        { $set: { createdAt: new Date(Date.now() - 6 * 60 * 1000) } },
      );

      const res = await api(app)
        .post(`/${API_PREFIX}/tasks/bulk-operations/${undoToken}/undo`)
        .set(...authHeader(manager.accessToken));
      expect(res.status).toBe(409);
    });

    it('returns 404 undoing a log id from a different organization', async () => {
      const { manager, project } = await seedFixtures();
      const taskA = await createTask(app, manager.accessToken, {
        title: 'Task A',
        project: project.id,
        priority: TaskPriority.P3,
      });
      const bulkRes = await api(app)
        .patch(`/${API_PREFIX}/tasks/bulk-priority`)
        .set(...authHeader(manager.accessToken))
        .send({ taskIds: [taskA.id], priority: TaskPriority.P1 });
      const undoToken = bulkRes.body.data.undoToken;

      const otherOrg = await seedOrganization(app);
      const otherManager = await seedUserAndLogin(app, {
        email: 'bulk5b-other-manager@example.com',
        password: 'Password123',
        role: Role.MANAGER,
        organizationId: otherOrg.id,
      });

      const res = await api(app)
        .post(`/${API_PREFIX}/tasks/bulk-operations/${undoToken}/undo`)
        .set(...authHeader(otherManager.accessToken));
      expect(res.status).toBe(404);
    });
  });
});
