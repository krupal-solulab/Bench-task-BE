import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { PlatformOnly } from '../../common/decorators/platform-only.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { Role } from '../../common/enums/role.enum';
import { ApiLogsService } from './api-logs.service';
import { ListApiLogsDto } from './dto/list-api-logs.dto';

@ApiTags('platform')
@ApiBearerAuth()
@Roles(Role.PLATFORM_ADMIN)
@PlatformOnly()
@Controller('platform/logs')
export class ApiLogsController {
  constructor(private readonly apiLogsService: ApiLogsService) {}

  @Get()
  @ApiOperation({
    summary: 'Paginated API request log, filterable by organization/status/method/path/date',
  })
  async list(@Query() query: ListApiLogsDto) {
    return this.apiLogsService.paginate(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One API log entry with its (redacted, size-capped) request/response payload',
  })
  async getOne(@Param('id', ParseObjectIdPipe) id: string) {
    return this.apiLogsService.getById(id);
  }
}
