export interface EmailPayload {
  to: string;
  subject: string;
  template: string;
  data: Record<string, unknown>;
}

/**
 * Swappable email transport. The only implementation today, LoggingEmailService, just logs the
 * payload - swapping in a real provider later (SES, Postmark, ...) means writing one new class
 * and changing the EMAIL_SERVICE provider registration in NotificationsModule, nothing else.
 */
export interface IEmailService {
  send(payload: EmailPayload): Promise<void>;
}
