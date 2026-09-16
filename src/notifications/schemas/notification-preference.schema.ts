import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { NotificationType } from './notification.schema';

export type NotificationPreferenceDocument = HydratedDocument<NotificationPreference>;

@Schema({ timestamps: true })
export class NotificationPreference {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  owner!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  // Types the owner has muted - empty (the default for every user who never customizes this)
  // means "receive everything", exactly today's behavior.
  @Prop({ type: [String], default: [] })
  mutedTypes!: NotificationType[];
}

export const NotificationPreferenceSchema = SchemaFactory.createForClass(NotificationPreference);
