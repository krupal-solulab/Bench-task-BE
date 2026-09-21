import { BadRequestException, ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { ProjectStatus } from 'src/common/enums/project-status.enum';
import { StatusCategory } from 'src/common/enums/status-category.enum';
import { TaskStatus } from 'src/common/enums/task-status.enum';
import { IssueType } from 'src/common/enums/issue-type.enum';
import { Workflow } from 'src/modules/projects/schemas/workflow.schema';
import { CustomFieldType } from 'src/modules/projects/schemas/custom-field.schema';
import {
  AutomationActionType,
  AutomationTriggerType,
} from 'src/modules/projects/schemas/automation-rule.schema';
import { TaskActivityAction } from 'src/modules/tasks/schemas/task-activity.schema';
import { AuthenticatedUser } from 'src/common/interfaces/jwt-payload.interface';
import { TasksService } from 'src/modules/tasks/tasks.service';
import { TasksRepository } from 'src/modules/tasks/tasks.repository';
import { ProjectsService } from 'src/modules/projects/projects.service';
import { SprintsService } from 'src/modules/sprints/sprints.service';
import { CacheService } from 'src/redis/cache.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { EventsGateway } from 'src/events/events.gateway';

const ORG_A = 'org-a';
const PROJECT_ID = '507f1f77bcf86cd799439010';
const ADMIN_ID = '507f1f77bcf86cd799439011';
const MANAGER_ID = '507f1f77bcf86cd799439012';
const DEV_ID = '507f1f77bcf86cd799439013';
const OTHER_DEV_ID = '507f1f77bcf86cd799439014';
const ASSIGNEE_ID = '507f1f77bcf86cd799439015';
const STORY_ID = '507f1f77bcf86cd799439016';
const EPIC_ID = '507f1f77bcf86cd799439017';
// Automation-rules tests need a real-looking hex id (unlike the file's usual 'task-1' shorthand)
// because executeAutomationJob wraps it in `new Types.ObjectId(...)` for the audit-log write.
const AUTOMATION_TASK_ID = '507f1f77bcf86cd799439018';

function makeProject(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: PROJECT_ID,
    organizationId: { toString: () => ORG_A },
    owner: { toString: () => MANAGER_ID },
    status: ProjectStatus.IN_PROGRESS,
    // Matches the real schema's defaults - every actual project document defaults to these, so a
    // fixture that doesn't override them should behave the same way.
    components: [],
    customFields: [],
    automationRules: [],
    ...overrides,
  } as never;
}

function makeTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'task-1',
    title: 'Fix the bug',
    project: { toString: () => PROJECT_ID },
    organizationId: { toString: () => ORG_A },
    assignee: { toString: () => DEV_ID },
    status: TaskStatus.TODO,
    // Matches the real schema's defaults - every actual document defaults to these, so a fixture
    // that doesn't override them should behave the same way.
    issueType: IssueType.TASK,
    priority: 'P2',
    labels: [],
    components: [],
    ...overrides,
  } as never;
}

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return { id: ADMIN_ID, email: 'a@a.com', role: Role.ADMIN, organizationId: ORG_A, ...overrides };
}

