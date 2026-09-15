import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DashboardPreferenceDocument = HydratedDocument<DashboardPreference>;

/** The dashboard's customizable widgets - the top stat-card row is always shown and isn't part
 * of this set. Order here doubles as the default order shown to anyone with no saved preference. */
export const DASHBOARD_WIDGET_IDS = [
  'projectsByStatus',
  'tasksStatus',
  'tasksByPriority',
  'taskTrend',
  'developerWorkload',
  'overdueList',
] as const;
export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];

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
export class DashboardPreference {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  owner!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  // Widgets the owner has hidden. Empty (the default for every user who never customizes this)
  // means "show every widget the viewer's role permits", exactly today's behavior.
  @Prop({ type: [String], default: [] })
  hiddenWidgets!: string[];

  // Empty means "use DASHBOARD_WIDGET_IDS's default order".
  @Prop({ type: [String], default: [] })
  widgetOrder!: string[];

  createdAt!: Date;
  updatedAt!: Date;
}

export const DashboardPreferenceSchema = SchemaFactory.createForClass(DashboardPreference);
