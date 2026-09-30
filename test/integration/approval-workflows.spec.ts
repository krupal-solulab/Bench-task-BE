import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { StatusCategory } from 'src/common/enums/status-category.enum';
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

const APPROVAL_WORKFLOW_BY_ROLE = {
  statuses: [
    { name: 'Backlog', category: StatusCategory.TODO },
    { name: 'Building', category: StatusCategory.IN_PROGRESS },
    { name: 'Shipped', category: StatusCategory.DONE },
  ],
  transitions: [
    // No requiresApproval here at all - proves the feature is per-transition, not global.
    { from: 'Backlog', to: 'Building' },
    {
      from: 'Building',
      to: 'Shipped',
      requiresApproval: true,
      approverRoles: [Role.MANAGER],
    },
  ],
  initialStatus: 'Backlog',
};

describe('approval workflows (Module 12 - integration)', () => {
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

  async function seedFixtures(suffix: string) {
    const org = await seedOrganization(app, { name: `Approval Org ${suffix}` });
    const manager = await seedUserAndLogin(app, {
      email: `av-manager-${suffix}@example.com`,
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: `av-dev-${suffix}@example.com`,
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const otherDeveloper = await seedUserAndLogin(app, {
      email: `av-other-dev-${suffix}@example.com`,
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, {
      name: `Approval Project ${suffix}`,
      memberIds: [developer.userDoc.id, otherDeveloper.userDoc.id],
    });
    await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/workflow`)
      .set(...authHeader(manager.accessToken))
      .send(APPROVAL_WORKFLOW_BY_ROLE);
    return { org, manager, developer, otherDeveloper, project };
  }

  it('rejects saving a workflow whose requiresApproval transition has no approvers configured', async () => {
    const org = await seedOrganization(app);
    const manager = await seedUserAndLogin(app, {
      email: 'av-badworkflow-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, { name: 'Bad Workflow Project' });

    const res = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/workflow`)
      .set(...authHeader(manager.accessToken))
      .send({
        statuses: APPROVAL_WORKFLOW_BY_ROLE.statuses,
        transitions: [
          { from: 'Backlog', to: 'Building' },
          { from: 'Building', to: 'Shipped', requiresApproval: true },
        ],
        initialStatus: 'Backlog',
      });
    expect(res.status).toBe(400);
  });

  it('a transition with no requiresApproval still applies immediately (regression, same workflow)', async () => {
    const { manager, project } = await seedFixtures('regression');
    const task = await createTask(app, manager.accessToken, {
      title: 'Plain transition task',
      project: project.id,
      priority: TaskPriority.P2,
    });

    const res = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'Building' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('Building');
    expect(res.body.data.pendingApproval).toBeNull();
  });

  it('requesting a requiresApproval transition leaves status unchanged and records pendingApproval', async () => {
    const { manager, developer, project } = await seedFixtures('request');
    const task = await createTask(app, manager.accessToken, {
      title: 'Needs approval task',
      project: project.id,
      priority: TaskPriority.P2,
      assignee: developer.userDoc.id,
    });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'Building' });

    const requested = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(developer.accessToken))
      .send({ status: 'Shipped' });
    expect(requested.status).toBe(200);
    expect(requested.body.data.status).toBe('Building');
    expect(requested.body.data.pendingApproval).toMatchObject({
      toStatus: 'Shipped',
      requestedBy: developer.userDoc.id,
    });

    const activity = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}/activity`)
      .set(...authHeader(manager.accessToken));
    expect(activity.body.data[0]).toMatchObject({
      action: 'approval_requested',
      from: 'Building',
      to: 'Shipped',
    });

    // Notified as an eligible approver (Module 11's notifications, reused here).
    const managerNotifications = await api(app)
      .get(`/${API_PREFIX}/notifications`)
      .set(...authHeader(manager.accessToken));
    expect(managerNotifications.body.data).toHaveLength(1);
    expect(managerNotifications.body.data[0]).toMatchObject({ type: 'ApprovalRequested' });
  });

  it('blocks any other status change while a transition is pending approval', async () => {
    const { manager, developer, project } = await seedFixtures('frozen');
    const task = await createTask(app, manager.accessToken, {
      title: 'Frozen task',
      project: project.id,
      priority: TaskPriority.P2,
      assignee: developer.userDoc.id,
    });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'Building' });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(developer.accessToken))
      .send({ status: 'Shipped' });

    const blocked = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'Backlog' });
    expect(blocked.status).toBe(409);
  });

  it('a non-eligible approver cannot approve or reject; an eligible approver can approve', async () => {
    const { manager, developer, otherDeveloper, project } = await seedFixtures('decide');
    const task = await createTask(app, manager.accessToken, {
      title: 'Decide task',
      project: project.id,
      priority: TaskPriority.P2,
      assignee: developer.userDoc.id,
    });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'Building' });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(developer.accessToken))
      .send({ status: 'Shipped' });

    const ineligible = await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/approval/approve`)
      .set(...authHeader(otherDeveloper.accessToken));
    expect(ineligible.status).toBe(403);

    const approved = await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/approval/approve`)
      .set(...authHeader(manager.accessToken));
    expect(approved.status).toBe(201);
    expect(approved.body.data.status).toBe('Shipped');
    expect(approved.body.data.statusCategory).toBe(StatusCategory.DONE);
    expect(approved.body.data.pendingApproval).toBeNull();

    const activity = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}/activity`)
      .set(...authHeader(manager.accessToken));
    expect(activity.body.data[0]).toMatchObject({
      action: 'approval_granted',
      from: 'Building',
      to: 'Shipped',
    });

    // The requester is notified of the decision.
    const devNotifications = await api(app)
      .get(`/${API_PREFIX}/notifications`)
      .set(...authHeader(developer.accessToken));
    expect(devNotifications.body.data[0]).toMatchObject({ type: 'ApprovalDecided' });
  });

  it('an eligible approver can reject, leaving the status unchanged and unfreezing the task', async () => {
    const { manager, developer, project } = await seedFixtures('reject');
    const task = await createTask(app, manager.accessToken, {
      title: 'Reject task',
      project: project.id,
      priority: TaskPriority.P2,
      assignee: developer.userDoc.id,
    });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'Building' });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(developer.accessToken))
      .send({ status: 'Shipped' });

    const rejected = await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/approval/reject`)
      .set(...authHeader(manager.accessToken));
    expect(rejected.status).toBe(201);
    expect(rejected.body.data.status).toBe('Building');
    expect(rejected.body.data.pendingApproval).toBeNull();

    // No longer frozen - a fresh request can be made.
    const requestedAgain = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(developer.accessToken))
      .send({ status: 'Shipped' });
    expect(requestedAgain.status).toBe(200);
    expect(requestedAgain.body.data.pendingApproval).toMatchObject({ toStatus: 'Shipped' });
  });

  it('PATCH .../default-approvers sets/replaces the project-wide grant (Module 6 gap-closure)', async () => {
    const { manager, otherDeveloper, project } = await seedFixtures('default-set');

    const res = await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/default-approvers`)
      .set(...authHeader(manager.accessToken))
      .send({ allowedUserIds: [otherDeveloper.userDoc.id] });
    expect(res.status).toBe(200);
    expect(res.body.data.defaultApprovers).toEqual({
      allowedRoles: [],
      allowedUserIds: [otherDeveloper.userDoc.id],
      allowedTeamIds: [],
      allowedProjectRoleIds: [],
    });
  });

  it('rejects setting default-approvers from a Developer (Admin/Manager-only)', async () => {
    const { developer, project } = await seedFixtures('default-reject');
    const res = await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/default-approvers`)
      .set(...authHeader(developer.accessToken))
      .send({ allowedRoles: [Role.DEVELOPER] });
    expect(res.status).toBe(403);
  });

  it("an otherwise-ineligible user CAN approve once they're covered by the project's default-approver grant", async () => {
    const { manager, developer, otherDeveloper, project } = await seedFixtures('default-eligible');
    await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/default-approvers`)
      .set(...authHeader(manager.accessToken))
      .send({ allowedUserIds: [otherDeveloper.userDoc.id] });

    const task = await createTask(app, manager.accessToken, {
      title: 'Default approver task',
      project: project.id,
      priority: TaskPriority.P2,
      assignee: developer.userDoc.id,
    });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'Building' });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(developer.accessToken))
      .send({ status: 'Shipped' });

    // otherDeveloper is named in neither this transition's approverRoles (Manager-only, per
    // APPROVAL_WORKFLOW_BY_ROLE) nor approverUserIds - only the project-wide default covers them.
    const approved = await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/approval/approve`)
      .set(...authHeader(otherDeveloper.accessToken));
    expect(approved.status).toBe(201);
    expect(approved.body.data.status).toBe('Shipped');
  });

  it('a default-approvers grant never lets someone approve when it is NOT configured (regression)', async () => {
    const { manager, developer, otherDeveloper, project } = await seedFixtures('default-absent');
    const task = await createTask(app, manager.accessToken, {
      title: 'No default configured task',
      project: project.id,
      priority: TaskPriority.P2,
      assignee: developer.userDoc.id,
    });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'Building' });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(developer.accessToken))
      .send({ status: 'Shipped' });

    const stillIneligible = await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/approval/approve`)
      .set(...authHeader(otherDeveloper.accessToken));
    expect(stillIneligible.status).toBe(403);
  });

  it('blocks the requester from approving or rejecting their own request', async () => {
    const org = await seedOrganization(app, { name: 'Self Approval Org' });
    const manager = await seedUserAndLogin(app, {
      email: 'av-self-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const otherManager = await seedUserAndLogin(app, {
      email: 'av-self-other-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, {
      name: 'Self Approval Project',
    });
    await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/workflow`)
      .set(...authHeader(manager.accessToken))
      .send({
        statuses: APPROVAL_WORKFLOW_BY_ROLE.statuses,
        transitions: [
          { from: 'Backlog', to: 'Building' },
          {
            from: 'Building',
            to: 'Shipped',
            requiresApproval: true,
            approverUserIds: [manager.userDoc.id, otherManager.userDoc.id],
          },
        ],
        initialStatus: 'Backlog',
      });
    const task = await createTask(app, manager.accessToken, {
      title: 'Self approval task',
      project: project.id,
      priority: TaskPriority.P2,
    });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'Building' });
    // The Manager (an eligible approver by id) is also the one requesting the transition.
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: 'Shipped' });

    const selfApprove = await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/approval/approve`)
      .set(...authHeader(manager.accessToken));
    expect(selfApprove.status).toBe(403);

    const otherApproves = await api(app)
      .post(`/${API_PREFIX}/tasks/${task.id}/approval/approve`)
      .set(...authHeader(otherManager.accessToken));
    expect(otherApproves.status).toBe(201);
    expect(otherApproves.body.data.status).toBe('Shipped');
  });
});
