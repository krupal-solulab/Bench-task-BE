// Fixed, Zendesk-standard ticket states - unlike Task.status (free-form, per-project custom
// workflow), tickets have no per-org customizable workflow in this phase, so this is a real
// Mongoose enum constraint, not just a default.
export enum TicketStatus {
  NEW = 'New',
  OPEN = 'Open',
  PENDING = 'Pending',
  SOLVED = 'Solved',
  CLOSED = 'Closed',
}

// Denormalized from `status` (see TicketsService), same role as Task's StatusCategory: lets
// cross-cutting logic (the SLA clock, in particular) branch on category rather than status name.
// Paused is what makes "Pending pauses the SLA clock" a category check, not a string match.
export enum TicketStatusCategory {
  OPEN = 'Open',
  PAUSED = 'Paused',
  TERMINAL = 'Terminal',
}

export function categoryOfTicketStatus(status: TicketStatus): TicketStatusCategory {
  switch (status) {
    case TicketStatus.NEW:
    case TicketStatus.OPEN:
      return TicketStatusCategory.OPEN;
    case TicketStatus.PENDING:
      return TicketStatusCategory.PAUSED;
    case TicketStatus.SOLVED:
    case TicketStatus.CLOSED:
      return TicketStatusCategory.TERMINAL;
  }
}
