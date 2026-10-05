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
import {
  NotificationSnooze,
  NotificationSnoozeDocument,
} from './schemas/notification-snooze.schema';

@Injectable()
export class NotificationsRepository {
  constructor(
    @InjectModel(Notification.name) private readonly model: Model<NotificationDocument>,
    @InjectModel(NotificationPreference.name)
    private readonly preferenceModel: Model<NotificationPreferenceDocument>,
    @InjectModel(NotificationSnooze.name)
    private readonly snoozeModel: Model<NotificationSnoozeDocument>,
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
    type?: NotificationType,
    snoozedTaskIds: Types.ObjectId[] = [],
  ): Promise<{ data: NotificationDocument[]; total: number }> {
    const filter: Record<string, unknown> = { recipient: new Types.ObjectId(recipientId) };
    if (unreadOnly) filter.readAt = null;
    if (type) filter.type = type;
    // $nin also keeps notifications with no taskId (project-level ones) - never snoozable.
    if (snoozedTaskIds.length > 0) filter.taskId = { $nin: snoozedTaskIds };

    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { data, total };
  }

  countUnread(recipientId: string, snoozedTaskIds: Types.ObjectId[] = []): Promise<number> {
    return this.model
      .countDocuments({
        recipient: new Types.ObjectId(recipientId),
        readAt: null,
        ...(snoozedTaskIds.length > 0 ? { taskId: { $nin: snoozedTaskIds } } : {}),
      })
      .exec();
  }

  /** Module 11 gap-closure: the owner's snoozes that haven't ended yet. */
  findActiveSnoozes(ownerId: string, now: Date): Promise<NotificationSnoozeDocument[]> {
    return this.snoozeModel
      .find({ owner: new Types.ObjectId(ownerId), until: { $gt: now } })
      .sort({ until: 1 })
      .exec();
  }

  upsertSnooze(ownerId: string, taskId: string, until: Date): Promise<NotificationSnoozeDocument> {
    return this.snoozeModel
      .findOneAndUpdate(
        { owner: new Types.ObjectId(ownerId), task: new Types.ObjectId(taskId) },
        { until },
        { new: true, upsert: true },
      )
      .exec() as Promise<NotificationSnoozeDocument>;
  }

  async deleteSnooze(ownerId: string, taskId: string): Promise<void> {
    await this.snoozeModel
      .deleteOne({ owner: new Types.ObjectId(ownerId), task: new Types.ObjectId(taskId) })
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
    digest?: 'off' | 'daily' | 'weekly',
  ): Promise<NotificationPreferenceDocument> {
    const existing = digest !== undefined ? await this.findPreference(ownerId) : null;
    return this.preferenceModel
      .findOneAndUpdate(
        { owner: new Types.ObjectId(ownerId) },
        {
          owner: new Types.ObjectId(ownerId),
          organizationId: new Types.ObjectId(organizationId),
          mutedTypes,
          // Module 11: turning a digest on (or changing its period) starts its clock now, so the
          // first one arrives a full period later rather than immediately.
          ...(digest !== undefined
            ? {
                digest,
                ...(digest !== (existing?.digest ?? 'off') ? { lastDigestAt: new Date() } : {}),
              }
            : {}),
        },
        { upsert: true, new: true },
      )
      .exec();
  }

  /** Module 11 gap-closure: unread notifications created since `since`, newest first. */
  findUnreadSince(
    recipientId: string,
    since: Date,
    snoozedTaskIds: Types.ObjectId[],
    limit: number,
  ): Promise<NotificationDocument[]> {
    return this.model
      .find({
        recipient: new Types.ObjectId(recipientId),
        readAt: null,
        createdAt: { $gte: since },
        ...(snoozedTaskIds.length > 0 ? { taskId: { $nin: snoozedTaskIds } } : {}),
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  /** Module 11 gap-closure: preferences whose digest period has elapsed. */
  findDigestsDue(
    now: Date,
    periods: { daily: number; weekly: number },
  ): Promise<NotificationPreferenceDocument[]> {
    return this.preferenceModel
      .find({
        $or: (['daily', 'weekly'] as const).map((digest) => ({
          digest,
          $or: [
            { lastDigestAt: null },
            { lastDigestAt: { $lte: new Date(now.getTime() - periods[digest]) } },
          ],
        })),
      })
      .exec();
  }

  async markDigestSent(ownerId: string, at: Date): Promise<void> {
    await this.preferenceModel
      .updateOne({ owner: new Types.ObjectId(ownerId) }, { lastDigestAt: at })
      .exec();
  }
}
