import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { RoadmapService } from './roadmap.service';

/** Module 1's per-project dependency graph. A separate controller (not a route on
 * ProjectsController) for the same circular-import reason as IssueLinksController - see that
 * file's comment. The 3-segment path (`projects/:id/dependency-graph`) can't collide with
 * ProjectsController's `projects/:id`, regardless of module registration order. */
@ApiTags('projects')
@ApiBearerAuth()
@Controller('projects/:id/dependency-graph')
export class DependencyGraphController {
  constructor(private readonly roadmapService: RoadmapService) {}

  @Get()
  @ApiOperation({ summary: "A project's issue-link dependency graph (nodes + edges)" })
  async get(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.roadmapService.getDependencyGraph(id, user);
  }
}
