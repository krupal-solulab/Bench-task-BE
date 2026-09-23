import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ORG_ROLES } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ListTicketsDto } from './dto/list-tickets.dto';
import { UpdateTicketStatusDto } from './dto/update-ticket-status.dto';
import { UpdateTicketAssigneeDto } from './dto/update-ticket-assignee.dto';
import { UpdateTicketPriorityDto } from './dto/update-ticket-priority.dto';
import { AddTicketCommentDto } from './dto/add-ticket-comment.dto';

@ApiTags('tickets')
@ApiBearerAuth()
@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post()
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Create a ticket (staff-filed, on behalf of a customer)' })
  async create(@Body() dto: CreateTicketDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'List tickets (org-scoped, filterable)' })
  async list(@Query() query: ListTicketsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.paginate(query, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single ticket' })
  async get(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.getActiveOrThrow(id, user);
  }

  @Patch(':id/status')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Change a ticket status' })
  async updateStatus(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateTicketStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ticketsService.updateStatus(id, dto, user);
  }

  @Patch(':id/assignee')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Assign or unassign a ticket' })
  async assign(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateTicketAssigneeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ticketsService.assign(id, dto, user);
  }

  @Patch(':id/priority')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Change a ticket priority' })
  async updatePriority(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateTicketPriorityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ticketsService.updatePriority(id, dto, user);
  }

  @Post(':id/apply-macro/:macroId')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Apply a stored Macro action bundle to a ticket' })
  async applyMacro(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('macroId') macroId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ticketsService.applyMacro(id, macroId, user);
  }

  @Post(':id/comments')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Add a reply or internal note to a ticket' })
  async addComment(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AddTicketCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ticketsService.addComment(id, dto, user);
  }

  @Get(':id/comments')
  @ApiOperation({ summary: "A ticket's comment thread (replies and internal notes)" })
  async listComments(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ticketsService.listComments(id, user);
  }

  @Get(':id/activity')
  @ApiOperation({ summary: "A ticket's activity log" })
  async listActivity(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ticketsService.listActivity(id, user);
  }
}
