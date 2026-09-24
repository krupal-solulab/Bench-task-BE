import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { Roles } from '../../common/decorators/roles.decorator';
import { ORG_ROLES } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { ImportExportService } from './import-export.service';
import { ImportTasksDto } from './dto/import-tasks.dto';

@ApiTags('import-export')
@ApiBearerAuth()
@Controller('projects/:projectId')
export class ImportExportController {
  constructor(private readonly importExportService: ImportExportService) {}

  @Get('tasks/export')
  @ApiOperation({ summary: "A project's tasks as CSV content (Module 5)" })
  async exportTasksCsv(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.importExportService.exportTasksCsv(projectId, user);
  }

  @Post('tasks/import')
  @Roles(...ORG_ROLES)
  @ApiOperation({
    summary: 'Bulk-create tasks from CSV content, per-row success/failure (Module 5)',
  })
  async importTasksCsv(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Body() dto: ImportTasksDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.importExportService.importTasksCsv(projectId, dto, user);
  }

  @Get('backup')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: "A project's configuration + issue snapshot as JSON (Module 5)" })
  async backupProject(
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.importExportService.backupProject(projectId, user);
  }
}
