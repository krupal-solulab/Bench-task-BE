import { PinoLogger } from 'nestjs-pino';
import { IEmailService } from 'src/notifications/email.interface';
import { NotificationsService } from 'src/notifications/notifications.service';
import { UsersRepository } from 'src/modules/users/users.repository';

function makeLogger(): PinoLogger {
  return { warn: jest.fn() } as unknown as PinoLogger;
}

describe('NotificationsService', () => {
  let emailService: jest.Mocked<IEmailService>;
  let usersRepository: jest.Mocked<Pick<UsersRepository, 'findById'>>;
  let logger: PinoLogger;
  let service: NotificationsService;

  beforeEach(() => {
    emailService = { send: jest.fn().mockResolvedValue(undefined) };
    usersRepository = { findById: jest.fn() };
    logger = makeLogger();
    service = new NotificationsService(
      emailService,
      usersRepository as unknown as UsersRepository,
      logger,
    );
  });

  describe('notifyTaskAssigned', () => {
    it('sends an email to the assignee with the expected payload', async () => {
      usersRepository.findById.mockResolvedValue({
        id: 'user-1',
        name: 'Dana Developer',
        email: 'dana@example.com',
      } as never);

      await service.notifyTaskAssigned({
        taskId: 'task-1',
        taskTitle: 'Fix the bug',
        assigneeId: 'user-1',
        actorEmail: 'manager@example.com',
      });

      expect(emailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'dana@example.com',
          subject: expect.stringContaining('Fix the bug'),
          template: 'task-assigned',
          data: expect.objectContaining({
            taskId: 'task-1',
            assigneeName: 'Dana Developer',
            actorEmail: 'manager@example.com',
          }),
        }),
      );
    });

    it('does nothing when the assignee cannot be found', async () => {
      usersRepository.findById.mockResolvedValue(null);

      await service.notifyTaskAssigned({
        taskId: 'task-1',
        taskTitle: 'Fix the bug',
        assigneeId: 'missing-user',
        actorEmail: 'manager@example.com',
      });

      expect(emailService.send).not.toHaveBeenCalled();
    });

    it('swallows errors instead of throwing, and logs a warning', async () => {
      usersRepository.findById.mockRejectedValue(new Error('db down'));

      await expect(
        service.notifyTaskAssigned({
          taskId: 'task-1',
          taskTitle: 'Fix the bug',
          assigneeId: 'user-1',
          actorEmail: 'manager@example.com',
        }),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('swallows an email transport failure instead of throwing', async () => {
      usersRepository.findById.mockResolvedValue({
        id: 'user-1',
        name: 'Dana Developer',
        email: 'dana@example.com',
      } as never);
      emailService.send.mockRejectedValue(new Error('smtp unavailable'));

      await expect(
        service.notifyTaskAssigned({
          taskId: 'task-1',
          taskTitle: 'Fix the bug',
          assigneeId: 'user-1',
          actorEmail: 'manager@example.com',
        }),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('notifyTaskDueSoon', () => {
    it('sends an email with the due date in the payload', async () => {
      usersRepository.findById.mockResolvedValue({
        id: 'user-1',
        name: 'Dana Developer',
        email: 'dana@example.com',
      } as never);
      const dueDate = new Date('2026-01-01T00:00:00.000Z');

      await service.notifyTaskDueSoon({
        taskId: 'task-1',
        taskTitle: 'Fix the bug',
        assigneeId: 'user-1',
        dueDate,
      });

      expect(emailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'dana@example.com',
          template: 'task-due-soon',
          data: expect.objectContaining({ dueDate: dueDate.toISOString() }),
        }),
      );
    });

    it('does nothing when the assignee cannot be found', async () => {
      usersRepository.findById.mockResolvedValue(null);

      await service.notifyTaskDueSoon({
        taskId: 'task-1',
        taskTitle: 'Fix the bug',
        assigneeId: 'missing-user',
        dueDate: new Date(),
      });

      expect(emailService.send).not.toHaveBeenCalled();
    });
  });
});
