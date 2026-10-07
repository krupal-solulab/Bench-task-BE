export interface EmailPayload {
  to: string;
  subject: string;
  template: string;
  data: Record<string, unknown>;
  /** Rendered HTML body (sent alongside the plain-text one) - e.g. from an EJS template. */
  html?: string;
  /** Secret values (e.g. a temporary password) to mask wherever the email is logged. */
  redact?: string[];
}

/**
 * Swappable email transport. The only implementation today, LoggingEmailService, just logs the
 * payload - swapping in a real provider later (SES, Postmark, ...) means writing one new class
 * and changing the EMAIL_SERVICE provider registration in NotificationsModule, nothing else.
 */
export interface IEmailService {
  /** False when emails are only logged (no provider configured) - nothing reaches an inbox. */
  readonly delivers?: boolean;
  send(payload: EmailPayload): Promise<void>;
}
