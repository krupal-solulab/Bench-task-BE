import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { CustomerTier } from '../../../common/enums/customer-tier.enum';
import { TicketPriority } from '../../../common/enums/ticket-priority.enum';
import { TicketChannel } from './ticket.schema';

/**
 * BRD 3.4's Advanced SLA policy - generalizes the Task-side priority-only SlaPolicyEntry to key
 * on priority x customerTier x channel. `customerTier`/`channel` are optional "wildcards": an
 * entry that omits one applies to every value of it, so an org can start with priority-only
 * targets (like the Task-side default) and add more specific overrides later without having to
 * enumerate every combination up front. `escalationChain` is an ordered list of backup-agent/
 * team-lead User id strings notified in order once a ticket is about to breach.
 */
@Schema({ _id: false })
export class TicketSlaPolicyEntry {
  @Prop({ type: String, enum: TicketPriority, required: true })
  priority!: TicketPriority;

  @Prop({ type: String, enum: CustomerTier, default: null })
  customerTier!: CustomerTier | null;

  @Prop({ type: String, enum: TicketChannel, default: null })
  channel!: TicketChannel | null;

  @Prop({ type: Number, required: true, min: 1, max: 24 * 365 })
  firstResponseHours!: number;

  @Prop({ type: Number, required: true, min: 1, max: 24 * 365 })
  resolutionHours!: number;

  @Prop({ type: [String], default: [] })
  escalationChain!: string[];
}

export const TicketSlaPolicyEntrySchema = SchemaFactory.createForClass(TicketSlaPolicyEntry);

/** System default SLA targets - priority-only (wildcard tier/channel), used for every org whose
 * `ticketSlaPolicy` is empty, mirroring DEFAULT_SLA_POLICY's own "hardcoded default + optional
 * per-org override" shape so nothing changes for an org that never configures one. */
export const DEFAULT_TICKET_SLA_POLICY: TicketSlaPolicyEntry[] = [
  {
    priority: TicketPriority.URGENT,
    customerTier: null,
    channel: null,
    firstResponseHours: 1,
    resolutionHours: 4,
    escalationChain: [],
  },
  {
    priority: TicketPriority.HIGH,
    customerTier: null,
    channel: null,
    firstResponseHours: 2,
    resolutionHours: 8,
    escalationChain: [],
  },
  {
    priority: TicketPriority.NORMAL,
    customerTier: null,
    channel: null,
    firstResponseHours: 8,
    resolutionHours: 24,
    escalationChain: [],
  },
  {
    priority: TicketPriority.LOW,
    customerTier: null,
    channel: null,
    firstResponseHours: 24,
    resolutionHours: 72,
    escalationChain: [],
  },
];

export interface TicketSlaMatchCandidate {
  priority: TicketPriority;
  customerTier: CustomerTier;
  channel: TicketChannel;
}

/**
 * The best-matching SLA entry for a ticket - most-specific-wins, like a CSS selector: an entry
 * naming both customerTier and channel beats one naming only one, which beats a priority-only
 * wildcard entry. Falls back to the system default policy when the org has none configured.
 * Returns null only if no entry (including the default policy) matches the given priority at
 * all, which cannot happen for DEFAULT_TICKET_SLA_POLICY (it covers every TicketPriority).
 */
export function resolveTicketSlaEntry(
  policy: TicketSlaPolicyEntry[],
  candidate: TicketSlaMatchCandidate,
): TicketSlaPolicyEntry | null {
  const effective = policy.length > 0 ? policy : DEFAULT_TICKET_SLA_POLICY;

  let best: TicketSlaPolicyEntry | null = null;
  let bestScore = -1;
  for (const entry of effective) {
    if (entry.priority !== candidate.priority) continue;

    let score = 1;
    if (entry.customerTier != null) {
      if (entry.customerTier !== candidate.customerTier) continue;
      score += 1;
    }
    if (entry.channel != null) {
      if (entry.channel !== candidate.channel) continue;
      score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best;
}

export type TicketSlaTargetKind = 'firstResponse' | 'resolution';

function targetHoursOf(entry: TicketSlaPolicyEntry, kind: TicketSlaTargetKind): number {
  return kind === 'firstResponse' ? entry.firstResponseHours : entry.resolutionHours;
}

/** Whether `elapsedBusinessMs` (business-hours-aware, paused-time-excluded elapsed time - see
 * calculateElapsedBusinessMs) has passed the entry's target for `kind`. Pure: the caller supplies
 * the already-computed elapsed time rather than this function reasoning about calendars/clocks
 * itself. */
export function isTicketSlaBreached(
  kind: TicketSlaTargetKind,
  entry: TicketSlaPolicyEntry,
  elapsedBusinessMs: number,
): boolean {
  return elapsedBusinessMs > targetHoursOf(entry, kind) * 60 * 60 * 1000;
}

/** Whether a ticket is inside the pre-breach escalation window for `kind` - at or past
 * (target - leadHours) but not yet actually breached. Used by the "about to breach" scheduled
 * check, distinct from the hard-breach check above so both can fire independently and exactly
 * once each (see Ticket.slaEscalatedAt / Ticket.slaBreachNotifiedAt). */
export function isTicketSlaApproachingBreach(
  kind: TicketSlaTargetKind,
  entry: TicketSlaPolicyEntry,
  elapsedBusinessMs: number,
  leadHours: number,
): boolean {
  const targetMs = targetHoursOf(entry, kind) * 60 * 60 * 1000;
  const leadMs = leadHours * 60 * 60 * 1000;
  return elapsedBusinessMs >= targetMs - leadMs && elapsedBusinessMs < targetMs;
}
