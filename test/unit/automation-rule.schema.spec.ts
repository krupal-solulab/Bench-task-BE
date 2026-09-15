import {
  AutomationActionType,
  AutomationConditionField,
  AutomationRule,
  AutomationTriggerType,
  evaluateAutomationRules,
  renderTemplate,
} from 'src/modules/projects/schemas/automation-rule.schema';

function makeRule(overrides: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: 'rule-1',
    name: 'Test rule',
    enabled: true,
    trigger: { type: AutomationTriggerType.ISSUE_CREATED, toStatus: null },
    conditions: [],
    actions: [{ type: AutomationActionType.ADD_LABELS, value: 'auto' }],
    ...overrides,
  };
}

const BUG_TASK = { issueType: 'Bug', priority: 'P1', components: ['Frontend'] };
const STORY_TASK = { issueType: 'Story', priority: 'P3', components: [] };

describe('evaluateAutomationRules', () => {
  it('fires a matching enabled rule with no conditions (always matches)', () => {
    const fired = evaluateAutomationRules(
      [makeRule()],
      { type: AutomationTriggerType.ISSUE_CREATED },
      BUG_TASK,
    );
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ ruleId: 'rule-1', ruleName: 'Test rule' });
  });

  it('does not fire a disabled rule', () => {
    const fired = evaluateAutomationRules(
      [makeRule({ enabled: false })],
      { type: AutomationTriggerType.ISSUE_CREATED },
      BUG_TASK,
    );
    expect(fired).toHaveLength(0);
  });

  it('does not fire a rule whose trigger type does not match', () => {
    const fired = evaluateAutomationRules(
      [makeRule({ trigger: { type: AutomationTriggerType.STATUS_CHANGED, toStatus: 'Done' } })],
      { type: AutomationTriggerType.ISSUE_CREATED },
      BUG_TASK,
    );
    expect(fired).toHaveLength(0);
  });

  describe('StatusChanged trigger', () => {
    const rule = makeRule({
      trigger: { type: AutomationTriggerType.STATUS_CHANGED, toStatus: 'Done' },
    });

    it('fires when the trigger toStatus matches the rule', () => {
      const fired = evaluateAutomationRules(
        [rule],
        { type: AutomationTriggerType.STATUS_CHANGED, toStatus: 'Done' },
        BUG_TASK,
      );
      expect(fired).toHaveLength(1);
    });

    it('does not fire when the trigger toStatus differs', () => {
      const fired = evaluateAutomationRules(
        [rule],
        { type: AutomationTriggerType.STATUS_CHANGED, toStatus: 'In Progress' },
        BUG_TASK,
      );
      expect(fired).toHaveLength(0);
    });
  });

  describe('conditions (AND-combined)', () => {
    it('fires when every condition matches', () => {
      const rule = makeRule({
        conditions: [
          { field: AutomationConditionField.ISSUE_TYPE, value: 'Bug' },
          { field: AutomationConditionField.PRIORITY, value: 'P1' },
          { field: AutomationConditionField.COMPONENT, value: 'Frontend' },
        ],
      });
      const fired = evaluateAutomationRules(
        [rule],
        { type: AutomationTriggerType.ISSUE_CREATED },
        BUG_TASK,
      );
      expect(fired).toHaveLength(1);
    });

    it('does not fire when one condition fails to match', () => {
      const rule = makeRule({
        conditions: [
          { field: AutomationConditionField.ISSUE_TYPE, value: 'Bug' },
          { field: AutomationConditionField.PRIORITY, value: 'P3' }, // BUG_TASK is P1
        ],
      });
      const fired = evaluateAutomationRules(
        [rule],
        { type: AutomationTriggerType.ISSUE_CREATED },
        BUG_TASK,
      );
      expect(fired).toHaveLength(0);
    });

    it('COMPONENT condition matches when the task has that component among several', () => {
      const rule = makeRule({
        conditions: [{ field: AutomationConditionField.COMPONENT, value: 'Frontend' }],
      });
      const fired = evaluateAutomationRules(
        [rule],
        { type: AutomationTriggerType.ISSUE_CREATED },
        { ...BUG_TASK, components: ['API', 'Frontend'] },
      );
      expect(fired).toHaveLength(1);
    });

    it('ISSUE_TYPE condition does not match a different issue type', () => {
      const rule = makeRule({
        conditions: [{ field: AutomationConditionField.ISSUE_TYPE, value: 'Bug' }],
      });
      const fired = evaluateAutomationRules(
        [rule],
        { type: AutomationTriggerType.ISSUE_CREATED },
        STORY_TASK,
      );
      expect(fired).toHaveLength(0);
    });
  });

  it('fires multiple matching rules and flattens their actions in rule order', () => {
    const ruleA = makeRule({
      id: 'a',
      name: 'A',
      actions: [{ type: AutomationActionType.ADD_LABELS, value: 'a-label' }],
    });
    const ruleB = makeRule({
      id: 'b',
      name: 'B',
      actions: [
        { type: AutomationActionType.ADD_LABELS, value: 'b-label-1' },
        { type: AutomationActionType.SET_PRIORITY, value: 'P1' },
      ],
    });
    const fired = evaluateAutomationRules(
      [ruleA, ruleB],
      { type: AutomationTriggerType.ISSUE_CREATED },
      BUG_TASK,
    );
    expect(fired.map((f) => `${f.ruleId}:${f.action.value}`)).toEqual([
      'a:a-label',
      'b:b-label-1',
      'b:P1',
    ]);
  });

  it('returns an empty array when there are no rules', () => {
    expect(
      evaluateAutomationRules([], { type: AutomationTriggerType.ISSUE_CREATED }, BUG_TASK),
    ).toEqual([]);
  });
});

describe('renderTemplate', () => {
  const task = { title: 'Fix login', issueKey: 'PRJ-42', status: 'Done' };

  it('substitutes {{title}}, {{issueKey}}, and {{status}}', () => {
    expect(renderTemplate('{{title}} ({{issueKey}}) is now {{status}}', task)).toBe(
      'Fix login (PRJ-42) is now Done',
    );
  });

  it('substitutes a null issueKey as an empty string', () => {
    expect(renderTemplate('Key: {{issueKey}}', { ...task, issueKey: null })).toBe('Key: ');
  });

  it('leaves text with no placeholders unchanged', () => {
    expect(renderTemplate('Welcome!', task)).toBe('Welcome!');
  });
});
