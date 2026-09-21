import { BadRequestException } from '@nestjs/common';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export enum CustomFieldType {
  TEXT = 'Text',
  NUMBER = 'Number',
  DATE = 'Date',
  DROPDOWN = 'Dropdown',
  CHECKBOX = 'Checkbox',
  MULTI_SELECT = 'MultiSelect',
  USER_PICKER = 'UserPicker',
}

@Schema({ _id: false })
export class CustomFieldDefinition {
  // Stable identity, assigned once and never reused - this is the key stored values are keyed
  // by, so renaming a field (changing `name`) never orphans data already stored under its `id`.
  @Prop({ required: true })
  id!: string;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 60 })
  name!: string;

  @Prop({ type: String, enum: CustomFieldType, required: true })
  type!: CustomFieldType;

  @Prop({ default: false })
  required!: boolean;

  // Only meaningful (and only ever set) for type === Dropdown or MultiSelect.
  @Prop({ type: [String], default: null })
  options!: string[] | null;
}

export const CustomFieldDefinitionSchema = SchemaFactory.createForClass(CustomFieldDefinition);

// A per-issue-type override of which fields are hidden, or forced required/optional - the BRD's
// "field configuration schemes: which fields are required/hidden per project or per issue type."
// `issueType` is the type's name (e.g. "Bug", or a custom Standard-level name an Admin added -
// see issue-type.schema.ts), the same string space WorkflowByType.issueType already keys against.
@Schema({ _id: false })
export class CustomFieldOverrideByType {
  @Prop({ required: true, trim: true, maxlength: 40 })
  issueType!: string;

  // Fields dropped entirely for this issue type - not shown, not validated, not required.
  @Prop({ type: [String], default: [] })
  hiddenFieldIds!: string[];

  // Fields forced required=true for this issue type, regardless of the project-wide flag.
  @Prop({ type: [String], default: [] })
  requiredFieldIds!: string[];

  // Fields forced required=false for this issue type, regardless of the project-wide flag - lets
  // a globally-required field be relaxed for one issue type.
  @Prop({ type: [String], default: [] })
  optionalFieldIds!: string[];
}

export const CustomFieldOverrideByTypeSchema =
  SchemaFactory.createForClass(CustomFieldOverrideByType);

export interface CustomFieldsCarrier {
  customFields: CustomFieldDefinition[];
  customFieldOverridesByType?: CustomFieldOverrideByType[];
}

/**
 * A project's effective custom fields - optionally scoped to a specific issue type. Omitting
 * `issueType` (every call site that existed before this feature) returns `customFields` untouched,
 * byte-identical to before per-issue-type overrides existed. With `issueType`, hidden fields are
 * dropped and required/optional overrides are applied (hidden takes precedence: a field id that is
 * both hidden and in `requiredFieldIds`/`optionalFieldIds` is simply dropped).
 */
export function resolveCustomFields(
  project: CustomFieldsCarrier,
  issueType?: string,
): CustomFieldDefinition[] {
  if (!issueType) return project.customFields;

  const override = project.customFieldOverridesByType?.find((o) => o.issueType === issueType);
  if (!override) return project.customFields;

  const hidden = new Set(override.hiddenFieldIds);
  const requiredIds = new Set(override.requiredFieldIds);
  const optionalIds = new Set(override.optionalFieldIds);

  // Built as a plain object field-by-field, rather than `{ ...f, required: ... }` - `f` may be a
  // hydrated Mongoose subdocument, whose schema fields aren't own-enumerable properties, so a
  // naive spread silently drops them (they'd serialize as `{}` over HTTP).
  return project.customFields
    .filter((f) => !hidden.has(f.id))
    .map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      options: f.options,
      required: requiredIds.has(f.id) ? true : optionalIds.has(f.id) ? false : f.required,
    }));
}

/**
 * Structural validity for one issue type's override: every referenced field id must exist on the
 * project, and a field may not be forced both required and optional at once.
 */
