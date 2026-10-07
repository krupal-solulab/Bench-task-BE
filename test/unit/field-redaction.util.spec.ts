import { HIDDEN_TITLE, redactTaskFields } from 'src/modules/tasks/field-redaction.util';

describe('redactTaskFields', () => {
  const base = () => ({
    title: 'Real title',
    description: 'Real description',
    priority: 'P1',
    labels: ['a'],
    components: ['UI'],
    fixVersions: [{ id: 'r1' }],
    dueDate: new Date('2030-01-01'),
    customFieldValues: { 'cf-1': 'secret', 'cf-2': 'visible' },
  });

  it('replaces hidden built-in fields with type-safe placeholders', () => {
    const out = redactTaskFields(base(), [
      'title',
      'description',
      'priority',
      'labels',
      'fixVersions',
      'dueDate',
    ]);
    expect(out).toMatchObject({
      title: HIDDEN_TITLE,
      description: '',
      priority: null,
      labels: [],
      fixVersions: [],
      dueDate: null,
      components: ['UI'],
    });
    expect(out.redactedFields).toEqual([
      'title',
      'description',
      'priority',
      'labels',
      'fixVersions',
      'dueDate',
    ]);
  });

  it('removes hidden custom field values only', () => {
    const out = redactTaskFields(base(), ['cf-1']);
    expect(out.customFieldValues).toEqual({ 'cf-2': 'visible' });
    expect(out.redactedFields).toEqual(['cf-1']);
  });

  it('ignores ids that are not fields on the task', () => {
    const out = redactTaskFields(base(), ['not-a-field']);
    expect(out.redactedFields).toEqual([]);
    expect(out.title).toBe('Real title');
  });

  it('gives each task its own placeholder array', () => {
    const a = redactTaskFields(base(), ['labels']);
    const b = redactTaskFields(base(), ['labels']);
    (a.labels as string[]).push('x');
    expect(b.labels).toEqual([]);
  });
});
