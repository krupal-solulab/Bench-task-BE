import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { RoadmapService } from './roadmap.service';
import { RoadmapQueryDto } from './dto/roadmap-query.dto';

/**
 * Module 1's cross-project Roadmap/Timeline. Deliberately `projects/reports/roadmap` (3 literal
 * segments), NOT `projects/roadmap` (2 segments) - the latter would be the exact same shape as
 * ProjectsController's `projects/:id` and risks Nest matching "roadmap" as a project id depending
 * on which module happens to register its routes first (this codebase's known route-collision bug
 * class). A 3-segment literal path can never collide with a 2-segment `:id` route, regardless of
 * registration order.
 */
@ApiTags('projects')
@ApiBearerAuth()
@Controller('projects/reports')
export class RoadmapController {
  constructor(private readonly roadmapService: RoadmapService) {}

  @Get('roadmap')
  @ApiOperation({ summary: 'Cross-project epic roadmap, with capacity and blocking warnings' })
  async get(@Query() query: RoadmapQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.roadmapService.getRoadmap(query, user);
  }
}
