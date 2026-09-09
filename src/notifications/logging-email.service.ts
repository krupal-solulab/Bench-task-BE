import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { EmailPayload, IEmailService } from './email.interface';

/** No real provider is configured for this project - every "send" is just logged at info level. */
@Injectable()
export class LoggingEmailService implements IEmailService {
  constructor(@InjectPinoLogger(LoggingEmailService.name) private readonly logger: PinoLogger) {}

  async send(payload: EmailPayload): Promise<void> {
    this.logger.info({ email: payload }, 'would send email (logging only, no provider configured)');
  }
}
