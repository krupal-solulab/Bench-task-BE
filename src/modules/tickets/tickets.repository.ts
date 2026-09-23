import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { TicketStatusCategory } from '../../common/enums/ticket-status.enum';
import { Ticket, TicketDocument } from './schemas/ticket.schema';
import {
  TicketActivity,
  TicketActivityAction,
  TicketActivityDocument,
} from './schemas/ticket-activity.schema';
import { TicketComment, TicketCommentDocument } from './schemas/ticket-comment.schema';

const POPULATE_FIELDS = 'name email role isActive';

@Injectable()
export class TicketsRepository {
  constructor(
    @InjectModel(Ticket.name) private readonly model: Model<TicketDocument>,
    @InjectModel(TicketActivity.name)
    private readonly activityModel: Model<TicketActivityDocument>,
    @InjectModel(TicketComment.name) private readonly commentModel: Model<TicketCommentDocument>,
  ) {}

  create(data: Partial<Ticket>): Promise<TicketDocument> {
    return this.model.create(data);
  }

  findById(id: string): Promise<TicketDocument | null> {
    return this.model
      .findOne({ _id: id, deletedAt: null })
      .populate('assignee', POPULATE_FIELDS)
      .populate('customer', 'name email tier')
      .exec();
  }

  updateById(id: string, update: Partial<Ticket>): Promise<TicketDocument | null> {
    return this.model
      .findByIdAndUpdate(id, update, { new: true })
      .populate('assignee', POPULATE_FIELDS)
      .populate('customer', 'name email tier')
      .exec();
  }

  async paginate(
    filter: FilterQuery<TicketDocument>,
    page: number,
    limit: number,
  ): Promise<{ data: TicketDocument[]; total: number }> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.model
        .find({ ...filter, deletedAt: null })
        .populate('assignee', POPULATE_FIELDS)
        .populate('customer', 'name email tier')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.model.countDocuments({ ...filter, deletedAt: null }).exec(),
    ]);
    return { data, total };
  }

  async logActivity(
    ticketId: string,
    actorId: string,
    action: TicketActivityAction,
    from: string | null = null,
    to: string | null = null,
    viaAutomationRule: string | null = null,
  ): Promise<void> {
    await this.activityModel.create({
      ticket: new Types.ObjectId(ticketId),
      actor: new Types.ObjectId(actorId),
      action,
      from,
      to,
      viaAutomationRule,
    });
  }

  listActivity(ticketId: string): Promise<TicketActivityDocument[]> {
    return this.activityModel
      .find({ ticket: new Types.ObjectId(ticketId) })
      .populate('actor', POPULATE_FIELDS)
      .sort({ createdAt: -1 })
      .exec();
  }

  createComment(data: Partial<TicketComment>): Promise<TicketCommentDocument> {
    return this.commentModel.create(data);
  }

  listComments(ticketId: string): Promise<TicketCommentDocument[]> {
    return this.commentModel
      .find({ ticket: new Types.ObjectId(ticketId) })
      .populate('authorUser', POPULATE_FIELDS)
      .populate('authorCustomer', 'name email')
      .sort({ createdAt: 1 })
      .exec();
  }

  /** True if any staff-authored, isPublic comment already exists for this ticket - used to decide
   * whether a new one is the FIRST public staff reply (sets Ticket.firstRespondedAt). */
  hasPublicStaffComment(ticketId: string): Promise<boolean> {
    return this.commentModel
      .exists({ ticket: new Types.ObjectId(ticketId), authorType: 'staff', isPublic: true })
      .then((doc) => !!doc);
  }

  /** Candidate set for one org's scheduled-Automation sweep - every non-terminal, non-deleted
   * ticket in that org. */
  findOpenTicketsByOrganization(organizationId: string): Promise<TicketDocument[]> {
    return this.model
      .find({
        organizationId: new Types.ObjectId(organizationId),
        deletedAt: null,
        statusCategory: { $ne: TicketStatusCategory.TERMINAL },
      })
      .exec();
  }

  async addFiredScheduledAutomationIds(id: string, automationIds: string[]): Promise<void> {
    await this.model
      .updateOne(
        { _id: id },
        { $addToSet: { firedScheduledAutomationIds: { $each: automationIds } } },
      )
      .exec();
  }

  /** Candidate set for the SLA breach/escalation cron - every non-terminal, non-deleted ticket
   * across every org that hasn't yet been notified for at least one of the two SLA events. */
  findOpenTicketsForSlaCheck(): Promise<TicketDocument[]> {
    return this.model
      .find({
        deletedAt: null,
        statusCategory: { $ne: TicketStatusCategory.TERMINAL },
        $or: [{ slaBreachNotifiedAt: null }, { slaEscalatedAt: null }],
      })
      .exec();
  }

  async markSlaBreachNotified(id: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { slaBreachNotifiedAt: new Date() }).exec();
  }

  async markSlaEscalated(id: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { slaEscalatedAt: new Date() }).exec();
  }
}
