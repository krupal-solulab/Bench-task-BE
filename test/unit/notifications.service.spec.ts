import { NotFoundException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { IEmailService } from 'src/notifications/email.interface';
import { NotificationsService } from 'src/notifications/notifications.service';
import { NotificationsRepository } from 'src/notifications/notifications.repository';
import { NotificationType } from 'src/notifications/schemas/notification.schema';
import {
  NotificationChannel,
  NotificationSchemeEvent,
} from 'src/modules/projects/schemas/notification-scheme.schema';
import { UsersRepository } from 'src/modules/users/users.repository';
import { EventsGateway } from 'src/events/events.gateway';

const ORG_A = '507f1f77bcf86cd799439099';
const ASSIGNEE_ID = '507f1f77bcf86cd799439001';
// NotificationsService wraps this in `new Types.ObjectId(...)` when writing the in-app row, so
// it must be a real 24-char hex string, not an arbitrary label.
const TASK_ID = '507f1f77bcf86cd799439010';

function makeLogger(): PinoLogger {
  return { warn: jest.fn(), info: jest.fn() } as unknown as PinoLogger;
}

function makeAssignee(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: ASSIGNEE_ID,
    name: 'Dana Developer',
    email: 'dana@example.com',
    organizationId: { toString: () => ORG_A },
    ...overrides,
  } as never;
}

