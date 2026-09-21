// BRD 6.3: "PM enables Scrum mode per project (as opposed to plain Kanban)." Scrum is the
// default (see project.schema.ts) so every existing project keeps its current Backlog/Sprint/
// Calendar tabs unless an Admin/PM deliberately switches a project to Kanban.
export enum BoardType {
  KANBAN = 'Kanban',
  SCRUM = 'Scrum',
}
