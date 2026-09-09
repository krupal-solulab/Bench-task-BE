import { TaskStatus } from '../common/enums/task-status.enum';

export interface TaskStatusChangedEvent {
  taskId: string;
  projectId: string;
  fromStatus: TaskStatus;
  toStatus: TaskStatus;
  actorId: string;
}

export interface CommentCreatedEvent {
  taskId: string;
  projectId: string;
  commentId: string;
  authorId: string;
}