describe('NotificationsService', () => {
  let emailService: jest.Mocked<IEmailService>;
  let usersRepository: jest.Mocked<Pick<UsersRepository, 'findById'>>;
  let notificationsRepository: jest.Mocked<
    Pick<
      NotificationsRepository,
      | 'create'
      | 'findById'
      | 'paginate'
      | 'countUnread'
      | 'markRead'
      | 'markAllRead'
      | 'findPreference'
      | 'upsertPreference'
    >
  >;
  let eventsGateway: jest.Mocked<Pick<EventsGateway, 'emitNotificationCreated'>>;
  let logger: PinoLogger;
  let service: NotificationsService;

  beforeEach(() => {
    emailService = { send: jest.fn().mockResolvedValue(undefined) };
    usersRepository = { findById: jest.fn() };
    notificationsRepository = {
      create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
      findById: jest.fn(),
      paginate: jest.fn(),
      countUnread: jest.fn(),
      markRead: jest.fn(),
      markAllRead: jest.fn(),
      // Default: no preference document yet - matches every existing user's real state, and
      // must mean "receive everything" (today's behavior for anyone who never opens the bell).
      findPreference: jest.fn().mockResolvedValue(null),
      upsertPreference: jest.fn(),
    };
    eventsGateway = { emitNotificationCreated: jest.fn() };
    logger = makeLogger();
    service = new NotificationsService(
      emailService,
      usersRepository as unknown as UsersRepository,
      notificationsRepository as unknown as NotificationsRepository,
      eventsGateway as unknown as EventsGateway,
      logger,
    );
  });

  describe('notifyTaskAssigned', () => {
    it('sends an email to the assignee with the expected payload', async () => {
      usersRepository.findById.mockResolvedValue(makeAssignee());

      await service.notifyTaskAssigned({
        taskId: TASK_ID,
        taskTitle: 'Fix the bug',
        assigneeId: ASSIGNEE_ID,
        actorEmail: 'manager@example.com',
      });

      expect(emailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'dana@example.com',
          subject: expect.stringContaining('Fix the bug'),
          template: 'task-assigned',
          data: expect.objectContaining({
            taskId: TASK_ID,
            assigneeName: 'Dana Developer',
            actorEmail: 'manager@example.com',
          }),
        }),
      );
    });

    it('also creates an in-app notification and pushes it over the socket (new in this phase)', async () => {
      usersRepository.findById.mockResolvedValue(makeAssignee());

      await service.notifyTaskAssigned({
        taskId: TASK_ID,
        taskTitle: 'Fix the bug',
        assigneeId: ASSIGNEE_ID,
        actorEmail: 'manager@example.com',
      });

      expect(notificationsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationType.TASK_ASSIGNED }),
      );
      expect(eventsGateway.emitNotificationCreated).toHaveBeenCalledWith({
        recipientId: ASSIGNEE_ID,
        notificationId: 'notif-1',
      });
    });

    it('does not create an in-app notification when the recipient has muted the type', async () => {
      usersRepository.findById.mockResolvedValue(makeAssignee());
      notificationsRepository.findPreference.mockResolvedValue({
        mutedTypes: [NotificationType.TASK_ASSIGNED],
      } as never);

      await service.notifyTaskAssigned({
        taskId: TASK_ID,
        taskTitle: 'Fix the bug',
        assigneeId: ASSIGNEE_ID,
        actorEmail: 'manager@example.com',
      });

      // The email is unaffected by the mute preference - only the in-app row is gated by it.
      expect(emailService.send).toHaveBeenCalled();
      expect(notificationsRepository.create).not.toHaveBeenCalled();
      expect(eventsGateway.emitNotificationCreated).not.toHaveBeenCalled();
    });

    it('does nothing when the assignee cannot be found', async () => {
      usersRepository.findById.mockResolvedValue(null);

      await service.notifyTaskAssigned({
        taskId: TASK_ID,
        taskTitle: 'Fix the bug',
        assigneeId: 'missing-user',
        actorEmail: 'manager@example.com',
      });

      expect(emailService.send).not.toHaveBeenCalled();
      expect(notificationsRepository.create).not.toHaveBeenCalled();
    });

    it('swallows errors instead of throwing, and logs a warning', async () => {
      usersRepository.findById.mockRejectedValue(new Error('db down'));

      await expect(
        service.notifyTaskAssigned({
          taskId: TASK_ID,
          taskTitle: 'Fix the bug',
          assigneeId: ASSIGNEE_ID,
          actorEmail: 'manager@example.com',
        }),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('swallows an email transport failure instead of throwing', async () => {
      usersRepository.findById.mockResolvedValue(makeAssignee());
      emailService.send.mockRejectedValue(new Error('smtp unavailable'));

      await expect(
        service.notifyTaskAssigned({
          taskId: TASK_ID,
          taskTitle: 'Fix the bug',
          assigneeId: ASSIGNEE_ID,
          actorEmail: 'manager@example.com',
        }),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
      // The in-app row is independent of the email transport - it should still be created even
      // though the email failed.
      expect(notificationsRepository.create).toHaveBeenCalled();
    });
  });

  describe('notifyTaskDueSoon', () => {
    it('sends an email with the due date in the payload, and creates an in-app notification', async () => {
      usersRepository.findById.mockResolvedValue(makeAssignee());
      const dueDate = new Date('2026-01-01T00:00:00.000Z');

      await service.notifyTaskDueSoon({
        taskId: TASK_ID,
        taskTitle: 'Fix the bug',
        assigneeId: ASSIGNEE_ID,
        dueDate,
      });

      expect(emailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'dana@example.com',
          template: 'task-due-soon',
          data: expect.objectContaining({ dueDate: dueDate.toISOString() }),
        }),
      );
      expect(notificationsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationType.DUE_SOON }),
      );
    });

    it('does nothing when the assignee cannot be found', async () => {
      usersRepository.findById.mockResolvedValue(null);

      await service.notifyTaskDueSoon({
        taskId: TASK_ID,
        taskTitle: 'Fix the bug',
        assigneeId: 'missing-user',
        dueDate: new Date(),
      });

      expect(emailService.send).not.toHaveBeenCalled();
      expect(notificationsRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('notifyStatusChanged', () => {
    it('creates an in-app notification for the assignee', async () => {
      usersRepository.findById.mockResolvedValue(makeAssignee());

      await service.notifyStatusChanged({
        taskId: TASK_ID,
        taskTitle: 'Fix the bug',
        assigneeId: ASSIGNEE_ID,
        actorId: 'someone-else',
        fromStatus: 'Todo',
        toStatus: 'In Progress',
      });

      expect(notificationsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationType.STATUS_CHANGED }),
      );
      expect(eventsGateway.emitNotificationCreated).toHaveBeenCalled();
    });

    it('never notifies a user about their own change', async () => {
      await service.notifyStatusChanged({
        taskId: TASK_ID,
        taskTitle: 'Fix the bug',
        assigneeId: ASSIGNEE_ID,
        actorId: ASSIGNEE_ID,
        fromStatus: 'Todo',
        toStatus: 'In Progress',
      });

      expect(usersRepository.findById).not.toHaveBeenCalled();
      expect(notificationsRepository.create).not.toHaveBeenCalled();
    });

    it('is skipped when the muted type matches, without throwing', async () => {
      usersRepository.findById.mockResolvedValue(makeAssignee());
      notificationsRepository.findPreference.mockResolvedValue({
        mutedTypes: [NotificationType.STATUS_CHANGED],
      } as never);

      await expect(
        service.notifyStatusChanged({
          taskId: TASK_ID,
          taskTitle: 'Fix the bug',
          assigneeId: ASSIGNEE_ID,
          actorId: 'someone-else',
          fromStatus: 'Todo',
          toStatus: 'In Progress',
        }),
      ).resolves.toBeUndefined();
      expect(notificationsRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('notifyCommentAdded', () => {
    it('creates an in-app notification for the assignee', async () => {
      usersRepository.findById.mockResolvedValue(makeAssignee());

      await service.notifyCommentAdded({
        taskId: TASK_ID,
        taskTitle: 'Fix the bug',
        assigneeId: ASSIGNEE_ID,
        actorId: 'commenter-1',
        commentAuthorName: 'commenter@example.com',
      });

      expect(notificationsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationType.COMMENT_ADDED }),
      );
    });

    it('never notifies a user commenting on their own task', async () => {
      await service.notifyCommentAdded({
        taskId: TASK_ID,
        taskTitle: 'Fix the bug',
        assigneeId: ASSIGNEE_ID,
        actorId: ASSIGNEE_ID,
        commentAuthorName: 'dana@example.com',
      });

      expect(notificationsRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('notifySchemeEvent', () => {
    const RECIPIENT = { id: ASSIGNEE_ID, email: 'dana@example.com', organizationId: ORG_A };

    it('creates an in-app notification when InApp is among the selected channels', async () => {
      await service.notifySchemeEvent({
        recipient: RECIPIENT,
        event: NotificationSchemeEvent.COMMENTED,
        channels: [NotificationChannel.IN_APP],
        title: 'title',
        message: 'message',
        taskId: TASK_ID,
      });

      expect(notificationsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.SCHEME,
          title: 'title',
          message: 'message',
        }),
      );
      expect(emailService.send).not.toHaveBeenCalled();
    });

    it('sends an email when Email is among the selected channels', async () => {
      await service.notifySchemeEvent({
        recipient: RECIPIENT,
        event: NotificationSchemeEvent.SPRINT_STARTED,
        channels: [NotificationChannel.EMAIL],
        title: 'Sprint 1 started',
        message: 'message',
      });

      expect(emailService.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'dana@example.com', subject: 'Sprint 1 started' }),
      );
      expect(notificationsRepository.create).not.toHaveBeenCalled();
    });

    it('logs a "would send" line for WhatsApp instead of attempting real delivery (no provider configured)', async () => {
      await service.notifySchemeEvent({
        recipient: RECIPIENT,
        event: NotificationSchemeEvent.TRANSITIONED,
        channels: [NotificationChannel.WHATSAPP],
        title: 'Moved to Done',
        message: 'message',
      });

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('dana@example.com'));
      expect(emailService.send).not.toHaveBeenCalled();
      expect(notificationsRepository.create).not.toHaveBeenCalled();
    });

    it('fires every selected channel when more than one is configured', async () => {
      await service.notifySchemeEvent({
        recipient: RECIPIENT,
        event: NotificationSchemeEvent.ASSIGNED,
        channels: [
          NotificationChannel.IN_APP,
          NotificationChannel.EMAIL,
          NotificationChannel.WHATSAPP,
        ],
        title: 'title',
        message: 'message',
      });

      expect(notificationsRepository.create).toHaveBeenCalled();
      expect(emailService.send).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalled();
    });

    it('does nothing when no channel is selected', async () => {
      await service.notifySchemeEvent({
        recipient: RECIPIENT,
        event: NotificationSchemeEvent.ASSIGNED,
        channels: [],
        title: 'title',
        message: 'message',
      });

      expect(notificationsRepository.create).not.toHaveBeenCalled();
      expect(emailService.send).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('swallows an email transport failure instead of throwing (consistent with every other email-sending method)', async () => {
      emailService.send.mockRejectedValue(new Error('smtp unavailable'));

      await expect(
        service.notifySchemeEvent({
          recipient: RECIPIENT,
          event: NotificationSchemeEvent.SPRINT_COMPLETED,
          channels: [NotificationChannel.EMAIL],
          title: 'title',
          message: 'message',
        }),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('markRead', () => {
    it('rejects when the notification does not exist', async () => {
      notificationsRepository.findById.mockResolvedValue(null);
      await expect(service.markRead('notif-1', ASSIGNEE_ID)).rejects.toThrow(NotFoundException);
    });

    it('rejects a non-owner with the same 404 (never leaking existence)', async () => {
      notificationsRepository.findById.mockResolvedValue({
        id: 'notif-1',
        recipient: { toString: () => ASSIGNEE_ID },
        readAt: null,
      } as never);
      await expect(service.markRead('notif-1', 'someone-else')).rejects.toThrow(NotFoundException);
      expect(notificationsRepository.markRead).not.toHaveBeenCalled();
    });

    it('marks an owned, unread notification as read', async () => {
      notificationsRepository.findById.mockResolvedValue({
        id: 'notif-1',
        recipient: { toString: () => ASSIGNEE_ID },
        readAt: null,
      } as never);

      await service.markRead('notif-1', ASSIGNEE_ID);

      expect(notificationsRepository.markRead).toHaveBeenCalledWith('notif-1');
    });

    it('is a no-op for an already-read notification', async () => {
      notificationsRepository.findById.mockResolvedValue({
        id: 'notif-1',
        recipient: { toString: () => ASSIGNEE_ID },
        readAt: new Date(),
      } as never);

      await service.markRead('notif-1', ASSIGNEE_ID);

      expect(notificationsRepository.markRead).not.toHaveBeenCalled();
    });
  });

  describe('preferences', () => {
    it('defaults to an empty muted list (receive everything) when nothing is saved yet', async () => {
      notificationsRepository.findPreference.mockResolvedValue(null);
      await expect(service.getPreferences(ASSIGNEE_ID)).resolves.toEqual({ mutedTypes: [] });
    });

    it('upserts the preference scoped to the caller', async () => {
      notificationsRepository.upsertPreference.mockResolvedValue({
        mutedTypes: [NotificationType.DUE_SOON],
      } as never);

      const result = await service.updatePreferences(ASSIGNEE_ID, ORG_A, {
        mutedTypes: [NotificationType.DUE_SOON],
      });

      expect(notificationsRepository.upsertPreference).toHaveBeenCalledWith(ASSIGNEE_ID, ORG_A, [
        NotificationType.DUE_SOON,
      ]);
      expect(result).toEqual({ mutedTypes: [NotificationType.DUE_SOON] });
    });
  });
});
