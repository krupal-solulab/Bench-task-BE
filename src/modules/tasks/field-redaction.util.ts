/**
 * Field-Level Permissions - VIEW side. What a field the viewer's role may not see is replaced
 * with, keeping each field's normal type (an array stays an array, the always-present title stays
 * a string) so every screen that reads tasks keeps working - a hidden Labels field used to come
 * back as `null`, which the issue page's `labels.length` crashed on. Custom field values are
 * removed outright, as before. Pure, so it's unit-tested directly.
 */
export const HIDDEN_TITLE = '(hidden)';

const BUILT_IN_PLACEHOLDERS: Record<string, () => unknown> = {
  title: () => HIDDEN_TITLE,
  description: () => '',
  priority: () => null,
  dueDate: () => null,
  labels: () => [],
  components: () => [],
  fixVersions: () => [],
  affectsVersions: () => [],
  storyPoints: () => null,
  originalEstimateHours: () => null,
  securityLevel: () => null,
};

/** Mutates and returns `plain` (a task's toJSON()), adding `redactedFields` - the ids hidden. */
export function redactTaskFields<T extends Record<string, unknown>>(
  plain: T,
  hiddenFieldIds: Iterable<string>,
): T & { redactedFields: string[] } {
  const record = plain as Record<string, unknown>;
  const redacted: string[] = [];
  for (const fieldId of hiddenFieldIds) {
    const placeholder = BUILT_IN_PLACEHOLDERS[fieldId];
    if (placeholder) {
      record[fieldId] = placeholder();
      redacted.push(fieldId);
      continue;
    }
    const custom = record.customFieldValues;
    if (custom && typeof custom === 'object' && fieldId in custom) {
      delete (custom as Record<string, unknown>)[fieldId];
      redacted.push(fieldId);
    }
  }
  record.redactedFields = redacted;
  return plain as T & { redactedFields: string[] };
}
