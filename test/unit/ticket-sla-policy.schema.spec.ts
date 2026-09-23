import { CustomerTier } from 'src/common/enums/customer-tier.enum';
import { TicketPriority } from 'src/common/enums/ticket-priority.enum';
import {
  DEFAULT_TICKET_SLA_POLICY,
  TicketSlaPolicyEntry,
  isTicketSlaApproachingBreach,
  isTicketSlaBreached,
  resolveTicketSlaEntry,
} from 'src/modules/tickets/schemas/ticket-sla-policy.schema';
import { TicketChannel } from 'src/modules/tickets/schemas/ticket.schema';

const HOUR_MS = 60 * 60 * 1000;

describe('resolveTicketSlaEntry', () => {
  it('falls back to the system default policy when the org has none configured', () => {
    const entry = resolveTicketSlaEntry([], {
      priority: TicketPriority.URGENT,
      customerTier: CustomerTier.STANDARD,
      channel: TicketChannel.MANUAL,
    });
    expect(entry).toEqual(
      DEFAULT_TICKET_SLA_POLICY.find((e) => e.priority === TicketPriority.URGENT),
    );
  });

  it('picks a priority-only wildcard entry when no more specific one matches', () => {
    const policy: TicketSlaPolicyEntry[] = [
      {
        priority: TicketPriority.HIGH,
        customerTier: null,
        channel: null,
        firstResponseHours: 2,
        resolutionHours: 8,
        escalationChain: [],
      },
    ];
    const entry = resolveTicketSlaEntry(policy, {
      priority: TicketPriority.HIGH,
      customerTier: CustomerTier.STANDARD,
      channel: TicketChannel.MANUAL,
    });
    expect(entry?.resolutionHours).toBe(8);
  });

  it('prefers a more specific (tier and/or channel) entry over a wildcard one', () => {
    const wildcard: TicketSlaPolicyEntry = {
      priority: TicketPriority.HIGH,
      customerTier: null,
      channel: null,
      firstResponseHours: 2,
      resolutionHours: 8,
      escalationChain: [],
    };
    const specific: TicketSlaPolicyEntry = {
      priority: TicketPriority.HIGH,
      customerTier: CustomerTier.ENTERPRISE,
      channel: null,
      firstResponseHours: 1,
      resolutionHours: 4,
      escalationChain: [],
    };
    const entry = resolveTicketSlaEntry([wildcard, specific], {
      priority: TicketPriority.HIGH,
      customerTier: CustomerTier.ENTERPRISE,
      channel: TicketChannel.MANUAL,
    });
    expect(entry?.resolutionHours).toBe(4);

    const fallback = resolveTicketSlaEntry([wildcard, specific], {
      priority: TicketPriority.HIGH,
      customerTier: CustomerTier.STANDARD,
      channel: TicketChannel.MANUAL,
    });
    expect(fallback?.resolutionHours).toBe(8);
  });

  it('returns null when no entry matches the given priority at all', () => {
    const policy: TicketSlaPolicyEntry[] = [
      {
        priority: TicketPriority.LOW,
        customerTier: null,
        channel: null,
        firstResponseHours: 24,
        resolutionHours: 72,
        escalationChain: [],
      },
    ];
    const entry = resolveTicketSlaEntry(policy, {
      priority: TicketPriority.URGENT,
      customerTier: CustomerTier.STANDARD,
      channel: TicketChannel.MANUAL,
    });
    expect(entry).toBeNull();
  });
});

describe('isTicketSlaBreached / isTicketSlaApproachingBreach', () => {
  const entry: TicketSlaPolicyEntry = {
    priority: TicketPriority.HIGH,
    customerTier: null,
    channel: null,
    firstResponseHours: 2,
    resolutionHours: 8,
    escalationChain: [],
  };

  it('is not breached before the resolution target elapses', () => {
    expect(isTicketSlaBreached('resolution', entry, 7 * HOUR_MS)).toBe(false);
  });

  it('is breached once elapsed business time passes the resolution target', () => {
    expect(isTicketSlaBreached('resolution', entry, 8.5 * HOUR_MS)).toBe(true);
  });

  it('is in the approaching-breach window inside the lead time but not yet breached', () => {
    // 8h target, 2h lead -> approaching window is [6h, 8h).
    expect(isTicketSlaApproachingBreach('resolution', entry, 7 * HOUR_MS, 2)).toBe(true);
    expect(isTicketSlaApproachingBreach('resolution', entry, 5 * HOUR_MS, 2)).toBe(false);
    expect(isTicketSlaApproachingBreach('resolution', entry, 8 * HOUR_MS, 2)).toBe(false);
  });
});
