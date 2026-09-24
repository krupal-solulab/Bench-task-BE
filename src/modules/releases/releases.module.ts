import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProjectsModule } from '../projects/projects.module';
import { Task, TaskSchema } from '../tasks/schemas/task.schema';
import { Release, ReleaseSchema } from './schemas/release.schema';
import { ReleasesRepository } from './releases.repository';
import { ReleasesService } from './releases.service';
import { ReleasesController } from './releases.controller';

// Registers Task's schema directly (rather than importing TasksModule) for the same reason
// SprintsModule does - TasksModule needs ReleasesService to validate fixVersions/affectsVersions,
// so the dependency must run one-directionally (Tasks -> Releases), not the other way around.
@Module({
  imports: [
    ProjectsModule,
    MongooseModule.forFeature([
      { name: Release.name, schema: ReleaseSchema },
      { name: Task.name, schema: TaskSchema },
    ]),
  ],
  controllers: [ReleasesController],
  providers: [ReleasesRepository, ReleasesService],
  exports: [ReleasesService],
})
export class ReleasesModule {}
