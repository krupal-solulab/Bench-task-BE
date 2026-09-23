// Deliberately separate from TaskPriority (P1/P2/P3) - Tickets are a genuinely separate domain
// from Tasks (support cases vs. engineering work items), and Zendesk-style priority naming reads
// more naturally for a support agent than reusing the PM-tool's P1/P2/P3 convention.
export enum TicketPriority {
  LOW = 'Low',
  NORMAL = 'Normal',
  HIGH = 'High',
  URGENT = 'Urgent',
}
