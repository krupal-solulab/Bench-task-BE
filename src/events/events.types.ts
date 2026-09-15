export interface TaskStatusChangedEvent {
  taskId: string;
  projectId: string;
  fromStatus: string;
  toStatus: string;
  actorId: string;
}

export interface CommentCreatedEvent {
  taskId: string;
  projectId: string;
  commentId: string;
  authorId: string;
}
