import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { IssueType, IssueTypeLevel } from '../../../common/enums/issue-type.enum';

/** Fixed icon allow-list (lucide-react icon names) - the frontend maps these to actual icon
 * components, so only known-renderable names are ever accepted. */
export const ISSUE_TYPE_ICONS = [
  'Zap',
  'Bookmark',
  'CheckSquare',
  'Bug',
  'ListChecks',
  'Flag',
  'Star',
  'AlertCircle',
  'Layers',
  'Wrench',
] as const;
export type IssueTypeIcon = (typeof ISSUE_TYPE_ICONS)[number];

/** Fixed color palette keys - same "named palette, not free hex" convention as
 * STATUS_COLORS/PRIORITY_COLORS on the frontend. */
export const ISSUE_TYPE_COLORS = [
  'slate',
  'blue',
  'green',
  'amber',
  'red',
  'purple',
  'pink',
  'cyan',
] as const;
export type IssueTypeColor = (typeof ISSUE_TYPE_COLORS)[number];

@Schema({ _id: false })
export class IssueTypeDefinition {
  // Identity - what Task.issueType stores. Epic/Sub-task rows are validated (see
  // ProjectsService.updateIssueTypes) to always be exactly "Epic"/"Sub-task"; Standard-level
  // names are freely chosen by the Org Admin (the BRD's "extensible" level).
  @Prop({ required: true, trim: true, minlength: 1, maxlength: 40 })
  name!: string;

  @Prop({ type: String, enum: IssueTypeLevel, required: true })
  level!: IssueTypeLevel;

  @Prop({ type: String, enum: ISSUE_TYPE_ICONS, required: true })
  icon!: IssueTypeIcon;

  @Prop({ type: String, enum: ISSUE_TYPE_COLORS, required: true })
  color!: IssueTypeColor;
}

export const IssueTypeDefinitionSchema = SchemaFactory.createForClass(IssueTypeDefinition);

/**
 * The 5 built-in issue types with their current levels and a sensible default icon/color each -
 * used for every project whose `issueTypes` array is empty (i.e. every pre-existing project, and
 * any new one that never opens the Issue Types settings), so nothing changes for anyone who
 * doesn't deliberately opt in to customizing this.
 */
export const DEFAULT_ISSUE_TYPES: IssueTypeDefinition[] = [
  { name: IssueType.EPIC, level: IssueTypeLevel.EPIC, icon: 'Zap', color: 'purple' },
  { name: IssueType.STORY, level: IssueTypeLevel.STANDARD, icon: 'Bookmark', color: 'green' },
  { name: IssueType.TASK, level: IssueTypeLevel.STANDARD, icon: 'CheckSquare', color: 'blue' },
  { name: IssueType.BUG, level: IssueTypeLevel.STANDARD, icon: 'Bug', color: 'red' },
  { name: IssueType.SUBTASK, level: IssueTypeLevel.SUBTASK, icon: 'ListChecks', color: 'slate' },
];

export interface IssueTypesCarrier {
  issueTypes?: IssueTypeDefinition[];
}

/** A project's effective issue types - its own custom set, or the system defaults when unset. */
export function resolveIssueTypes(project: IssueTypesCarrier): IssueTypeDefinition[] {
  return project.issueTypes && project.issueTypes.length > 0
    ? project.issueTypes
    : DEFAULT_ISSUE_TYPES;
}
