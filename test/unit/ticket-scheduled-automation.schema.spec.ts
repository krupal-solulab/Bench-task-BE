import { TicketAutomationActionType } from 'src/modules/tickets/schemas/ticket-automation-rule.schema';
import {
  ScheduledAutomationCandidate,
  TicketScheduledAutomation,
  evaluateScheduledAutomations,
} from 'src/modules/tickets/schemas/ticket-scheduled-automation.schema';
import { TicketStatus } from 'src/common/enums/ticket-status.enum';

function makeAutomation(
  overrides: Partial<TicketScheduledAutomation> = {},
): TicketScheduledAutomation {
  return {
    id: 'auto-1',
    name: 'Auto-close stale pending',
    enabled: true,
    matchStatus: TicketStatus.PENDING,
    afterHours: 72,
    conditions: [],
    actions: [{ type: TicketAutomationActionType.SET_STATUS, value: 'Closed' }],
    ...overrides,
  };
}

function makeCandidate(
  overrides: Partial<ScheduledAutomationCandidate> = {},
): ScheduledAutomationCandidate {
  return {
    status: TicketStatus.PENDING,
    statusHours: 100,
    firedScheduledAutomationIds: [],
    priority: 'Normal',
    channel: 'manual',
    customerTier: 'Standard',
    tags: [],
    ...overrides,
  };
}

describe('evaluateScheduledAutomations', () => {
  it('fires when the ticket has been in matchStatus at least afterHours', () => {
    const fired = evaluateScheduledAutomations([makeAutomation()], makeCandidate());
    expect(fired).toHaveLength(1);
  });

  it('does not fire before the threshold elapses', () => {
    const fired = evaluateScheduledAutomations(
      [makeAutomation()],
      makeCandidate({ statusHours: 10 }),
    );
    expect(fired).toHaveLength(0);
  });

  it('does not fire for a ticket in a different status', () => {
    const fired = evaluateScheduledAutomations(
      [makeAutomation()],
      makeCandidate({ status: TicketStatus.OPEN }),
    );
    expect(fired).toHaveLength(0);
  });

  it('does not fire a disabled automation', () => {
    const fired = evaluateScheduledAutomations(
      [makeAutomation({ enabled: false })],
      makeCandidate(),
    );
    expect(fired).toHaveLength(0);
  });

  it('does not refire an automation already recorded in firedScheduledAutomationIds', () => {
    const fired = evaluateScheduledAutomations(
      [makeAutomation()],
      makeCandidate({ firedScheduledAutomationIds: ['auto-1'] }),
    );
    expect(fired).toHaveLength(0);
  });

  it('respects conditions the same way Trigger rules do', () => {
    const automation = makeAutomation({
      conditions: [{ field: 'CustomerTier' as never, value: 'Enterprise' }],
    });
    expect(evaluateScheduledAutomations([automation], makeCandidate())).toHaveLength(0);
    expect(
      evaluateScheduledAutomations([automation], makeCandidate({ customerTier: 'Enterprise' })),
    ).toHaveLength(1);
  });
});
