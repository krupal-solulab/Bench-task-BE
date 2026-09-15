import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProjectsModule } from '../projects/projects.module';
import { SprintsModule } from '../sprints/sprints.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { EventsModule } from '../../events/events.module';
import { Comment, CommentSchema } from '../comments/schemas/comment.schema';
import { Task, TaskSchema } from './schemas/task.schema';
import { TaskActivity, TaskActivitySchema } from './schemas/task-activity.schema';
import { TasksRepository } from './tasks.repository';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { TasksDueDateReminderService } from './tasks-due-date-reminder.service';

@Module({
  imports: [
    ProjectsModule,
    SprintsModule,
    NotificationsModule,
    EventsModule,
    MongooseModule.forFeature([
      { name: Task.name, schema: TaskSchema },
      { name: TaskActivity.name, schema: TaskActivitySchema },
      // Registered here too (already registered by CommentsModule) so TasksService can post an
      // automation "Add Comment" action's comment directly, without importing CommentsModule -
      // CommentsModule already imports TasksModule, so that would be a genuine two-way cycle.
      { name: Comment.name, schema: CommentSchema },
    ]),
  ],
  controllers: [TasksController],
  providers: [TasksRepository, TasksService, TasksDueDateReminderService],
  exports: [TasksService, TasksRepository, MongooseModule],
})
export class TasksModule {}