const CUSTOM_WORKFLOW: Workflow = {
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

describe('TasksService', () => {
  let tasksRepository: jest.Mocked<
    Pick<
      TasksRepository,
      | 'create'
      | 'findByIdActive'
      | 'findRawById'
      | 'updateById'
      | 'logActivity'
      | 'softDelete'
      | 'paginate'
      | 'paginateWithFilter'
      | 'findMaxRank'
      | 'findRankInScope'
      | 'renumberScope'
      | 'countLinkedIssues'
      | 'findUnassignedCandidates'
      | 'addFiredTimeBasedRuleIds'
      | 'findOpenTasksUnnotifiedForSla'
      | 'markSlaBreachNotified'
    >
  >;
  let projectsService: jest.Mocked<
    Pick<
      ProjectsService,
      | 'getActiveProjectOrThrow'
      | 'assertUserCanManageOrGranted'
      | 'assertUserCanAssignOrGranted'
      | 'hasSchemeGrant'
      | 'memberHasCapability'
      | 'isProjectMember'
      | 'getAccessibleProjectIds'
      | 'getOrAssignKey'
      | 'nextIssueNumber'
      | 'membersWithRole'
    >
  >;
  let sprintsService: jest.Mocked<Pick<SprintsService, 'getActiveOrThrow'>>;
  let cacheService: jest.Mocked<Pick<CacheService, 'delByPattern'>>;
  let notificationsService: jest.Mocked<
    Pick<
      NotificationsService,
      'notifyTaskAssigned' | 'notifyStatusChanged' | 'notifyAutomationRole' | 'notifySchemeEvent'
    >
  >;
  let eventsGateway: jest.Mocked<
    Pick<EventsGateway, 'emitTaskStatusChanged' | 'emitCommentCreated'>
  >;
  let commentModel: { create: jest.Mock; exists: jest.Mock };
  let automationQueue: { enqueue: jest.Mock };
  let automationLogModel: { create: jest.Mock };
  let service: TasksService;

  beforeEach(() => {
    tasksRepository = {
      create: jest.fn(),
      findByIdActive: jest.fn(),
      findRawById: jest.fn(),
      updateById: jest.fn(),
      logActivity: jest.fn(),
      softDelete: jest.fn(),
      paginate: jest.fn(),
      paginateWithFilter: jest.fn(),
      findMaxRank: jest.fn().mockResolvedValue(null),
      findRankInScope: jest.fn(),
      renumberScope: jest.fn().mockResolvedValue(undefined),
      countLinkedIssues: jest.fn().mockResolvedValue({ total: 0, done: 0 }),
      findUnassignedCandidates: jest.fn().mockResolvedValue([]),
      addFiredTimeBasedRuleIds: jest.fn().mockResolvedValue(undefined),
      findOpenTasksUnnotifiedForSla: jest.fn().mockResolvedValue([]),
      markSlaBreachNotified: jest.fn().mockResolvedValue(undefined),
    };
    projectsService = {
      getActiveProjectOrThrow: jest.fn(),
      assertUserCanManageOrGranted: jest.fn(),
      assertUserCanAssignOrGranted: jest.fn(),
      hasSchemeGrant: jest.fn().mockResolvedValue(false),
      memberHasCapability: jest.fn().mockReturnValue(false),
      isProjectMember: jest.fn(),
      getAccessibleProjectIds: jest.fn(),
      getOrAssignKey: jest.fn().mockResolvedValue('PRJ'),
      nextIssueNumber: jest.fn().mockResolvedValue(1),
      membersWithRole: jest.fn().mockResolvedValue([]),
    };
    sprintsService = { getActiveOrThrow: jest.fn() };
    cacheService = { delByPattern: jest.fn().mockResolvedValue(0) };
    notificationsService = {
      notifyTaskAssigned: jest.fn().mockResolvedValue(undefined),
      notifyStatusChanged: jest.fn().mockResolvedValue(undefined),
      notifyAutomationRole: jest.fn().mockResolvedValue(undefined),
      notifySchemeEvent: jest.fn().mockResolvedValue(undefined),
    };
    eventsGateway = { emitTaskStatusChanged: jest.fn(), emitCommentCreated: jest.fn() };
    commentModel = {
      create: jest.fn().mockResolvedValue({ id: 'comment-1' }),
      exists: jest.fn().mockResolvedValue(null),
    };
    automationQueue = { enqueue: jest.fn().mockResolvedValue(undefined) };
    automationLogModel = { create: jest.fn().mockResolvedValue(undefined) };
    service = new TasksService(
      tasksRepository as unknown as TasksRepository,
      projectsService as unknown as ProjectsService,
      sprintsService as unknown as SprintsService,
      cacheService as unknown as CacheService,
      notificationsService as unknown as NotificationsService,
      eventsGateway as unknown as EventsGateway,
      automationQueue as never,
      commentModel as never,
      automationLogModel as never,
    );
    // Mirrors FakeAutomationQueue's synchronous-execution behavior (see
    // test/integration/setup/fake-automation-queue.ts) so these unit tests, written before
    // automation actions were queued, keep observing their effects immediately rather than every
    // "automation rules" test needing to manually re-invoke executeAutomationJob itself.
    automationQueue.enqueue.mockImplementation((data) => service.executeAutomationJob(data));
  });

  describe('create', () => {
    it('rejects creating a task in a Completed project', async () => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({ status: ProjectStatus.COMPLETED }),
      );

      await expect(
        service.create(
          { title: 'x', project: PROJECT_ID, priority: 'P2' } as never,
          makeUser({ id: ADMIN_ID }),
        ),
      ).rejects.toThrow(ConflictException);
      expect(tasksRepository.create).not.toHaveBeenCalled();
    });

    it('rejects an assignee who is not a project member', async () => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      projectsService.isProjectMember.mockReturnValue(false);

      await expect(
        service.create(
          { title: 'x', project: PROJECT_ID, priority: 'P2', assignee: OTHER_DEV_ID } as never,
          makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('notifies the assignee when a task is created with one, but not when created unassigned', async () => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      projectsService.isProjectMember.mockReturnValue(true);
      tasksRepository.create.mockResolvedValue(makeTask({ id: 'task-1' }));
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ id: 'task-1' }));

      await service.create(
        { title: 'x', project: PROJECT_ID, priority: 'P2', assignee: ASSIGNEE_ID } as never,
        makeUser({ id: MANAGER_ID, role: Role.MANAGER, email: 'manager@a.com' }),
      );
      expect(notificationsService.notifyTaskAssigned).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeId: ASSIGNEE_ID, actorEmail: 'manager@a.com' }),
      );

      notificationsService.notifyTaskAssigned.mockClear();
      await service.create(
        { title: 'x', project: PROJECT_ID, priority: 'P2' } as never,
        makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
      );
      expect(notificationsService.notifyTaskAssigned).not.toHaveBeenCalled();
    });
  });

  describe('create - workflow-aware initial status', () => {
    it("uses the system default workflow's initial status/category when the project has no custom workflow (regression)", async () => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject({ workflow: null }));
      tasksRepository.create.mockResolvedValue(makeTask({ id: 'task-1' }));
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ id: 'task-1' }));

      await service.create(
        { title: 'x', project: PROJECT_ID, priority: 'P2' } as never,
        makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
      );

      expect(tasksRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: TaskStatus.TODO, statusCategory: StatusCategory.TODO }),
      );
    });

    it("uses the project's custom workflow initial status/category when one is set", async () => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({ workflow: CUSTOM_WORKFLOW }),
      );
      tasksRepository.create.mockResolvedValue(makeTask({ id: 'task-1' }));
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ id: 'task-1' }));

      await service.create(
        { title: 'x', project: PROJECT_ID, priority: 'P2' } as never,
        makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
      );

      expect(tasksRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'Backlog', statusCategory: StatusCategory.TODO }),
      );
    });

    it('with no workflowsByType override for the created issueType, falls back to the project default (regression)', async () => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({ workflow: null, workflowsByType: [] }),
      );
      tasksRepository.create.mockResolvedValue(makeTask({ id: 'task-1' }));
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ id: 'task-1' }));

      await service.create(
        { title: 'x', project: PROJECT_ID, priority: 'P2', issueType: IssueType.BUG } as never,
        makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
      );

      expect(tasksRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: TaskStatus.TODO, statusCategory: StatusCategory.TODO }),
      );
    });

    it("uses that issue type's workflowsByType override initial status when configured", async () => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({
          workflow: null,
          workflowsByType: [{ issueType: IssueType.BUG, workflow: CUSTOM_WORKFLOW }],
        }),
      );
      tasksRepository.create.mockResolvedValue(makeTask({ id: 'task-1' }));
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ id: 'task-1' }));

      await service.create(
        { title: 'x', project: PROJECT_ID, priority: 'P2', issueType: IssueType.BUG } as never,
        makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
      );

      expect(tasksRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'Backlog', statusCategory: StatusCategory.TODO }),
      );
    });
  });

  describe('create/update - components and custom fields', () => {
    const REQUIRED_FIELD = {
      id: 'f-1',
      name: 'Root Cause',
      type: CustomFieldType.TEXT,
      required: true,
      options: null,
    };

    it('rejects a component name not defined on the project', async () => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({ components: ['Frontend'] }),
      );

      await expect(
        service.create(
          { title: 'x', project: PROJECT_ID, priority: 'P2', components: ['Backend'] } as never,
          makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a component name defined on the project', async () => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({ components: ['Frontend'] }),
      );
      tasksRepository.create.mockResolvedValue(makeTask({ id: 'task-1' }));
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ id: 'task-1' }));

      await service.create(
        { title: 'x', project: PROJECT_ID, priority: 'P2', components: ['Frontend'] } as never,
        makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
      );

      expect(tasksRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ components: ['Frontend'] }),
      );
    });

    it('rejects a missing required custom field on create', async () => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({ customFields: [REQUIRED_FIELD] }),
      );

      await expect(
        service.create(
          { title: 'x', project: PROJECT_ID, priority: 'P2' } as never,
          makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a valid required custom field value on create', async () => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({ customFields: [REQUIRED_FIELD] }),
      );
      tasksRepository.create.mockResolvedValue(makeTask({ id: 'task-1' }));
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ id: 'task-1' }));

      await service.create(
        {
          title: 'x',
          project: PROJECT_ID,
          priority: 'P2',
          customFieldValues: { [REQUIRED_FIELD.id]: 'disk full' },
        } as never,
        makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
      );

      expect(tasksRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ customFieldValues: { [REQUIRED_FIELD.id]: 'disk full' } }),
      );
    });

    it('update() does not require a required custom field to be re-supplied', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({ customFieldValues: { [REQUIRED_FIELD.id]: 'existing value' } }),
      );
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({ customFields: [REQUIRED_FIELD] }),
      );
      tasksRepository.updateById.mockResolvedValue(makeTask());

      await expect(
        service.update('task-1', { title: 'Renamed' } as never, makeUser({ role: Role.ADMIN })),
      ).resolves.toBeDefined();
    });

    it('update() merges customFieldValues rather than replacing the whole map', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({ customFieldValues: { 'f-1': 'a', 'f-2': 'b' } }),
      );
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({
          customFields: [
            { id: 'f-1', name: 'A', type: CustomFieldType.TEXT, required: false, options: null },
            { id: 'f-2', name: 'B', type: CustomFieldType.TEXT, required: false, options: null },
          ],
        }),
      );
      tasksRepository.updateById.mockResolvedValue(makeTask());

      await service.update(
        'task-1',
        { customFieldValues: { 'f-1': 'updated' } } as never,
        makeUser({ role: Role.ADMIN }),
      );

      expect(tasksRepository.updateById).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ customFieldValues: { 'f-1': 'updated', 'f-2': 'b' } }),
      );
    });

    it('create() applies a per-issue-type override hiding a field for that issue type', async () => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({
          customFields: [REQUIRED_FIELD],
          customFieldOverridesByType: [
            {
              issueType: IssueType.BUG,
              hiddenFieldIds: [REQUIRED_FIELD.id],
              requiredFieldIds: [],
              optionalFieldIds: [],
            },
          ],
        }),
      );
      tasksRepository.create.mockResolvedValue(makeTask({ id: 'task-1' }));
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ id: 'task-1' }));

      await expect(
        service.create(
          { title: 'x', project: PROJECT_ID, priority: 'P2', issueType: IssueType.BUG } as never,
          makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
        ),
      ).resolves.toBeDefined();
    });

    it('create() still enforces a required field for an issue type with no override (regression)', async () => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({ customFields: [REQUIRED_FIELD] }),
      );

      await expect(
        service.create(
          { title: 'x', project: PROJECT_ID, priority: 'P2', issueType: IssueType.BUG } as never,
          makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("update() resolves custom fields against the task's own issue type", async () => {
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({ issueType: IssueType.BUG, customFieldValues: {} }),
      );
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({
          customFields: [REQUIRED_FIELD],
          customFieldOverridesByType: [
            {
              issueType: IssueType.BUG,
              hiddenFieldIds: [],
              requiredFieldIds: [],
              optionalFieldIds: [REQUIRED_FIELD.id],
            },
          ],
        }),
      );
      tasksRepository.updateById.mockResolvedValue(makeTask());

      // REQUIRED_FIELD is globally required, but forced optional for Bug - update() only
      // validates supplied keys anyway (partial-patch), so this mainly proves the resolved
      // (overridden) definitions - not the raw project-wide ones - are what gets used.
      await expect(
        service.update('task-1', { title: 'Renamed' } as never, makeUser({ role: Role.ADMIN })),
      ).resolves.toBeDefined();
    });

    describe('User-picker fields', () => {
      const REVIEWER_FIELD = {
        id: 'f-reviewer',
        name: 'Reviewer',
        type: CustomFieldType.USER_PICKER,
        required: false,
        options: null,
      };

      it('create() accepts a User-picker value that is a project member', async () => {
        projectsService.getActiveProjectOrThrow.mockResolvedValue(
          makeProject({ customFields: [REVIEWER_FIELD] }),
        );
        projectsService.isProjectMember.mockReturnValue(true);
        tasksRepository.create.mockResolvedValue(makeTask({ id: 'task-1' }));
        tasksRepository.findByIdActive.mockResolvedValue(makeTask({ id: 'task-1' }));

        await expect(
          service.create(
            {
              title: 'x',
              project: PROJECT_ID,
              priority: 'P2',
              customFieldValues: { [REVIEWER_FIELD.id]: 'user-1' },
            } as never,
            makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
          ),
        ).resolves.toBeDefined();
      });

      it('create() rejects a User-picker value that is not a project member', async () => {
        projectsService.getActiveProjectOrThrow.mockResolvedValue(
          makeProject({ customFields: [REVIEWER_FIELD] }),
        );
        projectsService.isProjectMember.mockReturnValue(false);

        await expect(
          service.create(
            {
              title: 'x',
              project: PROJECT_ID,
              priority: 'P2',
              customFieldValues: { [REVIEWER_FIELD.id]: 'not-a-member' },
            } as never,
            makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('update() rejects a User-picker value that is not a project member', async () => {
        tasksRepository.findByIdActive.mockResolvedValue(makeTask({ customFieldValues: {} }));
        projectsService.getActiveProjectOrThrow.mockResolvedValue(
          makeProject({ customFields: [REVIEWER_FIELD] }),
        );
        projectsService.isProjectMember.mockReturnValue(false);

        await expect(
          service.update(
            'task-1',
            { customFieldValues: { [REVIEWER_FIELD.id]: 'not-a-member' } } as never,
            makeUser({ role: Role.ADMIN }),
          ),
        ).rejects.toThrow(BadRequestException);
      });
    });
  });

  describe('create - issue hierarchy validation', () => {
    beforeEach(() => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
    });

    it('rejects a Sub-task with no parent', async () => {
      await expect(
        service.create(
          {
            title: 'x',
            project: PROJECT_ID,
            priority: 'P2',
            issueType: IssueType.SUBTASK,
          } as never,
          makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects a Sub-task whose parent isn't a Story/Task/Bug", async () => {
      tasksRepository.findRawById.mockResolvedValue(
        makeTask({ id: 'epic-1', issueType: IssueType.EPIC }),
      );

      await expect(
        service.create(
          {
            title: 'x',
            project: PROJECT_ID,
            priority: 'P2',
            issueType: IssueType.SUBTASK,
            parent: 'epic-1',
          } as never,
          makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a Sub-task whose parent is a Story/Task/Bug in the same project', async () => {
      tasksRepository.findRawById.mockResolvedValue(
        makeTask({ id: STORY_ID, issueType: IssueType.STORY }),
      );
      tasksRepository.create.mockResolvedValue(makeTask({ id: 'sub-1' }));
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ id: 'sub-1' }));

      await service.create(
        {
          title: 'x',
          project: PROJECT_ID,
          priority: 'P2',
          issueType: IssueType.SUBTASK,
          parent: STORY_ID,
        } as never,
        makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
      );

      expect(tasksRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ issueType: IssueType.SUBTASK }),
      );
    });

    it('rejects an Epic given a parent', async () => {
      await expect(
        service.create(
          {
            title: 'x',
            project: PROJECT_ID,
            priority: 'P2',
            issueType: IssueType.EPIC,
            parent: 'anything',
          } as never,
          makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects a Story/Task/Bug whose parent isn't an Epic", async () => {
      tasksRepository.findRawById.mockResolvedValue(
        makeTask({ id: 'story-1', issueType: IssueType.STORY }),
      );

      await expect(
        service.create(
          {
            title: 'x',
            project: PROJECT_ID,
            priority: 'P2',
            issueType: IssueType.TASK,
            parent: 'story-1',
          } as never,
          makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a Story/Task/Bug epic-linked to an Epic in the same project', async () => {
      tasksRepository.findRawById.mockResolvedValue(
        makeTask({ id: EPIC_ID, issueType: IssueType.EPIC }),
      );
      tasksRepository.create.mockResolvedValue(makeTask({ id: 'story-1' }));
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ id: 'story-1' }));

      await service.create(
        {
          title: 'x',
          project: PROJECT_ID,
          priority: 'P2',
          issueType: IssueType.STORY,
          parent: EPIC_ID,
        } as never,
        makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
      );

      expect(tasksRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ issueType: IssueType.STORY }),
      );
    });

    it('rejects a parent that belongs to a different project', async () => {
      tasksRepository.findRawById.mockResolvedValue(
        makeTask({
          id: 'story-1',
          issueType: IssueType.STORY,
          project: { toString: () => 'a-different-project' },
        }),
      );

      await expect(
        service.create(
          {
            title: 'x',
            project: PROJECT_ID,
            priority: 'P2',
            issueType: IssueType.SUBTASK,
            parent: 'story-1',
          } as never,
          makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('assigns a sequential issueKey using the project key prefix', async () => {
      projectsService.getOrAssignKey.mockResolvedValue('SUP');
      projectsService.nextIssueNumber.mockResolvedValue(42);
      tasksRepository.create.mockResolvedValue(makeTask({ id: 'task-42' }));
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ id: 'task-42' }));

      await service.create(
        { title: 'x', project: PROJECT_ID, priority: 'P2' } as never,
        makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
      );

      expect(tasksRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ issueKey: 'SUP-42' }),
      );
    });

    it('skips the backlog-rank lookup for Epic/Sub-task issues (they never appear in the backlog)', async () => {
      tasksRepository.create.mockResolvedValue(
        makeTask({ id: 'epic-1', issueType: IssueType.EPIC }),
      );
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({ id: 'epic-1', issueType: IssueType.EPIC }),
      );

      await service.create(
        { title: 'x', project: PROJECT_ID, priority: 'P2', issueType: IssueType.EPIC } as never,
        makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
      );

      expect(tasksRepository.findMaxRank).not.toHaveBeenCalled();
      expect(tasksRepository.create).toHaveBeenCalledWith(expect.objectContaining({ rank: 0 }));
    });

    it('rejects an issue type that is not enabled for this project', async () => {
      await expect(
        service.create(
          {
            title: 'x',
            project: PROJECT_ID,
            priority: 'P2',
            issueType: 'Not A Real Type',
          } as never,
          makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("accepts a custom Standard-level issue type the project's Admin configured (extensible level)", async () => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({
          issueTypes: [
            { name: 'Epic', level: 'epic', icon: 'Zap', color: 'purple' },
            { name: 'Chore', level: 'standard', icon: 'Wrench', color: 'slate' },
            { name: 'Sub-task', level: 'subtask', icon: 'ListChecks', color: 'slate' },
          ],
        }),
      );
      tasksRepository.create.mockResolvedValue(makeTask({ id: 'chore-1', issueType: 'Chore' }));
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({ id: 'chore-1', issueType: 'Chore' }),
      );

      await service.create(
        { title: 'x', project: PROJECT_ID, priority: 'P2', issueType: 'Chore' } as never,
        makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
      );

      expect(tasksRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ issueType: 'Chore' }),
      );
    });

    it('rejects a built-in Standard type (Bug) that a project has customized away (disabled)', async () => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({
          issueTypes: [
            { name: 'Epic', level: 'epic', icon: 'Zap', color: 'purple' },
            { name: 'Chore', level: 'standard', icon: 'Wrench', color: 'slate' },
            { name: 'Sub-task', level: 'subtask', icon: 'ListChecks', color: 'slate' },
          ],
        }),
      );

      await expect(
        service.create(
          { title: 'x', project: PROJECT_ID, priority: 'P2', issueType: IssueType.BUG } as never,
          makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('search (JQL-lite, Search/Dashboards v2)', () => {
    // buildScope() casts organizationId through `new Types.ObjectId(...)`, which requires a real
    // hex string - unlike most task/project mocks elsewhere in this file, which only ever pass
    // organizationId through extractId()'s `.toString()` and so tolerate a plain label like ORG_A.
    const VALID_ORG_ID = '507f1f77bcf86cd799439099';

    beforeEach(() => {
      projectsService.getAccessibleProjectIds.mockResolvedValue([PROJECT_ID]);
      tasksRepository.paginateWithFilter.mockResolvedValue({ data: [], total: 0 });
    });

    it('rejects an invalid query with a BadRequestException', async () => {
      await expect(
        service.search(
          { jql: 'bogus = 1', page: 1, limit: 20 } as never,
          makeUser({ organizationId: VALID_ORG_ID }),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(tasksRepository.paginateWithFilter).not.toHaveBeenCalled();
    });

    it("ANDs the compiled query with the caller's accessible-project/org scope", async () => {
      await service.search(
        { jql: 'status = Done', page: 1, limit: 20 } as never,
        makeUser({ id: ADMIN_ID, organizationId: VALID_ORG_ID }),
      );

      const [filter] = tasksRepository.paginateWithFilter.mock.calls[0]!;
      expect(filter).toEqual({
        $and: [
          {
            deletedAt: null,
            project: { $in: [expect.any(Object)] },
            organizationId: expect.any(Object),
          },
          { status: 'Done' },
        ],
      });
    });

    it('defaults to createdAt desc when the query has no ORDER BY', async () => {
      await service.search(
        { jql: 'status = Done', page: 1, limit: 20 } as never,
        makeUser({ organizationId: VALID_ORG_ID }),
      );

      const [, sort] = tasksRepository.paginateWithFilter.mock.calls[0]!;
      expect(sort).toEqual({ createdAt: -1 });
    });

    it('sorts by the ORDER BY field/direction when given', async () => {
      await service.search(
        { jql: 'status = Done ORDER BY priority ASC', page: 1, limit: 20 } as never,
        makeUser({ organizationId: VALID_ORG_ID }),
      );

      const [, sort] = tasksRepository.paginateWithFilter.mock.calls[0]!;
      expect(sort).toEqual({ priority: 1, createdAt: 1 });
    });

    it('resolves currentUser() against the acting user', async () => {
      await service.search(
        { jql: 'assignee = currentUser()', page: 1, limit: 20 } as never,
        makeUser({ id: DEV_ID, organizationId: VALID_ORG_ID }),
      );

      const [filter] = tasksRepository.paginateWithFilter.mock.calls[0]!;
      const compiled = (filter as { $and: [unknown, { assignee: { toString(): string } }] })
        .$and[1];
      expect(compiled.assignee.toString()).toBe(DEV_ID);
    });

    it('paginates using the requested page/limit', async () => {
      await service.search(
        { jql: 'status = Done', page: 3, limit: 10 } as never,
        makeUser({ organizationId: VALID_ORG_ID }),
      );

      const [, , page, limit] = tasksRepository.paginateWithFilter.mock.calls[0]!;
      expect(page).toBe(3);
      expect(limit).toBe(10);
    });
  });

  describe('updateSprint - hierarchy guard', () => {
    beforeEach(() => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
    });

    it('rejects assigning an Epic to a sprint', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ issueType: IssueType.EPIC }));

      await expect(
        service.updateSprint(
          'task-1',
          { sprintId: 'sprint-1' } as never,
          makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects assigning a Sub-task to a sprint', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ issueType: IssueType.SUBTASK }));

      await expect(
        service.updateSprint(
          'task-1',
          { sprintId: 'sprint-1' } as never,
          makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('permission-grant delegation (Phase 3: per-project member grants)', () => {
    beforeEach(() => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
    });

    it('create() checks canCreateTask', async () => {
      tasksRepository.create.mockResolvedValue(makeTask({ id: 'task-1' }));
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ id: 'task-1' }));

      await service.create(
        { title: 'x', project: PROJECT_ID, priority: 'P2' } as never,
        makeUser({ id: DEV_ID, role: Role.DEVELOPER }),
      );

      expect(projectsService.assertUserCanManageOrGranted).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'canCreateTask',
      );
    });

    it('update() checks canEditAnyTask', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask());
      tasksRepository.updateById.mockResolvedValue(makeTask({ title: 'Updated' }));

      await service.update(
        'task-1',
        { title: 'Updated' } as never,
        makeUser({ id: DEV_ID, role: Role.DEVELOPER }),
      );

      expect(projectsService.assertUserCanManageOrGranted).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'canEditAnyTask',
      );
    });

    it('softDelete() checks canDeleteTask', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask());

      await service.softDelete('task-1', makeUser({ id: DEV_ID, role: Role.DEVELOPER }));

      expect(projectsService.assertUserCanManageOrGranted).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'canDeleteTask',
      );
    });

    it('updateSprint() checks canManageSprints', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask());

      await service.updateSprint(
        'task-1',
        { sprintId: null } as never,
        makeUser({ id: DEV_ID, role: Role.DEVELOPER }),
      );

      expect(projectsService.assertUserCanManageOrGranted).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'canManageSprints',
      );
    });

    it('updateRank() checks canManageSprints', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask());
      tasksRepository.findRankInScope.mockResolvedValue(100);
      tasksRepository.updateById.mockResolvedValue(makeTask());

      await service.updateRank(
        'task-1',
        { beforeTaskId: 'other-task' } as never,
        makeUser({ id: DEV_ID, role: Role.DEVELOPER }),
      );

      expect(projectsService.assertUserCanManageOrGranted).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'canManageSprints',
      );
    });
  });

  describe('updateStatus - permission matrix', () => {
    it('allows a same-org Admin to change status regardless of assignment', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask());
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: TaskStatus.IN_PROGRESS }));

      await expect(
        service.updateStatus('task-1', TaskStatus.IN_PROGRESS, makeUser({ role: Role.ADMIN })),
      ).resolves.toBeDefined();
    });

    it('allows the project-owning Manager to change status', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask());
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: TaskStatus.IN_PROGRESS }));

      await expect(
        service.updateStatus(
          'task-1',
          TaskStatus.IN_PROGRESS,
          makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
        ),
      ).resolves.toBeDefined();
    });

    it('denies a Manager who does not own the project', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask());
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());

      await expect(
        service.updateStatus(
          'task-1',
          TaskStatus.IN_PROGRESS,
          makeUser({ id: OTHER_DEV_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows the assigned Developer to change status', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({ assignee: { toString: () => DEV_ID } }),
      );
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: TaskStatus.IN_PROGRESS }));

      await expect(
        service.updateStatus(
          'task-1',
          TaskStatus.IN_PROGRESS,
          makeUser({ id: DEV_ID, role: Role.DEVELOPER }),
        ),
      ).resolves.toBeDefined();
    });

    it('denies a Developer who is not the assignee', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({ assignee: { toString: () => DEV_ID } }),
      );
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());

      await expect(
        service.updateStatus(
          'task-1',
          TaskStatus.IN_PROGRESS,
          makeUser({ id: OTHER_DEV_ID, role: Role.DEVELOPER }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('denies a Developer on an unassigned task', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ assignee: null }));
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());

      await expect(
        service.updateStatus(
          'task-1',
          TaskStatus.IN_PROGRESS,
          makeUser({ id: DEV_ID, role: Role.DEVELOPER }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows a non-assigned Developer with a canChangeAnyTaskStatus grant', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ assignee: null }));
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      projectsService.memberHasCapability.mockReturnValue(true);
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: TaskStatus.IN_PROGRESS }));

      await expect(
        service.updateStatus(
          'task-1',
          TaskStatus.IN_PROGRESS,
          makeUser({ id: DEV_ID, role: Role.DEVELOPER }),
        ),
      ).resolves.toBeDefined();
      expect(projectsService.memberHasCapability).toHaveBeenCalledWith(
        expect.anything(),
        DEV_ID,
        'canChangeAnyTaskStatus',
      );
    });

    it('denies an Admin from a different organization', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask());
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());

      await expect(
        service.updateStatus(
          'task-1',
          TaskStatus.IN_PROGRESS,
          makeUser({ role: Role.ADMIN, organizationId: 'org-b' }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects an illegal transition (e.g. Todo -> Done)', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ status: TaskStatus.TODO }));
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());

      await expect(
        service.updateStatus('task-1', TaskStatus.DONE, makeUser({ role: Role.ADMIN })),
      ).rejects.toThrow(ConflictException);
    });

    it('is a no-op returning the task unchanged when the status is already the target status', async () => {
      const task = makeTask({ status: TaskStatus.IN_PROGRESS });
      tasksRepository.findByIdActive.mockResolvedValue(task);
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());

      const result = await service.updateStatus(
        'task-1',
        TaskStatus.IN_PROGRESS,
        makeUser({ role: Role.ADMIN }),
      );
      expect(result).toBe(task);
      expect(tasksRepository.updateById).not.toHaveBeenCalled();
    });

    it('stamps completedAt when moving to Done, and clears it when moving off Done', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ status: TaskStatus.REVIEW }));
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: TaskStatus.DONE }));

      await service.updateStatus('task-1', TaskStatus.DONE, makeUser({ role: Role.ADMIN }));
      expect(tasksRepository.updateById).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ status: TaskStatus.DONE, completedAt: expect.any(Date) }),
      );

      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ status: TaskStatus.DONE }));
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: TaskStatus.IN_PROGRESS }));
      await service.updateStatus('task-1', TaskStatus.IN_PROGRESS, makeUser({ role: Role.ADMIN }));
      expect(tasksRepository.updateById).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ status: TaskStatus.IN_PROGRESS, completedAt: null }),
      );
    });

    it('broadcasts a task:statusChanged event on a successful transition', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ status: TaskStatus.TODO }));
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: TaskStatus.IN_PROGRESS }));

      await service.updateStatus(
        'task-1',
        TaskStatus.IN_PROGRESS,
        makeUser({ id: ADMIN_ID, role: Role.ADMIN }),
      );

      expect(eventsGateway.emitTaskStatusChanged).toHaveBeenCalledWith({
        taskId: 'task-1',
        projectId: PROJECT_ID,
        fromStatus: TaskStatus.TODO,
        toStatus: TaskStatus.IN_PROGRESS,
        actorId: ADMIN_ID,
      });
    });

    it('does not let a broadcast failure stop the status update from succeeding', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ status: TaskStatus.TODO }));
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: TaskStatus.IN_PROGRESS }));
      eventsGateway.emitTaskStatusChanged.mockImplementation(() => {
        throw new Error('socket server unavailable');
      });

      await expect(
        service.updateStatus('task-1', TaskStatus.IN_PROGRESS, makeUser({ role: Role.ADMIN })),
      ).resolves.toBeDefined();
    });
  });

  describe('updateStatus - custom workflow', () => {
    it("rejects a status name that isn't in the project's custom workflow", async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ status: 'Backlog' }));
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({ workflow: CUSTOM_WORKFLOW }),
      );

      await expect(
        service.updateStatus('task-1', 'Todo', makeUser({ role: Role.ADMIN })),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a transition the custom workflow does not allow', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ status: 'Backlog' }));
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({ workflow: CUSTOM_WORKFLOW }),
      );

      await expect(
        service.updateStatus('task-1', 'Shipped', makeUser({ role: Role.ADMIN })),
      ).rejects.toThrow(ConflictException);
    });

    it('accepts a configured custom transition and stamps completedAt on reaching the Done category', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ status: 'Building' }));
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({ workflow: CUSTOM_WORKFLOW }),
      );
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: 'Shipped' }));

      await service.updateStatus('task-1', 'Shipped', makeUser({ role: Role.ADMIN }));

      expect(tasksRepository.updateById).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'Shipped',
          statusCategory: StatusCategory.DONE,
          completedAt: expect.any(Date),
        }),
      );
    });

    it("with an issueType override, resolves that type's own workflow (not the project default)", async () => {
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({ status: 'Backlog', issueType: IssueType.BUG }),
      );
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({
          workflow: null,
          workflowsByType: [{ issueType: IssueType.BUG, workflow: CUSTOM_WORKFLOW }],
        }),
      );
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: 'Building' }));

      await service.updateStatus('task-1', 'Building', makeUser({ role: Role.ADMIN }));

      expect(tasksRepository.updateById).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ status: 'Building' }),
      );
    });

    it('with no override for that issueType, falls back to the project default workflow (regression)', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({ status: TaskStatus.TODO, issueType: IssueType.STORY }),
      );
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({
          workflow: null,
          workflowsByType: [{ issueType: IssueType.BUG, workflow: CUSTOM_WORKFLOW }],
        }),
      );
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: TaskStatus.IN_PROGRESS }));

      await service.updateStatus('task-1', TaskStatus.IN_PROGRESS, makeUser({ role: Role.ADMIN }));

      expect(tasksRepository.updateById).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ status: TaskStatus.IN_PROGRESS }),
      );
    });
  });

  describe('updateStatus - transition Conditions & Validators', () => {
    const ROLE_GATED_WORKFLOW: Workflow = {
      statuses: CUSTOM_WORKFLOW.statuses,
      transitions: [
        { from: 'Backlog', to: 'Building' },
        { from: 'Building', to: 'Shipped', allowedRoles: [Role.ADMIN, Role.MANAGER] },
      ],
      initialStatus: 'Backlog',
    };
    const COMMENT_GATED_WORKFLOW: Workflow = {
      statuses: CUSTOM_WORKFLOW.statuses,
      transitions: [
        { from: 'Backlog', to: 'Building' },
        { from: 'Building', to: 'Shipped', requireComment: true },
      ],
      initialStatus: 'Backlog',
    };

    it('a transition with neither allowedRoles nor requireComment set behaves exactly as before (regression)', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ status: 'Building' }));
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({ workflow: CUSTOM_WORKFLOW }),
      );
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: 'Shipped' }));

      await expect(
        service.updateStatus('task-1', 'Shipped', makeUser({ role: Role.ADMIN })),
      ).resolves.toBeDefined();
      expect(commentModel.exists).not.toHaveBeenCalled();
    });

    it('Condition: rejects a transition when the acting role is not among allowedRoles', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({ status: 'Building', assignee: { toString: () => DEV_ID } }),
      );
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({ workflow: ROLE_GATED_WORKFLOW }),
      );

      await expect(
        service.updateStatus('task-1', 'Shipped', makeUser({ id: DEV_ID, role: Role.DEVELOPER })),
      ).rejects.toThrow(ForbiddenException);
      expect(tasksRepository.updateById).not.toHaveBeenCalled();
    });

    it('Condition: accepts a transition when the acting role is among allowedRoles', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ status: 'Building' }));
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({ workflow: ROLE_GATED_WORKFLOW }),
      );
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: 'Shipped' }));

      await expect(
        service.updateStatus('task-1', 'Shipped', makeUser({ role: Role.ADMIN })),
      ).resolves.toBeDefined();
    });

    it('Validator: rejects a transition requiring a comment when the task has none', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ status: 'Building' }));
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({ workflow: COMMENT_GATED_WORKFLOW }),
      );
      commentModel.exists.mockResolvedValue(null);

      await expect(
        service.updateStatus('task-1', 'Shipped', makeUser({ role: Role.ADMIN })),
      ).rejects.toThrow(BadRequestException);
      expect(tasksRepository.updateById).not.toHaveBeenCalled();
    });

    it('Validator: accepts a transition requiring a comment when one already exists', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ status: 'Building' }));
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({ workflow: COMMENT_GATED_WORKFLOW }),
      );
      commentModel.exists.mockResolvedValue({ _id: 'c-1' });
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: 'Shipped' }));

      await expect(
        service.updateStatus('task-1', 'Shipped', makeUser({ role: Role.ADMIN })),
      ).resolves.toBeDefined();
    });

    it('an automation-driven transition bypasses both a role Condition and a comment Validator', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ status: 'Building' }));
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({
          workflow: {
            statuses: CUSTOM_WORKFLOW.statuses,
            transitions: [
              { from: 'Backlog', to: 'Building' },
              {
                from: 'Building',
                to: 'Shipped',
                allowedRoles: [Role.ADMIN],
                requireComment: true,
              },
            ],
            initialStatus: 'Backlog',
          },
        }),
      );
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: 'Shipped' }));

      await expect(
        service.updateStatus('task-1', 'Shipped', makeUser({ id: DEV_ID, role: Role.DEVELOPER }), {
          bypassPermission: true,
          viaRuleId: 'r-1',
          viaRuleName: 'Auto-ship',
        }),
      ).resolves.toBeDefined();
      expect(commentModel.exists).not.toHaveBeenCalled();
    });
  });

  describe('updateAssignee', () => {
    it('notifies the new assignee when reassigned to someone new', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({ assignee: { toString: () => DEV_ID } }),
      );
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      projectsService.isProjectMember.mockReturnValue(true);
      tasksRepository.updateById.mockResolvedValue(
        makeTask({ assignee: { toString: () => ASSIGNEE_ID } }),
      );

      await service.updateAssignee('task-1', ASSIGNEE_ID, makeUser({ email: 'admin@a.com' }));

      expect(notificationsService.notifyTaskAssigned).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeId: ASSIGNEE_ID, actorEmail: 'admin@a.com' }),
      );
    });

    it('does not notify when the assignee is unchanged (re-saving the same assignee)', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({ assignee: { toString: () => DEV_ID } }),
      );
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      projectsService.isProjectMember.mockReturnValue(true);
      tasksRepository.updateById.mockResolvedValue(
        makeTask({ assignee: { toString: () => DEV_ID } }),
      );

      await service.updateAssignee('task-1', DEV_ID, makeUser());

      expect(notificationsService.notifyTaskAssigned).not.toHaveBeenCalled();
    });

    it('does not notify when unassigning (assignee set to null)', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({ assignee: { toString: () => DEV_ID } }),
      );
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      tasksRepository.updateById.mockResolvedValue(makeTask({ assignee: null }));

      await service.updateAssignee('task-1', null, makeUser());

      expect(notificationsService.notifyTaskAssigned).not.toHaveBeenCalled();
    });

    it('rejects reassigning to a non-project-member', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask());
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      projectsService.isProjectMember.mockReturnValue(false);

      await expect(service.updateAssignee('task-1', OTHER_DEV_ID, makeUser())).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('notification scheme (Notification Schemes v2)', () => {
    const SCHEME_MANAGER = { id: MANAGER_ID, email: 'manager@a.com' };

    it('a project with no notification scheme behaves identically to before this feature (regression)', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({ id: 'task-1', assignee: { toString: () => DEV_ID } }),
      );
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({ notificationScheme: [] }),
      );
      projectsService.isProjectMember.mockReturnValue(true);
      tasksRepository.updateById.mockResolvedValue(
        makeTask({ assignee: { toString: () => ASSIGNEE_ID } }),
      );

      await service.updateAssignee('task-1', ASSIGNEE_ID, makeUser({ email: 'admin@a.com' }));

      expect(notificationsService.notifySchemeEvent).not.toHaveBeenCalled();
    });

    it('create() additionally notifies a scheme-configured role on Assigned, without affecting the hardcoded assignee notification', async () => {
      const project = makeProject({
        notificationScheme: [
          { event: 'Assigned', notifyRoles: [Role.MANAGER], channels: ['InApp'] },
        ],
      });
      projectsService.getActiveProjectOrThrow.mockResolvedValue(project);
      projectsService.isProjectMember.mockReturnValue(true);
      projectsService.membersWithRole.mockResolvedValue([SCHEME_MANAGER as never]);
      tasksRepository.create.mockResolvedValue(makeTask({ id: 'task-1' }));
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ id: 'task-1' }));

      await service.create(
        { title: 'x', project: PROJECT_ID, priority: 'P2', assignee: DEV_ID } as never,
        makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
      );

      expect(notificationsService.notifyTaskAssigned).toHaveBeenCalled();
      expect(projectsService.membersWithRole).toHaveBeenCalledWith(project, Role.MANAGER);
      expect(notificationsService.notifySchemeEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient: expect.objectContaining({ id: MANAGER_ID }),
          event: 'Assigned',
          channels: ['InApp'],
        }),
      );
    });

    it('updateAssignee() additionally notifies a scheme-configured role on Assigned', async () => {
      const project = makeProject({
        notificationScheme: [
          { event: 'Assigned', notifyRoles: [Role.MANAGER], channels: ['Email'] },
        ],
      });
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({ assignee: { toString: () => DEV_ID } }),
      );
      projectsService.getActiveProjectOrThrow.mockResolvedValue(project);
      projectsService.isProjectMember.mockReturnValue(true);
      projectsService.membersWithRole.mockResolvedValue([SCHEME_MANAGER as never]);
      tasksRepository.updateById.mockResolvedValue(
        makeTask({ assignee: { toString: () => ASSIGNEE_ID } }),
      );

      await service.updateAssignee('task-1', ASSIGNEE_ID, makeUser({ email: 'admin@a.com' }));

      expect(notificationsService.notifySchemeEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'Assigned', channels: ['Email'] }),
      );
    });

    it('updateStatus() notifies a scheme-configured role on Transitioned even for an unassigned task', async () => {
      const project = makeProject({
        workflow: null,
        notificationScheme: [
          { event: 'Transitioned', notifyRoles: [Role.MANAGER], channels: ['InApp'] },
        ],
      });
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({ status: TaskStatus.TODO, assignee: null }),
      );
      projectsService.getActiveProjectOrThrow.mockResolvedValue(project);
      projectsService.membersWithRole.mockResolvedValue([SCHEME_MANAGER as never]);
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: TaskStatus.IN_PROGRESS }));

      await service.updateStatus('task-1', TaskStatus.IN_PROGRESS, makeUser({ role: Role.ADMIN }));

      // The hardcoded notification is skipped (no assignee) but the scheme-based one still fires -
      // a role subscriber cares about every transition, not just assigned tasks.
      expect(notificationsService.notifyStatusChanged).not.toHaveBeenCalled();
      expect(notificationsService.notifySchemeEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'Transitioned' }),
      );
    });
  });

  describe('automation rules', () => {
    it('a project with no automation rules behaves identically to before this feature (regression)', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({ status: TaskStatus.TODO, assignee: { toString: () => DEV_ID } }),
      );
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({ automationRules: [] }),
      );
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: TaskStatus.IN_PROGRESS }));

      await service.updateStatus(
        AUTOMATION_TASK_ID,
        TaskStatus.IN_PROGRESS,
        makeUser({ id: DEV_ID, role: Role.DEVELOPER }),
      );

      expect(tasksRepository.updateById).toHaveBeenCalledTimes(1);
      expect(tasksRepository.logActivity).toHaveBeenCalledWith(
        AUTOMATION_TASK_ID,
        DEV_ID,
        TaskActivityAction.STATUS_CHANGED,
        TaskStatus.TODO,
        TaskStatus.IN_PROGRESS,
        null,
      );
    });

    it("create() fires a matching IssueCreated rule's AddLabels action", async () => {
      const project = makeProject({
        automationRules: [
          {
            id: 'r-1',
            name: 'Auto-label',
            enabled: true,
            trigger: { type: AutomationTriggerType.ISSUE_CREATED, toStatus: null },
            conditions: [],
            actions: [{ type: AutomationActionType.ADD_LABELS, value: 'triage' }],
          },
        ],
      });
      projectsService.getActiveProjectOrThrow.mockResolvedValue(project);
      const createdTask = makeTask({ id: AUTOMATION_TASK_ID });
      tasksRepository.create.mockResolvedValue(createdTask);
      tasksRepository.findByIdActive.mockResolvedValue(createdTask);
      tasksRepository.updateById.mockResolvedValue(
        makeTask({ id: AUTOMATION_TASK_ID, labels: ['triage'] }),
      );

      await service.create(
        { title: 'x', project: PROJECT_ID, priority: 'P2' } as never,
        makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
      );

      expect(tasksRepository.updateById).toHaveBeenCalledWith(
        AUTOMATION_TASK_ID,
        expect.objectContaining({ labels: ['triage'] }),
      );
    });

    it("updateStatus() fires a matching StatusChanged rule's SetAssignee action, bypassing the triggering user's own lack of reassign permission", async () => {
      const project = makeProject({
        automationRules: [
          {
            id: 'r-1',
            name: 'Auto-reassign on Review',
            enabled: true,
            trigger: { type: AutomationTriggerType.STATUS_CHANGED, toStatus: TaskStatus.REVIEW },
            conditions: [],
            actions: [{ type: AutomationActionType.SET_ASSIGNEE, value: ASSIGNEE_ID }],
          },
        ],
      });
      // The triggering Developer IS the task's assignee, so their own status change is legal on
      // its own merits - a Developer could never call updateAssignee themselves though (that's
      // Admin/owning-Manager only), so the second updateById call below only happens because the
      // automation action bypasses that check.
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({
          id: AUTOMATION_TASK_ID,
          status: TaskStatus.IN_PROGRESS,
          assignee: { toString: () => DEV_ID },
        }),
      );
      projectsService.getActiveProjectOrThrow.mockResolvedValue(project);
      projectsService.isProjectMember.mockReturnValue(true);
      tasksRepository.updateById
        .mockResolvedValueOnce(makeTask({ id: AUTOMATION_TASK_ID, status: TaskStatus.REVIEW }))
        .mockResolvedValueOnce(
          makeTask({ id: AUTOMATION_TASK_ID, assignee: { toString: () => ASSIGNEE_ID } }),
        );

      await service.updateStatus(
        AUTOMATION_TASK_ID,
        TaskStatus.REVIEW,
        makeUser({ id: DEV_ID, role: Role.DEVELOPER }),
      );

      expect(tasksRepository.updateById).toHaveBeenCalledTimes(2);
      expect(tasksRepository.logActivity).toHaveBeenCalledWith(
        AUTOMATION_TASK_ID,
        DEV_ID,
        TaskActivityAction.REASSIGNED,
        DEV_ID,
        ASSIGNEE_ID,
        'Auto-reassign on Review',
      );
    });

    it('skips a rule action that would be an illegal transition, without breaking the underlying status change', async () => {
      const project = makeProject({
        automationRules: [
          {
            id: 'r-1',
            name: 'Bad rule',
            enabled: true,
            trigger: {
              type: AutomationTriggerType.STATUS_CHANGED,
              toStatus: TaskStatus.IN_PROGRESS,
            },
            conditions: [],
            // Todo -> Done isn't a legal transition in the default workflow (only Review -> Done is).
            actions: [{ type: AutomationActionType.SET_STATUS, value: TaskStatus.DONE }],
          },
        ],
      });
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({
          id: AUTOMATION_TASK_ID,
          status: TaskStatus.TODO,
          assignee: { toString: () => DEV_ID },
        }),
      );
      projectsService.getActiveProjectOrThrow.mockResolvedValue(project);
      tasksRepository.updateById.mockResolvedValue(
        makeTask({ id: AUTOMATION_TASK_ID, status: TaskStatus.IN_PROGRESS }),
      );

      await expect(
        service.updateStatus(
          AUTOMATION_TASK_ID,
          TaskStatus.IN_PROGRESS,
          makeUser({ id: DEV_ID, role: Role.DEVELOPER }),
        ),
      ).resolves.toBeDefined();

      // Only the original, human-initiated status change persisted - the illegal automation
      // action never reached tasksRepository.updateById a second time.
      expect(tasksRepository.updateById).toHaveBeenCalledTimes(1);
    });

    it('does not chain: an automation-caused status change does not itself re-fire rules', async () => {
      const project = makeProject({
        automationRules: [
          {
            id: 'r-1',
            name: 'Move to Review on In Progress',
            enabled: true,
            trigger: {
              type: AutomationTriggerType.STATUS_CHANGED,
              toStatus: TaskStatus.IN_PROGRESS,
            },
            conditions: [],
            actions: [{ type: AutomationActionType.SET_STATUS, value: TaskStatus.REVIEW }],
          },
          {
            id: 'r-2',
            name: 'Should never fire',
            enabled: true,
            trigger: { type: AutomationTriggerType.STATUS_CHANGED, toStatus: TaskStatus.REVIEW },
            conditions: [],
            actions: [{ type: AutomationActionType.ADD_LABELS, value: 'chained' }],
          },
        ],
      });
      tasksRepository.findByIdActive
        .mockResolvedValueOnce(
          makeTask({
            id: AUTOMATION_TASK_ID,
            status: TaskStatus.TODO,
            assignee: { toString: () => DEV_ID },
          }),
        )
        .mockResolvedValueOnce(
          makeTask({
            id: AUTOMATION_TASK_ID,
            status: TaskStatus.IN_PROGRESS,
            assignee: { toString: () => DEV_ID },
          }),
        )
        // The automation action's SET_STATUS re-enters the full updateStatus() method (bypassing
        // permission via ctx), which does its own findByIdActive fetch before applying REVIEW.
        .mockResolvedValueOnce(
          makeTask({
            id: AUTOMATION_TASK_ID,
            status: TaskStatus.IN_PROGRESS,
            assignee: { toString: () => DEV_ID },
          }),
        );
      projectsService.getActiveProjectOrThrow.mockResolvedValue(project);
      tasksRepository.updateById
        .mockResolvedValueOnce(makeTask({ id: AUTOMATION_TASK_ID, status: TaskStatus.IN_PROGRESS }))
        .mockResolvedValueOnce(makeTask({ id: AUTOMATION_TASK_ID, status: TaskStatus.REVIEW }));

      await service.updateStatus(
        AUTOMATION_TASK_ID,
        TaskStatus.IN_PROGRESS,
        makeUser({ id: DEV_ID, role: Role.DEVELOPER }),
      );

      // Rule 1 fires once (Todo->InProgress human change, then InProgress->Review automated
      // change = 2 updateById calls). If chaining were possible, rule 2 firing on the resulting
      // Review status would add a 3rd (AddLabels) update call.
      expect(tasksRepository.updateById).toHaveBeenCalledTimes(2);
    });

    it('a Webhook action logs the target URL and never makes a network call', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const project = makeProject({
        automationRules: [
          {
            id: 'r-1',
            name: 'Notify external system',
            enabled: true,
            trigger: { type: AutomationTriggerType.STATUS_CHANGED, toStatus: TaskStatus.DONE },
            conditions: [],
            actions: [{ type: AutomationActionType.WEBHOOK, value: 'https://example.com/hook' }],
          },
        ],
      });
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({
          id: AUTOMATION_TASK_ID,
          status: TaskStatus.REVIEW,
          assignee: { toString: () => DEV_ID },
        }),
      );
      projectsService.getActiveProjectOrThrow.mockResolvedValue(project);
      tasksRepository.updateById.mockResolvedValue(
        makeTask({ id: AUTOMATION_TASK_ID, status: TaskStatus.DONE }),
      );

      await service.updateStatus(
        AUTOMATION_TASK_ID,
        TaskStatus.DONE,
        makeUser({ id: DEV_ID, role: Role.DEVELOPER }),
      );

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('https://example.com/hook'));
      // Only the human-initiated status change persisted - the webhook action never calls
      // updateById (it never touches the task at all).
      expect(tasksRepository.updateById).toHaveBeenCalledTimes(1);
      logSpy.mockRestore();
    });

    it('a NotifyRole action in-app-notifies every project member holding that role', async () => {
      const project = makeProject({
        automationRules: [
          {
            id: 'r-1',
            name: 'Ping managers on Done',
            enabled: true,
            trigger: { type: AutomationTriggerType.STATUS_CHANGED, toStatus: TaskStatus.DONE },
            conditions: [],
            actions: [{ type: AutomationActionType.NOTIFY_ROLE, value: Role.MANAGER }],
          },
        ],
      });
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({
          id: AUTOMATION_TASK_ID,
          status: TaskStatus.REVIEW,
          assignee: { toString: () => DEV_ID },
        }),
      );
      projectsService.getActiveProjectOrThrow.mockResolvedValue(project);
      projectsService.membersWithRole.mockResolvedValue([
        { id: MANAGER_ID } as never,
        { id: OTHER_DEV_ID } as never,
      ]);
      tasksRepository.updateById.mockResolvedValue(
        makeTask({ id: AUTOMATION_TASK_ID, status: TaskStatus.DONE }),
      );

      await service.updateStatus(
        AUTOMATION_TASK_ID,
        TaskStatus.DONE,
        makeUser({ id: DEV_ID, role: Role.DEVELOPER }),
      );

      expect(projectsService.membersWithRole).toHaveBeenCalledWith(project, Role.MANAGER);
      expect(notificationsService.notifyAutomationRole).toHaveBeenCalledTimes(2);
      expect(notificationsService.notifyAutomationRole).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: MANAGER_ID, ruleName: 'Ping managers on Done' }),
      );
      expect(notificationsService.notifyAutomationRole).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: OTHER_DEV_ID }),
      );
    });

    it('with fromStatus scoping, a StatusChanged rule only fires from the configured source status', async () => {
      // Task jumps straight from Todo to Done via a custom workflow, bypassing Review - the rule
      // must not fire since the event's fromStatus (Todo) doesn't match the rule's (Review).
      const directWorkflow: Workflow = {
        statuses: [
          { name: TaskStatus.TODO, category: StatusCategory.TODO },
          { name: TaskStatus.DONE, category: StatusCategory.DONE },
        ],
        transitions: [{ from: TaskStatus.TODO, to: TaskStatus.DONE }],
        initialStatus: TaskStatus.TODO,
      };
      const project = makeProject({
        workflow: directWorkflow,
        automationRules: [
          {
            id: 'r-1',
            name: 'Only from Review',
            enabled: true,
            trigger: {
              type: AutomationTriggerType.STATUS_CHANGED,
              toStatus: TaskStatus.DONE,
              fromStatus: TaskStatus.REVIEW,
            },
            conditions: [],
            actions: [{ type: AutomationActionType.ADD_LABELS, value: 'shipped' }],
          },
        ],
      });
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({ status: TaskStatus.TODO, assignee: { toString: () => DEV_ID } }),
      );
      projectsService.getActiveProjectOrThrow.mockResolvedValue(project);
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: TaskStatus.DONE }));

      await service.updateStatus(
        AUTOMATION_TASK_ID,
        TaskStatus.DONE,
        makeUser({ id: DEV_ID, role: Role.DEVELOPER }),
      );

      // Only the human-initiated status change persisted - the fromStatus-scoped rule never fired.
      expect(tasksRepository.updateById).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkSlaBreaches', () => {
    function makeSlaCandidate(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        id: 'task-sla-1',
        title: 'Slow task',
        priority: 'P1',
        project: { toString: () => PROJECT_ID },
        createdAt: new Date(Date.now() - 100 * 60 * 60 * 1000), // 100h ago
        completedAt: null,
        ...overrides,
      } as never;
    }

    it('fires the SlaBreach scheme entry and marks the task notified once it has actually breached', async () => {
      tasksRepository.findOpenTasksUnnotifiedForSla.mockResolvedValue([makeSlaCandidate()]);
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({
          notificationScheme: [
            {
              event: 'SlaBreach',
              notifyRoles: ['Manager'],
              channels: ['InApp'],
            },
          ],
        }),
      );
      projectsService.membersWithRole.mockResolvedValue([{ id: MANAGER_ID } as never]);

      await service.checkSlaBreaches();

      expect(notificationsService.notifySchemeEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'SlaBreach',
          recipient: expect.objectContaining({ id: MANAGER_ID }),
        }),
      );
      expect(tasksRepository.markSlaBreachNotified).toHaveBeenCalledWith('task-sla-1');
    });

    it('does not fire or mark a task that has not yet breached its SLA target', async () => {
      tasksRepository.findOpenTasksUnnotifiedForSla.mockResolvedValue([
        makeSlaCandidate({ createdAt: new Date() }), // just created, nowhere near the 8h P1 target
      ]);
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({
          notificationScheme: [
            { event: 'SlaBreach', notifyRoles: ['Manager'], channels: ['InApp'] },
          ],
        }),
      );

      await service.checkSlaBreaches();

      expect(notificationsService.notifySchemeEvent).not.toHaveBeenCalled();
      expect(tasksRepository.markSlaBreachNotified).not.toHaveBeenCalled();
    });

    it('marks a breached task notified even when its project has no SlaBreach scheme entry configured (never re-checked again)', async () => {
      tasksRepository.findOpenTasksUnnotifiedForSla.mockResolvedValue([makeSlaCandidate()]);
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({ notificationScheme: [] }),
      );

      await service.checkSlaBreaches();

      expect(notificationsService.notifySchemeEvent).not.toHaveBeenCalled();
      expect(tasksRepository.markSlaBreachNotified).toHaveBeenCalledWith('task-sla-1');
    });
  });

  describe('softDelete', () => {
    it('deletes the task and logs a DELETED activity entry', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask());
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());

      await service.softDelete('task-1', makeUser());

      expect(tasksRepository.softDelete).toHaveBeenCalledWith('task-1');
      expect(tasksRepository.logActivity).toHaveBeenCalledWith(
        'task-1',
        ADMIN_ID,
        TaskActivityAction.DELETED,
      );
    });

    it('delegates the manage-permission check to ProjectsService and propagates its rejection', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask());
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      projectsService.assertUserCanManageOrGranted.mockImplementation(() => {
        throw new ForbiddenException('You do not have permission to manage this project');
      });

      await expect(service.softDelete('task-1', makeUser())).rejects.toThrow(ForbiddenException);
      expect(tasksRepository.softDelete).not.toHaveBeenCalled();
    });
  });
});
