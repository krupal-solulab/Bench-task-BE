import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { TaskPriority } from '../../../common/enums/task-priority.enum';

@Schema({ _id: false })
export class SlaPolicyEntry {
  @Prop({ type: String, enum: TaskPriority, required: true })
  priority!: TaskPriority;

  @Prop({ type: Number, required: true, min: 1, max: 24 * 365 })
  resolutionHours!: number;
}

export const SlaPolicyEntrySchema = SchemaFactory.createForClass(SlaPolicyEntry);

/**
 * System default SLA targets - used for every project whose `slaPolicy` is empty (i.e. every
 * pre-existing project, and any new one that never opens SLA settings), so nothing changes for
 * anyone who doesn't deliberately opt in to a custom policy. Mirrors DEFAULT_WORKFLOW/
 * DEFAULT_ISSUE_TYPES' "hardcoded default + optional per-project override" pattern.
 */
export const DEFAULT_SLA_POLICY: SlaPolicyEntry[] = [
  { priority: TaskPriority.P1, resolutionHours: 8 },
  { priority: TaskPriority.P2, resolutionHours: 24 },
  { priority: TaskPriority.P3, resolutionHours: 72 },
];

export interface SlaPolicyCarrier {
  slaPolicy?: SlaPolicyEntry[];
}

/** A project's effective SLA policy - its own custom one, or the system default. */
export function resolveSlaPolicy(project: SlaPolicyCarrier): SlaPolicyEntry[] {
  return project.slaPolicy && project.slaPolicy.length > 0 ? project.slaPolicy : DEFAULT_SLA_POLICY;
}

/** The resolution-hours target for one priority under a resolved policy, or null if that
 * priority has no applicable target (only possible for a custom policy that omits a priority -
 * the default always covers all three). */
export function slaTargetHours(policy: SlaPolicyEntry[], priority: TaskPriority): number | null {
  return policy.find((p) => p.priority === priority)?.resolutionHours ?? null;
}

export interface SlaTaskSnapshot {
  priority: TaskPriority;
  createdAt: Date;
  completedAt: Date | null;
}

/**
 * Whether a task has breached its SLA target as of `now` - Done tasks are judged by their actual
 * completion time, still-open tasks by whether `now` has already passed the target (so an
 * overdue-but-still-open task correctly counts as breached, not just "not yet compliant"). A
 * priority with no applicable target (see `slaTargetHours`) never counts as breached.
 */
export function isBreached(task: SlaTaskSnapshot, policy: SlaPolicyEntry[], now: Date): boolean {
  const hours = slaTargetHours(policy, task.priority);
  if (hours == null) return false;
  const targetMs = task.createdAt.getTime() + hours * 60 * 60 * 1000;
  const endMs = (task.completedAt ?? now).getTime();
  return endMs > targetMs;
}

/** Hours between createdAt and completedAt - null for a task that isn't Done yet (resolution
 * time is only meaningful once resolved). */
export function resolutionHoursOf(task: SlaTaskSnapshot): number | null {
  if (!task.completedAt) return null;
  return (task.completedAt.getTime() - task.createdAt.getTime()) / (60 * 60 * 1000);
}
