import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { TaskPriority } from '../../../common/enums/task-priority.enum';
import { TaskStatus } from '../../../common/enums/task-status.enum';

export type TaskDocument = HydratedDocument<Task>;

@Schema({
  timestamps: true,
  toJSON: {
    virtuals: true,
    // Mongoose's transform typings don't carry the schema's field shape through; `any` is the
    // documented escape hatch for this callback.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transform: (_doc: unknown, ret: any) => {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class Task {
  @Prop({ required: true, trim: true, minlength: 3, maxlength: 200 })
  title!: string;

  @Prop({ default: '', maxlength: 5000 })
  description!: string;

  @Prop({ type: Types.ObjectId, ref: 'Project', required: true })
  project!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  assignee!: Types.ObjectId | null;

  @Prop({ type: String, enum: TaskPriority, default: TaskPriority.P2 })
  priority!: TaskPriority;

  @Prop({ type: String, enum: TaskStatus, default: TaskStatus.TODO })
  status!: TaskStatus;

  @Prop({ type: Date, default: null })
  dueDate!: Date | null;

  // Stamped by the hourly due-date reminder cron once a notification has gone out, so a task
  // is only ever notified once. Null until then; unrelated to `dueDate` itself changing.
  @Prop({ type: Date, default: null })
  dueDateNotifiedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Date, default: null })
  completedAt!: Date | null;

  // null means "in the backlog". Set only via TasksService.updateSprint(); untouched by ordinary
  // task create/update, so every task not deliberately put in a sprint behaves exactly as before.
  @Prop({ type: Types.ObjectId, ref: 'Sprint', default: null })
  sprint!: Types.ObjectId | null;

  // Fractional backlog/sprint ordering position - see modules/tasks/utils/rank.util.ts. Defaults
  // to 0 for every task created before this field existed; a secondary `createdAt` sort key keeps
  // those legacy same-rank tasks in a stable order (see TasksRepository.paginate).
  @Prop({ type: Number, default: 0 })
  rank!: number;

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  // Denormalized from the parent project (not the acting user) at creation time so it's
  // always in sync, and so org-scoped queries against Task don't need to join through Project.
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const TaskSchema = SchemaFactory.createForClass(Task);

TaskSchema.index({ project: 1 });
TaskSchema.index({ assignee: 1 });
TaskSchema.index({ status: 1 });
TaskSchema.index({ dueDate: 1 });
TaskSchema.index({ project: 1, status: 1 });
TaskSchema.index({ assignee: 1, status: 1 });
TaskSchema.index({ title: 'text', description: 'text' });
TaskSchema.index({ organizationId: 1 });
TaskSchema.index({ organizationId: 1, assignee: 1 });
TaskSchema.index({ sprint: 1 });
TaskSchema.index({ project: 1, sprint: 1 });
