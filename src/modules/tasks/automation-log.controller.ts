import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { TasksService } from './tasks.service';

/** BRD 8's automation audit trail - "which rule fired, when, on which issue," queryable
 * project-wide. A separate controller (rather than a route on TasksController) since its path is
 * project-scoped (`projects/:projectId/automation-log`), matching SprintsController's own
 * `projects/:projectId/sprints` convention. Lives in TasksModule (not ProjectsModule) since it
 * reads from TasksService/the AutomationExecutionLog collection that module owns - importing
 * TasksModule back into ProjectsModule would be a circular module dependency (TasksModule already
 * imports ProjectsModule). */
@ApiTags('automation-log')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.MANAGER)
@Controller('projects/:projectId/automation-log')
export class AutomationLogController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  @ApiOperation({ summary: 'Paginated automation-rule execution history for a project' })
  async list(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.listAutomationLog(projectId, query.page, query.limit, user);
  }
}
