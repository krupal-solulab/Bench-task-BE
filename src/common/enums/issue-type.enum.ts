export enum IssueType {
  EPIC = 'Epic',
  STORY = 'Story',
  TASK = 'Task',
  BUG = 'Bug',
  SUBTASK = 'Sub-task',
}

/** Story/Task/Bug are the "standard issue" level - the only level a Sprint or Epic-link can attach to. */
export const STANDARD_ISSUE_TYPES = [IssueType.STORY, IssueType.TASK, IssueType.BUG] as const;

/**
 * The 3-level hierarchy a project's (possibly customized) issue types resolve into - see
 * `resolveIssueTypes()` in `../../modules/projects/schemas/issue-type.schema.ts`. Epic and
 * Sub-task are structurally fixed (always exactly one of each, never renamed); Standard is the
 * BRD's explicitly "extensible" level.
 */
export enum IssueTypeLevel {
  EPIC = 'epic',
  STANDARD = 'standard',
  SUBTASK = 'subtask',
}
