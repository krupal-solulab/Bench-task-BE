import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module';
import { ProjectsModule } from '../projects/projects.module';
import { UsersModule } from '../users/users.module';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';

/** Standalone, like PermissionSchemesModule/IssueLinksModule: imports the three modules it needs
 * one-directionally (none of them need to import this back), so it's registered directly in
 * app.module.ts rather than nested under any of them. */
@Module({
  imports: [TasksModule, ProjectsModule, UsersModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
