import { JQL_FIELDS, type JqlField, type JqlOperator } from './jql.util';

export type JqlValueType = 'text' | 'objectId' | 'date' | 'number' | 'enum';

/** Fields whose values `GET tasks/search/autocomplete-values` can resolve dynamically - a
 * curated subset, not every JQL_FIELD: `assignee`/`createdBy`/`project`/`sprint` already have an
 * existing frontend data source (the assignable-users list, the accessible-projects list) that
 * the Issue Navigator's autocomplete reuses directly instead of duplicating server-side. */
export const JQL_DYNAMIC_VALUE_FIELDS = ['issueType', 'status', 'labels', 'components'] as const;
export type JqlDynamicValueField = (typeof JQL_DYNAMIC_VALUE_FIELDS)[number];

export interface JqlFieldMetadata {
  field: JqlField;
  label: string;
  operators: JqlOperator[];
  valueType: JqlValueType;
  hasDynamicValues: boolean;
}

const SCALAR_OPS: JqlOperator[] = ['=', '!=', 'in', 'not in'];
const DATE_OPS: JqlOperator[] = ['=', '!=', '>', '>=', '<', '<='];
const NUMBER_OPS: JqlOperator[] = ['=', '!=', '>', '>=', '<', '<=', 'in', 'not in'];
const TEXT_OPS: JqlOperator[] = ['~'];

function isDynamic(field: JqlField): boolean {
  return (JQL_DYNAMIC_VALUE_FIELDS as readonly string[]).includes(field);
}

const FIELD_LABELS: Record<JqlField, string> = {
  project: 'Project',
  status: 'Status',
  statusCategory: 'Status category',
  priority: 'Priority',
  assignee: 'Assignee',
  issueType: 'Issue type',
  labels: 'Labels',
  components: 'Components',
  createdBy: 'Reporter',
  dueDate: 'Due date',
  text: 'Text',
  sprint: 'Sprint',
  storyPoints: 'Story points',
  parent: 'Parent/Epic',
  fixVersions: 'Fix version',
  affectsVersions: 'Affects version',
  issueKey: 'Issue key',
};

const FIELD_VALUE_TYPES: Record<JqlField, JqlValueType> = {
  project: 'objectId',
  status: 'text',
  statusCategory: 'enum',
  priority: 'enum',
  assignee: 'objectId',
  issueType: 'text',
  labels: 'text',
  components: 'text',
  createdBy: 'objectId',
  dueDate: 'date',
  text: 'text',
  sprint: 'objectId',
  storyPoints: 'number',
  parent: 'objectId',
  fixVersions: 'objectId',
  affectsVersions: 'objectId',
  issueKey: 'text',
};

/** Static field/operator/keyword metadata for the Issue Navigator's JQL autocomplete - entirely
 * computable from this module's own constants, so it needs no DB access and no auth beyond being
 * signed in (see JqlAutocompleteController... actually TasksController, which already owns
 * `/tasks/search`). */
export const JQL_FIELD_METADATA: JqlFieldMetadata[] = JQL_FIELDS.map((field) => {
  const valueType = FIELD_VALUE_TYPES[field];
  const operators =
    valueType === 'date' ? DATE_OPS : valueType === 'number' ? NUMBER_OPS : SCALAR_OPS;
  return {
    field,
    label: FIELD_LABELS[field],
    operators: field === 'text' ? TEXT_OPS : operators,
    valueType,
    hasDynamicValues: isDynamic(field),
  };
});

export const JQL_KEYWORDS = [
  'AND',
  'OR',
  'NOT',
  'IN',
  'ORDER BY',
  'ASC',
  'DESC',
  'currentUser()',
] as const;

export const PRIORITY_ENUM_VALUES = ['P1', 'P2', 'P3'];
export const STATUS_CATEGORY_ENUM_VALUES = ['To Do', 'In Progress', 'Done'];
