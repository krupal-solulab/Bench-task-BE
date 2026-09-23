import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { TicketsService } from './tickets.service';

/**
 * BRD 3.3's ticket automation audit trail - "which rule fired, when, on which ticket," queryable
 * org-wide, mirroring AutomationLogController's own shape. Kept as its own controller (rather than
 * a route on TicketsController) for the same route-ordering reason AutomationLogController lives
 * on a project-scoped path rather than "projects/automation-log": a literal 2-segment
 * "tickets/automation-log" would be the exact same shape as "tickets/:id" and risks colliding with
 * it depending on controller registration order, so this path goes one level deeper under the
 * settings namespace instead - never ambiguous with "tickets/:id" regardless of order.
 */
@ApiTags('tickets')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.MANAGER)
@Controller('tickets/settings/automation-log')
export class TicketAutomationLogController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  @ApiOperation({ summary: "This org's ticket automation execution log" })
  async list(@Query() query: PaginationQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.listTicketAutomationLog(query.page, query.limit, user);
  }
}
