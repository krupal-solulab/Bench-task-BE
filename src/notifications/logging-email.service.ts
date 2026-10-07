import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { EmailPayload, IEmailService } from './email.interface';

/** Masks every `payload.redact` value (e.g. an invite's temporary password) in a log-safe copy. */
export function redactEmailPayload(payload: EmailPayload): Omit<EmailPayload, 'redact'> {
  const { redact = [], ...rest } = payload;
  let json = JSON.stringify(rest);
  for (const secret of redact) {
    if (secret) json = json.split(JSON.stringify(secret).slice(1, -1)).join('[REDACTED]');
  }
  return JSON.parse(json) as Omit<EmailPayload, 'redact'>;
}

/** No real provider is configured for this project - every "send" is just logged at info level. */
@Injectable()
export class LoggingEmailService implements IEmailService {
  readonly delivers = false;

  constructor(@InjectPinoLogger(LoggingEmailService.name) private readonly logger: PinoLogger) {}

  async send(payload: EmailPayload): Promise<void> {
    this.logger.info(
      { email: redactEmailPayload(payload) },
      'would send email (logging only, no provider configured)',
    );
  }
}
