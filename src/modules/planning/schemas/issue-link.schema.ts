import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type IssueLinkDocument = HydratedDocument<IssueLink>;

/**
 * Module 1's issue-to-issue links ("blocks"/"relates to"/"duplicates"/...). Deliberately separate
 * from Task.parent (the Epic-link/Sub-task-parent hierarchy field) - links are a peer-to-peer,
 * many-to-many relationship with a typed, directional meaning, not a tree structure. `sourceTask`
 * "has" the link in the forward direction (its LinkTypeDefinition.name applies); `targetTask` sees
 * it in reverse (LinkTypeDefinition.inverseName applies) - resolved at read time by
 * IssueLinksService, never stored twice.
 */
@Schema({
  timestamps: { createdAt: true, updatedAt: false },
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
export class IssueLink {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Task', required: true })
  sourceTask!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Task', required: true })
  targetTask!: Types.ObjectId;

  // References LinkTypeDefinition.id from the org's (possibly custom) catalog - not embedded, so
  // renaming a link type never orphans existing links (same "store the id, not the name" reasoning
  // as Task.customFieldValues keying off CustomFieldDefinition.id).
  @Prop({ required: true })
  linkTypeId!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  createdAt!: Date;
}

export const IssueLinkSchema = SchemaFactory.createForClass(IssueLink);

IssueLinkSchema.index({ sourceTask: 1 });
IssueLinkSchema.index({ targetTask: 1 });
IssueLinkSchema.index({ organizationId: 1 });
// A given pair of tasks can only have one link of a given type in a given direction - prevents
// accidentally creating the exact same "A blocks B" link twice. Does not prevent "A blocks B" AND
// "B blocks A" both existing (that's exactly what circular-dependency detection guards against
// instead, since it's a meaningful state to reject with a specific error, not a silent unique-index
// collision).
IssueLinkSchema.index({ sourceTask: 1, targetTask: 1, linkTypeId: 1 }, { unique: true });
