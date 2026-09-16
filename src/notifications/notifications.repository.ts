import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Notification,
  NotificationDocument,
  NotificationType,
} from './schemas/notification.schema';
import {
  NotificationPreference,
  NotificationPreferenceDocument,
} from './schemas/notification-preference.schema';

@Injectable()
export class NotificationsRepository {
  constructor(
    @InjectModel(Notification.name) private readonly model: Model<NotificationDocument>,
    @InjectModel(NotificationPreference.name)
    private readonly preferenceModel: Model<NotificationPreferenceDocument>,
  ) {}

  create(data: Partial<Notification>): Promise<NotificationDocument> {
    return this.model.create(data);
  }

  findById(id: string): Promise<NotificationDocument | null> {
    return this.model.findById(id).exec();
  }

  async paginate(
    recipientId: string,
    page: number,
    limit: number,
    unreadOnly: boolean,
  ): Promise<{ data: NotificationDocument[]; total: number }> {
    const filter: Record<string, unknown> = { recipient: new Types.ObjectId(recipientId) };
    if (unreadOnly) filter.readAt = null;

    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { data, total };
  }

  countUnread(recipientId: string): Promise<number> {
    return this.model
      .countDocuments({ recipient: new Types.ObjectId(recipientId), readAt: null })
      .exec();
  }

  async markRead(id: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { readAt: new Date() }).exec();
  }

  async markAllRead(recipientId: string): Promise<void> {
    await this.model
      .updateMany(
        { recipient: new Types.ObjectId(recipientId), readAt: null },
        { readAt: new Date() },
      )
      .exec();
  }

  findPreference(ownerId: string): Promise<NotificationPreferenceDocument | null> {
    return this.preferenceModel.findOne({ owner: new Types.ObjectId(ownerId) }).exec();
  }

  async upsertPreference(
    ownerId: string,
    organizationId: string,
    mutedTypes: NotificationType[],
  ): Promise<NotificationPreferenceDocument> {
    return this.preferenceModel
      .findOneAndUpdate(
        { owner: new Types.ObjectId(ownerId) },
        {
          owner: new Types.ObjectId(ownerId),
          organizationId: new Types.ObjectId(organizationId),
          mutedTypes,
        },
        { upsert: true, new: true },
      )
      .exec();
  }
}
