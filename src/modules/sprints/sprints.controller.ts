import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ORG_ROLES } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { SprintsService } from './sprints.service';
import { CreateSprintDto } from './dto/create-sprint.dto';
import { UpdateSprintDto } from './dto/update-sprint.dto';
import { CompleteSprintDto } from './dto/complete-sprint.dto';
import { ListSprintsDto } from './dto/list-sprints.dto';

@ApiTags('sprints')
@ApiBearerAuth()
@Controller('projects/:projectId/sprints')
export class SprintsController {
  constructor(private readonly sprintsService: SprintsService) {}

  @Post()
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Create a sprint under a project' })
  async create(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Body() dto: CreateSprintDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sprintsService.create(projectId, dto, user);
  }

  @Get()
  @ApiOperation({ summary: "List a project's sprints" })
  async list(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Query() query: ListSprintsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sprintsService.paginate(projectId, query, user);
  }

  @Get('active')
  @ApiOperation({ summary: "The project's single Active sprint, or null" })
  async active(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sprintsService.findActive(projectId, user);
  }

  // Registered before ':sprintId' so "velocity" is never matched as a sprint id.
  @Get('velocity')
  @ApiOperation({
    summary: 'Story points/issue count completed per sprint, for the last N completed sprints',
  })
  async velocity(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Query('limit') limit: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sprintsService.velocity(projectId, user, limit ? Number(limit) : undefined);
  }

  // Registered before ':sprintId' so "history" is never matched as a sprint id (same gotcha as
  // "velocity" above).
  @Get('history')
  @ApiOperation({ summary: 'Every past (Completed) sprint, with date range/goal/completion rate' })
  async history(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sprintsService.history(projectId, user);
  }

  @Get(':sprintId')
  @ApiOperation({ summary: 'Get a single sprint' })
  async findOne(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('sprintId', ParseObjectIdPipe) sprintId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sprintsService.findOneScoped(projectId, sprintId, user);
  }

  @Patch(':sprintId')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Update sprint name/goal/dates' })
  async update(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('sprintId', ParseObjectIdPipe) sprintId: string,
    @Body() dto: UpdateSprintDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sprintsService.update(projectId, sprintId, dto, user);
  }

  @Post(':sprintId/start')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Start a Planned sprint (409 if another sprint is already Active)' })
  async start(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('sprintId', ParseObjectIdPipe) sprintId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sprintsService.start(projectId, sprintId, user);
  }

  @Post(':sprintId/complete')
  @Roles(...ORG_ROLES)
  @ApiOperation({
    summary:
      'Complete an Active sprint (moves incomplete tasks to the backlog, or a chosen next sprint)',
  })
  async complete(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('sprintId', ParseObjectIdPipe) sprintId: string,
    @Body() dto: CompleteSprintDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sprintsService.complete(projectId, sprintId, dto, user);
  }

  @Delete(':sprintId')
  @Roles(...ORG_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a Planned sprint (409 if Active or Completed)' })
  async remove(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('sprintId', ParseObjectIdPipe) sprintId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.sprintsService.remove(projectId, sprintId, user);
  }

  @Get(':sprintId/burndown')
  @ApiOperation({
    summary: 'Remaining work per day vs. an ideal trend line for a sprint (empty if never started)',
  })
  async burndown(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('sprintId', ParseObjectIdPipe) sprintId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sprintsService.burndown(projectId, sprintId, user);
  }

  @Get(':sprintId/activity')
  @ApiOperation({ summary: 'Paginated audit trail for a sprint' })
  async activity(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('sprintId', ParseObjectIdPipe) sprintId: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sprintsService.listActivity(projectId, sprintId, query.page, query.limit, user);
  }
}
