import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { ListTasksDto } from './dto/list-tasks.dto';
import { TasksService } from './tasks.service';

/**
 * GET projects/:id/tasks - the project page's own List/Board source. Served from TasksModule (it
 * used to live in ProjectsController) so it applies the same issue security-level exclusion and
 * field-level redaction as GET /tasks; ProjectsModule can't depend on TasksService (that would be
 * circular). Same path, same query parameters and response shape as before.
 */
@ApiTags('projects')
@ApiBearerAuth()
@Controller('projects')
export class ProjectTasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get(':id/tasks')
  @ApiOperation({ summary: 'List tasks for a project (pre-scoped, same filters as /tasks)' })
  async listTasks(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: ListTasksDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.listTasksForProject(id, query, user);
  }
}
