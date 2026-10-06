import { INestApplication } from '@nestjs/common';
import { CustomFieldType } from 'src/modules/projects/schemas/custom-field.schema';
import { Role } from 'src/common/enums/role.enum';
import { StatusCategory } from 'src/common/enums/status-category.enum';
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
import { api, createProject, createTask } from './setup/fixtures';

const STATUSES = [
  { name: 'Backlog', category: StatusCategory.TODO },
  { name: 'Building', category: StatusCategory.IN_PROGRESS },
  { name: 'Shipped', category: StatusCategory.DONE },
];

/** Module 12 gap-closure: multi-approver quorum, extended automation triggers, field-level audit
 * trail and the workflow dry-run (transition preview). */
describe('Module 12 gaps (integration)', () => {
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

  async function seed(requiredApprovals?: number) {
    const org = await seedOrganization(app, { name: 'm12 org', slug: 'm12-org' });
    const admin = await seedUserAndLogin(app, {
      email: 'm12-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const manager = await seedUserAndLogin(app, {
      email: 'm12-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: 'm12-dev@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, {
      name: 'M12 Project',
      memberIds: [developer.userDoc.id],
    });
    const workflow = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/workflow`)
      .set(...authHeader(manager.accessToken))
      .send({
        statuses: STATUSES,
        transitions: [
          { from: 'Backlog', to: 'Building' },
          {
            from: 'Building',
            to: 'Shipped',
            requiresApproval: true,
            approverRoles: [Role.MANAGER, Role.ADMIN],
            ...(requiredApprovals !== undefined ? { requiredApprovals } : {}),
          },
        ],
        initialStatus: 'Backlog',
      });
    expect(workflow.status).toBe(200);
    const task = await createTask(app, manager.accessToken, {
      title: 'Ship the thing',
      project: project.id,
      priority: TaskPriority.P2,
      assignee: developer.userDoc.id,
    });
    return { org, admin, manager, developer, project, task };
  }

  const setStatus = (token: string, taskId: string, status: string) =>
    api(app)
      .patch(`/${API_PREFIX}/tasks/${taskId}/status`)
      .set(...authHeader(token))
      .send({ status });
  const approve = (token: string, taskId: string) =>
    api(app)
      .post(`/${API_PREFIX}/tasks/${taskId}/approval/approve`)
      .set(...authHeader(token));
  const reject = (token: string, taskId: string) =>
    api(app)
      .post(`/${API_PREFIX}/tasks/${taskId}/approval/reject`)
      .set(...authHeader(token));
  const activity = async (token: string, taskId: string) =>
    (
      await api(app)
        .get(`/${API_PREFIX}/tasks/${taskId}/activity`)
        .query({ limit: 50 })
        .set(...authHeader(token))
    ).body.data as Array<Record<string, unknown>>;

  async function putRules(token: string, projectId: string, rules: unknown[]) {
    const res = await api(app)
      .put(`/${API_PREFIX}/projects/${projectId}/automation-rules`)
      .set(...authHeader(token))
      .send({ rules });
    expect(res.status).toBe(200);
  }

  describe('multi-approver approvals', () => {
    it('applies only after the required number of different approvers approve', async () => {
      const { admin, manager, developer, task } = await seed(2);
      await setStatus(manager.accessToken, task.id, 'Building');
      const requested = await setStatus(developer.accessToken, task.id, 'Shipped');
      expect(requested.body.data.pendingApproval).toMatchObject({
        toStatus: 'Shipped',
        requiredApprovals: 2,
        approvals: [],
      });

      const first = await approve(manager.accessToken, task.id);
      expect(first.status).toBe(201);
      expect(first.body.data.status).toBe('Building');
      expect(first.body.data.pendingApproval.approvals).toHaveLength(1);

      // The same approver can't count twice.
      expect((await approve(manager.accessToken, task.id)).status).toBe(409);

      const second = await approve(admin.accessToken, task.id);
      expect(second.body.data.status).toBe('Shipped');
      expect(second.body.data.pendingApproval).toBeNull();

      const actions = (await activity(manager.accessToken, task.id)).map((a) => a.action);
      expect(actions).toEqual(
        expect.arrayContaining(['approval_requested', 'approval_recorded', 'approval_granted']),
      );
    });

    it('any one rejection rejects, even after a partial approval', async () => {
      const { admin, manager, developer, task } = await seed(2);
      await setStatus(manager.accessToken, task.id, 'Building');
      await setStatus(developer.accessToken, task.id, 'Shipped');
      await approve(manager.accessToken, task.id);
      const rejected = await reject(admin.accessToken, task.id);
      expect(rejected.body.data).toMatchObject({ status: 'Building', pendingApproval: null });
    });

    it('defaults to one approval (unchanged behavior) and validates the count', async () => {
      const { manager, developer, project, task } = await seed();
      await setStatus(manager.accessToken, task.id, 'Building');
      await setStatus(developer.accessToken, task.id, 'Shipped');
      const approved = await approve(manager.accessToken, task.id);
      expect(approved.body.data.status).toBe('Shipped');

      const bad = await api(app)
        .put(`/${API_PREFIX}/projects/${project.id}/workflow`)
        .set(...authHeader(manager.accessToken))
        .send({
          statuses: STATUSES,
          transitions: [
            {
              from: 'Building',
              to: 'Shipped',
              requiresApproval: true,
              approverRoles: [Role.MANAGER],
              requiredApprovals: 11,
            },
          ],
          initialStatus: 'Backlog',
        });
      expect(bad.status).toBe(400);
    });
  });

  describe('extended automation triggers', () => {
    it('fires PriorityChanged (scoped by toPriority), AssigneeChanged and CommentAdded', async () => {
      const { manager, developer, project, task } = await seed();
      await putRules(manager.accessToken, project.id, [
        {
          name: 'P1 escalation',
          enabled: true,
          trigger: { type: AutomationTriggerType.PRIORITY_CHANGED, toPriority: TaskPriority.P1 },
          conditions: [],
          actions: [{ type: AutomationActionType.ADD_LABELS, value: 'escalated' }],
        },
        {
          name: 'Reassigned',
          enabled: true,
          trigger: { type: AutomationTriggerType.ASSIGNEE_CHANGED },
          conditions: [],
          actions: [{ type: AutomationActionType.ADD_LABELS, value: 'reassigned' }],
        },
        {
          name: 'Discussed',
          enabled: true,
          trigger: { type: AutomationTriggerType.COMMENT_ADDED },
          conditions: [],
          actions: [{ type: AutomationActionType.ADD_LABELS, value: 'discussed' }],
        },
      ]);

      const toP3 = await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}`)
        .set(...authHeader(manager.accessToken))
        .send({ priority: TaskPriority.P3 });
      expect(toP3.body.data.labels).toEqual([]);
      const toP1 = await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}`)
        .set(...authHeader(manager.accessToken))
        .send({ priority: TaskPriority.P1 });
      expect(toP1.body.data.labels).toEqual(['escalated']);

      const unassigned = await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}/assignee`)
        .set(...authHeader(manager.accessToken))
        .send({ assignee: null });
      expect(unassigned.body.data.labels).toEqual(['escalated', 'reassigned']);

      await api(app)
        .post(`/${API_PREFIX}/tasks/${task.id}/comments`)
        .set(...authHeader(developer.accessToken))
        .send({ body: 'Looking into it' });
      const after = await api(app)
        .get(`/${API_PREFIX}/tasks/${task.id}`)
        .set(...authHeader(manager.accessToken));
      expect(after.body.data.labels).toEqual(['escalated', 'reassigned', 'discussed']);
    });

    it('fires ApprovalRequested and ApprovalDecided (scoped by outcome)', async () => {
      const { manager, developer, project, task } = await seed();
      await putRules(manager.accessToken, project.id, [
        {
          name: 'Flag requests',
          enabled: true,
          trigger: { type: AutomationTriggerType.APPROVAL_REQUESTED },
          conditions: [],
          actions: [{ type: AutomationActionType.ADD_LABELS, value: 'awaiting-approval' }],
        },
        {
          name: 'Note rejections',
          enabled: true,
          trigger: { type: AutomationTriggerType.APPROVAL_DECIDED, approvalOutcome: 'rejected' },
          conditions: [],
          actions: [{ type: AutomationActionType.ADD_COMMENT, value: 'Rejected - please revise' }],
        },
        {
          name: 'Note approvals',
          enabled: true,
          trigger: { type: AutomationTriggerType.APPROVAL_DECIDED, approvalOutcome: 'approved' },
          conditions: [],
          actions: [{ type: AutomationActionType.ADD_LABELS, value: 'approved' }],
        },
      ]);
      await setStatus(manager.accessToken, task.id, 'Building');
      const requested = await setStatus(developer.accessToken, task.id, 'Shipped');
      expect(requested.body.data.labels).toEqual(['awaiting-approval']);

      const rejected = await reject(manager.accessToken, task.id);
      expect(rejected.body.data.labels).toEqual(['awaiting-approval']);
      const comments = await api(app)
        .get(`/${API_PREFIX}/tasks/${task.id}/comments`)
        .set(...authHeader(manager.accessToken));
      expect(comments.body.data.map((c: { body: string }) => c.body)).toEqual([
        'Rejected - please revise',
      ]);

      await setStatus(developer.accessToken, task.id, 'Shipped');
      const approved = await approve(manager.accessToken, task.id);
      expect(approved.body.data.labels).toEqual(['awaiting-approval', 'approved']);
    });

    it('rejects an invalid outcome or priority scope', async () => {
      const { manager, project } = await seed();
      const res = await api(app)
        .put(`/${API_PREFIX}/projects/${project.id}/automation-rules`)
        .set(...authHeader(manager.accessToken))
        .send({
          rules: [
            {
              name: 'Bad',
              enabled: true,
              trigger: { type: AutomationTriggerType.APPROVAL_DECIDED, approvalOutcome: 'maybe' },
              conditions: [],
              actions: [{ type: AutomationActionType.ADD_LABELS, value: 'x' }],
            },
          ],
        });
      expect(res.status).toBe(400);
    });
  });

  describe('field-level audit trail', () => {
    it('records one entry per changed field with old and new values', async () => {
      const { manager, task } = await seed();
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}`)
        .set(...authHeader(manager.accessToken))
        .send({ title: 'Ship the thing v2', labels: ['api', 'backend'], description: 'Details' });
      // Re-sending identical values records nothing.
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}`)
        .set(...authHeader(manager.accessToken))
        .send({ labels: ['api', 'backend'] });

      const fieldEntries = (await activity(manager.accessToken, task.id)).filter(
        (a) => a.action === 'updated',
      );
      expect(fieldEntries).toHaveLength(3);
      expect(fieldEntries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'title',
            from: 'Ship the thing',
            to: 'Ship the thing v2',
          }),
          expect.objectContaining({ field: 'labels', from: null, to: 'api, backend' }),
          expect.objectContaining({ field: 'description', to: 'Details' }),
        ]),
      );
    });

    it('records custom field changes and blanks values the viewer cannot see', async () => {
      const { admin, manager, developer, project, task } = await seed();
      const fields = await api(app)
        .put(`/${API_PREFIX}/projects/${project.id}/custom-fields`)
        .set(...authHeader(manager.accessToken))
        .send({ fields: [{ name: 'Budget', type: CustomFieldType.TEXT, required: false }] });
      expect(fields.status).toBe(200);
      const budget = fields.body.data.customFields[0];

      await api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}`)
        .set(...authHeader(manager.accessToken))
        .send({ customFieldValues: { [budget.id]: '50k' } });

      const scheme = await api(app)
        .post(`/${API_PREFIX}/field-permission-schemes`)
        .set(...authHeader(admin.accessToken))
        .send({
          name: 'Hide budget',
          rules: [{ fieldId: budget.id, hiddenFromRoles: [Role.DEVELOPER], readOnlyForRoles: [] }],
        });
      await api(app)
        .patch(`/${API_PREFIX}/projects/${project.id}/field-permission-scheme`)
        .set(...authHeader(admin.accessToken))
        .send({ fieldPermissionSchemeId: scheme.body.data.id });

      const managerView = (await activity(manager.accessToken, task.id)).find(
        (a) => a.field === budget.id,
      );
      expect(managerView).toMatchObject({ from: null, to: '50k' });
      const devView = (await activity(developer.accessToken, task.id)).find(
        (a) => a.field === budget.id,
      );
      expect(devView).toMatchObject({ from: null, to: null, redacted: true });
    });
  });

  describe('workflow dry-run (transition preview)', () => {
    it('lists each next status with blockers, approval needs and automations - changing nothing', async () => {
      const { manager, developer, project, task } = await seed(2);
      await putRules(manager.accessToken, project.id, [
        {
          name: 'Celebrate',
          enabled: true,
          trigger: { type: AutomationTriggerType.STATUS_CHANGED, toStatus: 'Shipped' },
          conditions: [],
          actions: [{ type: AutomationActionType.ADD_LABELS, value: 'shipped' }],
        },
      ]);
      await setStatus(manager.accessToken, task.id, 'Building');

      const preview = await api(app)
        .get(`/${API_PREFIX}/tasks/${task.id}/transitions/preview`)
        .set(...authHeader(developer.accessToken));
      expect(preview.status).toBe(200);
      expect(preview.body.data.currentStatus).toBe('Building');
      const shipped = preview.body.data.transitions.find(
        (t: { toStatus: string }) => t.toStatus === 'Shipped',
      );
      expect(shipped).toMatchObject({
        allowed: true,
        blockers: [],
        requiresApproval: true,
        requiredApprovals: 2,
        approverRoles: [Role.MANAGER, Role.ADMIN],
      });
      expect(shipped.automations).toEqual([
        expect.objectContaining({ ruleName: 'Celebrate', whenApproved: true }),
      ]);

      const after = await api(app)
        .get(`/${API_PREFIX}/tasks/${task.id}`)
        .set(...authHeader(manager.accessToken));
      expect(after.body.data).toMatchObject({ status: 'Building', pendingApproval: null });
    });

    it('explains why a move is blocked, matching what the real status change says', async () => {
      const { manager, developer, task } = await seed();
      await setStatus(manager.accessToken, task.id, 'Building');
      await setStatus(developer.accessToken, task.id, 'Shipped');

      const preview = await api(app)
        .get(`/${API_PREFIX}/tasks/${task.id}/transitions/preview`)
        .set(...authHeader(developer.accessToken));
      expect(preview.body.data.pendingApprovalTo).toBe('Shipped');
      const blocked = preview.body.data.transitions[0];
      expect(blocked.allowed).toBe(false);

      const real = await setStatus(developer.accessToken, task.id, blocked.toStatus);
      expect(real.status).toBe(409);
      expect(blocked.blockers).toContain(real.body.message);
    });
  });
});
