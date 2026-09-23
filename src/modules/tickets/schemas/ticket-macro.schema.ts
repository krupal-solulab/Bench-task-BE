import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  TicketAutomationAction,
  TicketAutomationActionSchema,
} from './ticket-automation-rule.schema';

export enum TicketMacroVisibility {
  TEAM = 'team',
  PERSONAL = 'personal',
}

/**
 * BRD 3.3's "Macros" - a named, stored bundle of actions an agent applies on-demand to one ticket
 * (POST tickets/:id/apply-macro/:macroId), reusing the same TicketAutomationAction shape and the
 * same applyTicketAutomationAction executor Triggers use - no separate action-dispatch logic.
 */
@Schema({ _id: false })
export class TicketMacro {
  @Prop({ required: true })
  id!: string;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 60 })
  name!: string;

  @Prop({ type: [TicketAutomationActionSchema], required: true })
  actions!: TicketAutomationAction[];

  @Prop({ type: String, enum: TicketMacroVisibility, default: TicketMacroVisibility.TEAM })
  visibility!: TicketMacroVisibility;

  // 'team' macros are usable/listable by any staff member in the org; 'personal' ones are scoped
  // to their own createdBy user - enforced by TicketAutomationService, not here.
  @Prop({ type: String, required: true })
  createdBy!: string;
}

export const TicketMacroSchema = SchemaFactory.createForClass(TicketMacro);