export function assertValidCustomFieldOverride(
  fields: CustomFieldDefinition[],
  override: Pick<
    CustomFieldOverrideByType,
    'hiddenFieldIds' | 'requiredFieldIds' | 'optionalFieldIds'
  >,
): void {
  const validIds = new Set(fields.map((f) => f.id));
  const allIds = [
    ...override.hiddenFieldIds,
    ...override.requiredFieldIds,
    ...override.optionalFieldIds,
  ];
  const unknown = allIds.filter((id) => !validIds.has(id));
  if (unknown.length > 0) {
    throw new BadRequestException(
      `Custom field override references unknown field id(s): ${[...new Set(unknown)].join(', ')}`,
    );
  }

  const conflicting = override.requiredFieldIds.filter((id) =>
    override.optionalFieldIds.includes(id),
  );
  if (conflicting.length > 0) {
    throw new BadRequestException(
      `A field cannot be both forced-required and forced-optional for the same issue type: ${conflicting.join(', ')}`,
    );
  }
}

/**
 * Validates a task's custom-field values against its project's field definitions.
 *
 * `mode: 'create'` enforces every `required` field is present; `mode: 'update'` only validates
 * the keys actually provided (consistent with UpdateTaskDto's partial-patch semantics elsewhere -
 * omitting a field on update must not force it to be re-supplied).
 *
 * Pure and side-effect-free so it's exhaustively unit-testable without a database. This does NOT
 * validate that a User-picker value is an actual project member - that requires the project's
 * member list, which callers (e.g. TasksService) check separately, the same way
 * assertAssigneeEligible sits beside (not inside) this function for the `assignee` field.
 */
export function validateCustomFieldValues(
  definitions: CustomFieldDefinition[],
  values: Record<string, unknown>,
  mode: 'create' | 'update',
): void {
  const byId = new Map(definitions.map((d) => [d.id, d]));

  for (const key of Object.keys(values)) {
    const def = byId.get(key);
    if (!def) {
      throw new BadRequestException(`"${key}" is not a custom field on this project`);
    }
    assertValueMatchesType(def, values[key]);
  }

  if (mode === 'create') {
    for (const def of definitions) {
      if (def.required && isEmpty(values[def.id])) {
        throw new BadRequestException(`"${def.name}" is a required custom field`);
      }
    }
  }
}

/** Exported for reuse by other required-field-style validators (e.g. a workflow transition's
 * `requiredCustomFieldIds`) that need the exact same "is this value effectively unset" check. */
export function isEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return value === undefined || value === null || value === '';
}

function assertValueMatchesType(def: CustomFieldDefinition, value: unknown): void {
  if (isEmpty(value)) return; // an optional/cleared field - nothing further to check

  switch (def.type) {
    case CustomFieldType.TEXT:
      if (typeof value !== 'string') {
        throw new BadRequestException(`"${def.name}" must be text`);
      }
      break;
    case CustomFieldType.NUMBER:
      if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new BadRequestException(`"${def.name}" must be a number`);
      }
      break;
    case CustomFieldType.DATE:
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
        throw new BadRequestException(`"${def.name}" must be a valid date`);
      }
      break;
    case CustomFieldType.DROPDOWN:
      if (typeof value !== 'string' || !(def.options ?? []).includes(value)) {
        throw new BadRequestException(
          `"${def.name}" must be one of: ${(def.options ?? []).join(', ')}`,
        );
      }
      break;
    case CustomFieldType.CHECKBOX:
      if (typeof value !== 'boolean') {
        throw new BadRequestException(`"${def.name}" must be true or false`);
      }
      break;
    case CustomFieldType.MULTI_SELECT: {
      const options = def.options ?? [];
      if (
        !Array.isArray(value) ||
        !value.every((v) => typeof v === 'string' && options.includes(v))
      ) {
        throw new BadRequestException(`"${def.name}" must be a list of: ${options.join(', ')}`);
      }
      break;
    }
    case CustomFieldType.USER_PICKER:
      if (typeof value !== 'string') {
        throw new BadRequestException(`"${def.name}" must be a user id`);
      }
      break;
  }
}
