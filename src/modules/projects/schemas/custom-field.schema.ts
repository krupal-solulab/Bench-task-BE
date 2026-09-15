import { BadRequestException } from '@nestjs/common';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export enum CustomFieldType {
  TEXT = 'Text',
  NUMBER = 'Number',
  DATE = 'Date',
  DROPDOWN = 'Dropdown',
  CHECKBOX = 'Checkbox',
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

  // Only meaningful (and only ever set) for type === Dropdown.
  @Prop({ type: [String], default: null })
  options!: string[] | null;
}

export const CustomFieldDefinitionSchema = SchemaFactory.createForClass(CustomFieldDefinition);

/**
 * Validates a task's custom-field values against its project's field definitions.
 *
 * `mode: 'create'` enforces every `required` field is present; `mode: 'update'` only validates
 * the keys actually provided (consistent with UpdateTaskDto's partial-patch semantics elsewhere -
 * omitting a field on update must not force it to be re-supplied).
 *
 * Pure and side-effect-free so it's exhaustively unit-testable without a database.
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

function isEmpty(value: unknown): boolean {
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
  }
}
