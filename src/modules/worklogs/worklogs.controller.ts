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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { WorkLogsService } from './worklogs.service';
import { CreateWorkLogDto } from './dto/create-work-log.dto';
import { UpdateWorkLogDto } from './dto/update-work-log.dto';
import { ListWorkLogsDto } from './dto/list-work-logs.dto';
import { WorkLogReportQueryDto } from './dto/work-log-report-query.dto';

/**
 * Module 3's Time Tracking & Work Logs. One controller spanning three path shapes - mirrors
 * CommentsController's own `tasks/:taskId/comments` + `comments/:id` split, extended with the
 * project-wide timesheet views (`projects/:id/worklogs[/report]`).
 */
@ApiTags('worklogs')
@ApiBearerAuth()
@Controller()
export class WorkLogsController {
  constructor(private readonly worklogsService: WorkLogsService) {}

  @Post('tasks/:taskId/worklogs')
  @ApiOperation({ summary: 'Log hours against a task (project members only, logs as yourself)' })
  async create(
    @Param('taskId', ParseObjectIdPipe) taskId: string,
    @Body() dto: CreateWorkLogDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.worklogsService.create(taskId, dto, user);
  }

  @Get('tasks/:taskId/worklogs')
  @ApiOperation({ summary: "List a task's work logs (paginated, newest work date first)" })
  async list(
    @Param('taskId', ParseObjectIdPipe) taskId: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.worklogsService.paginateForTask(
      taskId,
      { page: query.page, limit: query.limit, sortOrder: query.sortOrder },
      user,
    );
  }

  @Get('tasks/:taskId/worklogs/summary')
  @ApiOperation({ summary: 'Original estimate vs. total logged hours for a task' })
  async summary(
    @Param('taskId', ParseObjectIdPipe) taskId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.worklogsService.summaryForTask(taskId, user);
  }

  @Patch('worklogs/:id')
  @ApiOperation({ summary: 'Edit your own work log (Admin may edit any)' })
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateWorkLogDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.worklogsService.update(id, dto, user);
  }

  @Delete('worklogs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete your own work log (Admin may delete any)' })
  async remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.worklogsService.remove(id, user);
  }

  @Get('projects/:id/worklogs')
  @ApiOperation({
    summary: "A project's raw timesheet - every work log, filterable by user/date range/billable",
  })
  async listForProject(
    @Param('id', ParseObjectIdPipe) projectId: string,
    @Query() query: ListWorkLogsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.worklogsService.paginateForProject(projectId, query, user);
  }

  @Get('projects/:id/worklogs/report')
  @ApiOperation({ summary: 'Per-user totals for a project (the timesheet report)' })
  async reportForProject(
    @Param('id', ParseObjectIdPipe) projectId: string,
    @Query() query: WorkLogReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.worklogsService.reportForProject(projectId, query, user);
  }
}
