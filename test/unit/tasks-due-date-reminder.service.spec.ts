import { PinoLogger } from 'nestjs-pino';
import { Types } from 'mongoose';
import { TasksDueDateReminderService } from 'src/modules/tasks/tasks-due-date-reminder.service';
import { TasksRepository } from 'src/modules/tasks/tasks.repository';
import { NotificationsService } from 'src/notifications/notifications.service';

function makeLogger(): PinoLogger {
  return { debug: jest.fn(), warn: jest.fn() } as unknown as PinoLogger;
}

describe('TasksDueDateReminderService', () => {
  let tasksRepository: jest.Mocked<
    Pick<TasksRepository, 'findDueSoonUnnotified' | 'markDueDateNotified'>
  >;
  let notificationsService: jest.Mocked<Pick<NotificationsService, 'notifyTaskDueSoon'>>;
  let service: TasksDueDateReminderService;

  beforeEach(() => {
    tasksRepository = {
      findDueSoonUnnotified: jest.fn(),
      markDueDateNotified: jest.fn().mockResolvedValue(undefined),
    };
    notificationsService = { notifyTaskDueSoon: jest.fn().mockResolvedValue(undefined) };
    service = new TasksDueDateReminderService(
      tasksRepository as unknown as TasksRepository,
      notificationsService as unknown as NotificationsService,
      makeLogger(),
    );
  });

  it('notifies and marks each due-soon task returned by the repository', async () => {
    const assigneeId = new Types.ObjectId();
    const dueDate = new Date();
    tasksRepository.findDueSoonUnnotified.mockResolvedValue([
      { id: 'task-1', title: 'Ship the feature', assignee: assigneeId, dueDate } as never,
      { id: 'task-2', title: 'Write the docs', assignee: assigneeId, dueDate } as never,
    ]);

    await service.handleDueSoonReminders();

    expect(notificationsService.notifyTaskDueSoon).toHaveBeenCalledTimes(2);
    expect(notificationsService.notifyTaskDueSoon).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', taskTitle: 'Ship the feature', dueDate }),
    );
    expect(tasksRepository.markDueDateNotified).toHaveBeenCalledWith('task-1');
    expect(tasksRepository.markDueDateNotified).toHaveBeenCalledWith('task-2');
  });

  it('queries with a ~24h window from now', async () => {
    tasksRepository.findDueSoonUnnotified.mockResolvedValue([]);

    await service.handleDueSoonReminders();

    expect(tasksRepository.findDueSoonUnnotified).toHaveBeenCalledTimes(1);
    const [now, threshold] = tasksRepository.findDueSoonUnnotified.mock.calls[0] as [Date, Date];
    const diffHours = (threshold.getTime() - now.getTime()) / (60 * 60 * 1000);
    expect(diffHours).toBeCloseTo(24, 5);
  });

  it('skips a task with no assignee or due date without calling notify', async () => {
    tasksRepository.findDueSoonUnnotified.mockResolvedValue([
      { id: 'task-1', title: 'Orphaned task', assignee: null, dueDate: new Date() } as never,
    ]);

    await service.handleDueSoonReminders();

    expect(notificationsService.notifyTaskDueSoon).not.toHaveBeenCalled();
    expect(tasksRepository.markDueDateNotified).not.toHaveBeenCalled();
  });

  it('does nothing when no tasks are due soon', async () => {
    tasksRepository.findDueSoonUnnotified.mockResolvedValue([]);

    await service.handleDueSoonReminders();

    expect(notificationsService.notifyTaskDueSoon).not.toHaveBeenCalled();
    expect(tasksRepository.markDueDateNotified).not.toHaveBeenCalled();
  });
});
