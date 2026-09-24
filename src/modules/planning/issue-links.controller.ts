import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ORG_ROLES } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { IssueLinksService } from './issue-links.service';
import { CreateIssueLinkDto } from './dto/create-issue-link.dto';

/**
 * Module 1's issue-to-issue links. A separate controller (rather than routes on TasksController),
 * mirroring AutomationLogController's own "lives in a different module to dodge a circular import"
 * shape - PlanningModule depends on TasksModule, so TasksModule can't depend back on it. The
 * 3-segment path (`tasks/:taskId/links`) also can't collide with TasksController's `tasks/:id`,
 * regardless of module registration order, since Express/Nest route matching keys on segment
 * count/shape (see this codebase's other 3-segment sub-resource routes for the same reasoning).
 */
@ApiTags('tasks')
@ApiBearerAuth()
@Controller('tasks/:taskId/links')
export class IssueLinksController {
  constructor(private readonly issueLinksService: IssueLinksService) {}

  @Post()
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Link this task to another (blocks/relates to/duplicates/...)' })
  async create(
    @Param('taskId', ParseObjectIdPipe) taskId: string,
    @Body() dto: CreateIssueLinkDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.issueLinksService.createLink(taskId, dto, user);
  }

  @Get()
  @ApiOperation({ summary: "A task's links, resolved to the correct name/inverseName per side" })
  async list(
    @Param('taskId', ParseObjectIdPipe) taskId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.issueLinksService.listLinks(taskId, user);
  }

  @Delete(':linkId')
  @Roles(...ORG_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a link' })
  async remove(
    @Param('taskId', ParseObjectIdPipe) taskId: string,
    @Param('linkId', ParseObjectIdPipe) linkId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.issueLinksService.deleteLink(taskId, linkId, user);
  }
}
