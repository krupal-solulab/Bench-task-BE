export enum IssueType {
  EPIC = 'Epic',
  STORY = 'Story',
  TASK = 'Task',
  BUG = 'Bug',
  SUBTASK = 'Sub-task',
}

/** Story/Task/Bug are the "standard issue" level - the only level a Sprint or Epic-link can attach to. */
export const STANDARD_ISSUE_TYPES = [IssueType.STORY, IssueType.TASK, IssueType.BUG] as const;
