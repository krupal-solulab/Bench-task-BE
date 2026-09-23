import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { TicketsService } from './tickets.service';
import { PutTicketAutomationRulesDto } from './dto/put-ticket-automation-rules.dto';
import { PutTicketScheduledAutomationsDto } from './dto/put-ticket-scheduled-automations.dto';
import { PutTicketMacrosDto } from './dto/put-ticket-macros.dto';
import { PutTicketSlaPolicyDto } from './dto/put-ticket-sla-policy.dto';
import { PutBusinessHoursCalendarDto } from './dto/put-business-hours-calendar.dto';

/**
 * Ticket-automation-engine settings, all scoped to the caller's OWN organization (no `:id` param -
 * tickets aren't project-scoped, so there's exactly one settings document per org, unlike
 * ProjectsController's per-project `:id/automation-rules` routes). Every path here is 3+ segments
 * (e.g. "tickets/settings/automation-rules"), so none collides with TicketsController's
 * "tickets/:id" (2 segments) despite both controllers sharing the "tickets" prefix.
 */
@ApiTags('tickets')
@ApiBearerAuth()
@Controller('tickets/settings')
export class TicketSettingsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get('automation-rules')
  @ApiOperation({ summary: "This org's ticket Trigger rules" })
  async getAutomationRules(@CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.getAutomationRules(user);
  }

  @Put('automation-rules')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: "Set/replace this org's ticket Trigger rules" })
  async updateAutomationRules(
    @Body() dto: PutTicketAutomationRulesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ticketsService.updateAutomationRules(dto, user);
  }

  @Get('scheduled-automations')
  @ApiOperation({ summary: "This org's time-based ticket Automations" })
  async getScheduledAutomations(@CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.getScheduledAutomations(user);
  }

  @Put('scheduled-automations')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: "Set/replace this org's time-based ticket Automations" })
  async updateScheduledAutomations(
    @Body() dto: PutTicketScheduledAutomationsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ticketsService.updateScheduledAutomations(dto, user);
  }

  @Get('macros')
  @ApiOperation({ summary: 'Macros visible to the caller (team macros + their own personal ones)' })
  async getMacros(@CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.getMacros(user);
  }

  @Put('macros')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: "Set/replace this org's ticket Macros" })
  async updateMacros(@Body() dto: PutTicketMacrosDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.updateMacros(dto, user);
  }

  @Get('sla-policy')
  @ApiOperation({ summary: "This org's Advanced SLA policy" })
  async getSlaPolicy(@CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.getSlaPolicy(user);
  }

  @Put('sla-policy')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: "Set/replace this org's Advanced SLA policy" })
  async updateSlaPolicy(
    @Body() dto: PutTicketSlaPolicyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ticketsService.updateSlaPolicy(dto, user);
  }

  @Get('business-hours')
  @ApiOperation({ summary: "This org's Business Hours calendar (null = 24/7)" })
  async getBusinessHoursCalendar(@CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.getBusinessHoursCalendar(user);
  }

  @Put('business-hours')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: "Set/replace this org's Business Hours calendar" })
  async updateBusinessHoursCalendar(
    @Body() dto: PutBusinessHoursCalendarDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ticketsService.updateBusinessHoursCalendar(dto, user);
  }
}
