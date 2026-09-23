import {
  TicketAutomationActionType,
  TicketAutomationConditionField,
  TicketAutomationRule,
  TicketAutomationTriggerType,
  evaluateTicketAutomationRules,
  renderTicketTemplate,
} from 'src/modules/tickets/schemas/ticket-automation-rule.schema';

function makeRule(overrides: Partial<TicketAutomationRule> = {}): TicketAutomationRule {
  return {
    id: 'rule-1',
    name: 'Test rule',
    enabled: true,
    trigger: { type: TicketAutomationTriggerType.TICKET_CREATED, toStatus: null },
    conditions: [],
    actions: [{ type: TicketAutomationActionType.ADD_TAGS, value: 'auto' }],
    ...overrides,
  };
}

const URGENT_TICKET = {
  priority: 'Urgent',
  channel: 'manual',
  customerTier: 'Enterprise',
  tags: ['vip'],
};
const LOW_TICKET = { priority: 'Low', channel: 'manual', customerTier: 'Standard', tags: [] };

describe('evaluateTicketAutomationRules', () => {
  it('fires a matching enabled rule with no conditions (always matches)', () => {
    const fired = evaluateTicketAutomationRules(
      [makeRule()],
      { type: TicketAutomationTriggerType.TICKET_CREATED },
      URGENT_TICKET,
    );
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ ruleId: 'rule-1', ruleName: 'Test rule' });
  });

  it('does not fire a disabled rule', () => {
    const fired = evaluateTicketAutomationRules(
      [makeRule({ enabled: false })],
      { type: TicketAutomationTriggerType.TICKET_CREATED },
      URGENT_TICKET,
    );
    expect(fired).toHaveLength(0);
  });

  it('does not fire a rule whose trigger type does not match', () => {
    const fired = evaluateTicketAutomationRules(
      [
        makeRule({
          trigger: { type: TicketAutomationTriggerType.COMMENT_ADDED, toStatus: null },
        }),
      ],
      { type: TicketAutomationTriggerType.TICKET_CREATED },
      URGENT_TICKET,
    );
    expect(fired).toHaveLength(0);
  });

  describe('TicketStatusChanged trigger', () => {
    const rule = makeRule({
      trigger: { type: TicketAutomationTriggerType.STATUS_CHANGED, toStatus: 'Solved' },
    });

    it('fires when the trigger toStatus matches the rule', () => {
      const fired = evaluateTicketAutomationRules(
        [rule],
        { type: TicketAutomationTriggerType.STATUS_CHANGED, toStatus: 'Solved' },
        URGENT_TICKET,
      );
      expect(fired).toHaveLength(1);
    });

    it('does not fire when the trigger toStatus differs', () => {
      const fired = evaluateTicketAutomationRules(
        [rule],
        { type: TicketAutomationTriggerType.STATUS_CHANGED, toStatus: 'Pending' },
        URGENT_TICKET,
      );
      expect(fired).toHaveLength(0);
    });

    it('further scopes to a specific fromStatus -> toStatus edge when fromStatus is set', () => {
      const scopedRule = makeRule({
        trigger: {
          type: TicketAutomationTriggerType.STATUS_CHANGED,
          toStatus: 'Solved',
          fromStatus: 'Open',
        },
      });

      const matching = evaluateTicketAutomationRules(
        [scopedRule],
        {
          type: TicketAutomationTriggerType.STATUS_CHANGED,
          toStatus: 'Solved',
          fromStatus: 'Open',
        },
        URGENT_TICKET,
      );
      expect(matching).toHaveLength(1);

      const nonMatching = evaluateTicketAutomationRules(
        [scopedRule],
        {
          type: TicketAutomationTriggerType.STATUS_CHANGED,
          toStatus: 'Solved',
          fromStatus: 'Pending',
        },
        URGENT_TICKET,
      );
      expect(nonMatching).toHaveLength(0);
    });
  });

  describe('conditions', () => {
    it('matches Priority/Channel/CustomerTier/Tag conditions (AND-combined)', () => {
      const rule = makeRule({
        conditions: [
          { field: TicketAutomationConditionField.PRIORITY, value: 'Urgent' },
          { field: TicketAutomationConditionField.CUSTOMER_TIER, value: 'Enterprise' },
          { field: TicketAutomationConditionField.TAG, value: 'vip' },
        ],
      });

      expect(
        evaluateTicketAutomationRules(
          [rule],
          { type: TicketAutomationTriggerType.TICKET_CREATED },
          URGENT_TICKET,
        ),
      ).toHaveLength(1);

      expect(
        evaluateTicketAutomationRules(
          [rule],
          { type: TicketAutomationTriggerType.TICKET_CREATED },
          LOW_TICKET,
        ),
      ).toHaveLength(0);
    });
  });

  it('flattens multiple actions from one rule in array order', () => {
    const rule = makeRule({
      actions: [
        { type: TicketAutomationActionType.SET_PRIORITY, value: 'High' },
        { type: TicketAutomationActionType.ADD_TAGS, value: 'escalated' },
      ],
    });
    const fired = evaluateTicketAutomationRules(
      [rule],
      { type: TicketAutomationTriggerType.TICKET_CREATED },
      URGENT_TICKET,
    );
    expect(fired.map((f) => f.action.type)).toEqual([
      TicketAutomationActionType.SET_PRIORITY,
      TicketAutomationActionType.ADD_TAGS,
    ]);
  });
});

describe('renderTicketTemplate', () => {
  it('substitutes subject/ticketKey/status placeholders', () => {
    const rendered = renderTicketTemplate('Ticket {{ticketKey}} ({{subject}}) is now {{status}}', {
      subject: 'Cannot log in',
      ticketKey: 'SUP-42',
      status: 'Solved',
    });
    expect(rendered).toBe('Ticket SUP-42 (Cannot log in) is now Solved');
  });

  it('leaves unrecognized placeholders untouched', () => {
    const rendered = renderTicketTemplate('{{unknown}}', {
      subject: 'x',
      ticketKey: 'SUP-1',
      status: 'Open',
    });
    expect(rendered).toBe('{{unknown}}');
  });
});
