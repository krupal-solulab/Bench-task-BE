import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { DashboardService } from './dashboard.service';
import {
  DashboardScopeDto,
  DeveloperWorkloadQueryDto,
  TaskTrendQueryDto,
} from './dto/dashboard-scope.dto';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Top stat cards (role-scoped, cached)' })
  async summary(
    @Query() query: DashboardScopeDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { data, hit } = await this.dashboardService.summary(query.projectId, user);
    this.setCacheHeader(res, hit);
    return data;
  }

  @Get('projects-by-status')
  @ApiOperation({ summary: 'Projects grouped by status, zero-filled' })
  async projectsByStatus(
    @Query() query: DashboardScopeDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { data, hit } = await this.dashboardService.projectsByStatus(query.projectId, user);
    this.setCacheHeader(res, hit);
    return data;
  }

  @Get('tasks-status')
  @ApiOperation({ summary: 'Open vs completed task breakdown' })
  async tasksStatus(
    @Query() query: DashboardScopeDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { data, hit } = await this.dashboardService.tasksStatus(query.projectId, user);
    this.setCacheHeader(res, hit);
    return data;
  }

  @Get('tasks-by-priority')
  @ApiOperation({ summary: 'Task counts by priority, zero-filled' })
  async tasksByPriority(
    @Query() query: DashboardScopeDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { data, hit } = await this.dashboardService.tasksByPriority(query.projectId, user);
    this.setCacheHeader(res, hit);
    return data;
  }

  @Get('developer-workload')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Per-developer task distribution and completion rate' })
  async developerWorkload(
    @Query() query: DeveloperWorkloadQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { data, hit } = await this.dashboardService.developerWorkload(query, user);
    this.setCacheHeader(res, hit);
    return data;
  }

  @Get('overdue-summary')
  @ApiOperation({ summary: 'Overdue tasks list' })
  async overdueSummary(
    @Query() query: DashboardScopeDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { data, hit } = await this.dashboardService.overdueSummary(query.projectId, user);
    this.setCacheHeader(res, hit);
    return data;
  }

  @Get('task-trend')
  @ApiOperation({ summary: 'Created vs completed tasks per day' })
  async taskTrend(
    @Query() query: TaskTrendQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { data, hit } = await this.dashboardService.taskTrend(
      query.days ?? 30,
      query.projectId,
      user,
    );
    this.setCacheHeader(res, hit);
    return data;
  }

  private setCacheHeader(res: Response, hit: boolean): void {
    res.setHeader('X-Cache', hit ? 'HIT' : 'MISS');
  }
}
