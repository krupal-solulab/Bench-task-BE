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
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { SprintsService } from './sprints.service';
import { CreateSprintDto } from './dto/create-sprint.dto';
import { UpdateSprintDto } from './dto/update-sprint.dto';
import { ListSprintsDto } from './dto/list-sprints.dto';

@ApiTags('sprints')
@ApiBearerAuth()
@Controller('projects/:projectId/sprints')
export class SprintsController {
  constructor(private readonly sprintsService: SprintsService) {}

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
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
  @Roles(Role.ADMIN, Role.MANAGER)
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
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Start a Planned sprint (409 if another sprint is already Active)' })
  async start(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('sprintId', ParseObjectIdPipe) sprintId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sprintsService.start(projectId, sprintId, user);
  }

  @Post(':sprintId/complete')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Complete an Active sprint (moves incomplete tasks back to backlog)' })
  async complete(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('sprintId', ParseObjectIdPipe) sprintId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sprintsService.complete(projectId, sprintId, user);
  }

  @Delete(':sprintId')
  @Roles(Role.ADMIN, Role.MANAGER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a Planned sprint (409 if Active or Completed)' })
  async remove(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('sprintId', ParseObjectIdPipe) sprintId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.sprintsService.remove(projectId, sprintId, user);
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
