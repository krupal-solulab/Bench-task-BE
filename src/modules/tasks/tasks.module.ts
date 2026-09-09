import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProjectsModule } from '../projects/projects.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { Task, TaskSchema } from './schemas/task.schema';
import { TaskActivity, TaskActivitySchema } from './schemas/task-activity.schema';
import { TasksRepository } from './tasks.repository';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { TasksDueDateReminderService } from './tasks-due-date-reminder.service';

@Module({
  imports: [
    ProjectsModule,
    NotificationsModule,
    MongooseModule.forFeature([
      { name: Task.name, schema: TaskSchema },
      { name: TaskActivity.name, schema: TaskActivitySchema },
    ]),
  ],
  controllers: [TasksController],
  providers: [TasksRepository, TasksService, TasksDueDateReminderService],
  exports: [TasksService, TasksRepository, MongooseModule],
})
export class TasksModule {}
