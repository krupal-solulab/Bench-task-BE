import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type BulkOperationLogDocument = HydratedDocument<BulkOperationLog>;

@Schema({ _id: false })
export class BulkOperationChange {
  @Prop({ type: Types.ObjectId, ref: 'Task', required: true })
  taskId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  field!: string;

  @Prop({ type: Object, default: null })
  previousValue!: unknown;
}
export const BulkOperationChangeSchema = SchemaFactory.createForClass(BulkOperationChange);

/**
 * Module 5's undo window (BRD gap-closure) - one document per bulk-* call (including
 * bulk-move-project), capturing each successfully-changed task's prior value for exactly the one
 * field that call touched. `undoBulkOperation()` replays these in reverse, task by task, through
 * the SAME single-task update methods every other write path already goes through - so an undo re-
 * runs every permission/validation guard, and one task that can no longer legally revert (e.g. its
 * workflow changed since) fails independently, same partial-success shape as the original bulk call.
 * Deliberately time-boxed (`UNDO_WINDOW_MS` in tasks.service.ts) and single-use (`undoneAt`) - this
 * is a short "oops" safety net, not a general-purpose change-history/replay system.
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
export class BulkOperationLog {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  actor!: Types.ObjectId;

  @Prop({ type: String, required: true })
  action!: string;

  @Prop({ type: [BulkOperationChangeSchema], default: [] })
  changes!: BulkOperationChange[];

  @Prop({ type: Date, default: null })
  undoneAt!: Date | null;

  createdAt!: Date;
}

export const BulkOperationLogSchema = SchemaFactory.createForClass(BulkOperationLog);

BulkOperationLogSchema.index({ organizationId: 1, createdAt: 1 });
