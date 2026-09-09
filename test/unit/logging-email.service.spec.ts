import { PinoLogger } from 'nestjs-pino';
import { LoggingEmailService } from 'src/notifications/logging-email.service';

function makeLogger(): PinoLogger {
  return { info: jest.fn() } as unknown as PinoLogger;
}

describe('LoggingEmailService', () => {
  it('logs the payload instead of sending a real email', async () => {
    const logger = makeLogger();
    const service = new LoggingEmailService(logger);

    await service.send({
      to: 'dev@example.com',
      subject: 'You have been assigned: Fix the bug',
      template: 'task-assigned',
      data: { taskId: 't1' },
    });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        email: expect.objectContaining({ to: 'dev@example.com', subject: expect.any(String) }),
      }),
      expect.any(String),
    );
  });
});
