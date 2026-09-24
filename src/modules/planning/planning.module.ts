import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TasksModule } from '../tasks/tasks.module';
import { ProjectsModule } from '../projects/projects.module';
import { SprintsModule } from '../sprints/sprints.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { IssueLink, IssueLinkSchema } from './schemas/issue-link.schema';
import { IssueLinksService } from './issue-links.service';
import { RoadmapService } from './roadmap.service';
import { IssueLinksController } from './issue-links.controller';
import { LinkTypesController } from './link-types.controller';
import { DependencyGraphController } from './dependency-graph.controller';
import { RoadmapController } from './roadmap.controller';

/**
 * Module 1 - Issue Linking, Dependency Graph & Cross-Project Roadmap. A new module (not routes
 * bolted onto TasksModule/ProjectsModule) since it depends on BOTH of them plus
 * OrganizationsModule/SprintsModule - importing it back into any of those would be a circular
 * module dependency, the same "duplicate/isolate rather than cycle" reasoning this codebase
 * already uses for AutomationLogController living outside ProjectsModule.
 */
@Module({
  imports: [
    TasksModule,
    ProjectsModule,
    SprintsModule,
    OrganizationsModule,
    MongooseModule.forFeature([{ name: IssueLink.name, schema: IssueLinkSchema }]),
  ],
  controllers: [
    IssueLinksController,
    LinkTypesController,
    DependencyGraphController,
    RoadmapController,
  ],
  providers: [IssueLinksService, RoadmapService],
  exports: [IssueLinksService, RoadmapService],
})
export class PlanningModule {}
