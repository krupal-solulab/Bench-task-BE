import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { CustomFieldType } from '../../projects/schemas/custom-field.schema';

export type CustomFieldLibraryEntryDocument = HydratedDocument<CustomFieldLibraryEntry>;

/**
 * Module 8 gap-closure: cross-project field configuration - an org-wide custom field definition
 * that any project can adopt. Adopting copies the definition into `Project.customFields` with
 * `id` = this entry's `_id`, so the SAME field id is shared across every adopting project:
 * stored values (`Task.customFieldValues.<id>`), Issue Navigator filters and field-permission
 * rules then mean the same thing org-wide. Renames/option edits here are pushed to every
 * adopting project (see CustomFieldLibraryService.update); the type can never change, same rule
 * as a project-local field.
 */
@Schema({
  timestamps: true,
  toJSON: {
    virtuals: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transform: (_doc: unknown, ret: any) => {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class CustomFieldLibraryEntry {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 60 })
  name!: string;

  @Prop({ type: String, enum: CustomFieldType, required: true })
  type!: CustomFieldType;

  // Only meaningful (and only ever set) for Dropdown / MultiSelect - same as CustomFieldDefinition.
  @Prop({ type: [String], default: null })
  options!: string[] | null;

  @Prop({ default: '', maxlength: 500 })
  description!: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const CustomFieldLibraryEntrySchema = SchemaFactory.createForClass(CustomFieldLibraryEntry);
CustomFieldLibraryEntrySchema.index(
  { organizationId: 1, name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
);
