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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { SharedRoute } from '../common/decorators/shared-route.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { Role } from '../common/enums/role.enum';
import { WorkflowTemplatesService } from './workflow-templates.service';
import { CreateWorkflowTemplateDto } from './dto/create-workflow-template.dto';
import { UpdateWorkflowTemplateDto } from './dto/update-workflow-template.dto';

// The template library is global (not org-scoped) and Platform-Admin-maintained, but every org
// role must be able to browse it too (GET) - so, unlike a normal org route, this whole controller
// is @SharedRoute()'d to opt out of OrganizationScopeGuard's platform/org split; @Roles(PLATFORM_ADMIN)
// on the write routes below still restricts writes to Platform Admins only, via RolesGuard.
@ApiTags('workflow-templates')
@ApiBearerAuth()
@Controller('workflow-templates')
@SharedRoute()
export class WorkflowTemplatesController {
  constructor(private readonly workflowTemplatesService: WorkflowTemplatesService) {}

  @Get()
  @ApiOperation({
    summary:
      'List the Platform-Admin-maintained workflow template library (any authenticated user)',
  })
  async list() {
    return this.workflowTemplatesService.listAll();
  }

  @Post()
  @Roles(Role.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Create a workflow template' })
  async create(@Body() dto: CreateWorkflowTemplateDto) {
    return this.workflowTemplatesService.create(dto);
  }

  @Patch(':id')
  @Roles(Role.PLATFORM_ADMIN)
  @ApiOperation({ summary: "Update a workflow template's name/description/workflow" })
  async update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateWorkflowTemplateDto) {
    return this.workflowTemplatesService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.PLATFORM_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a workflow template' })
  async remove(@Param('id', ParseObjectIdPipe) id: string) {
    await this.workflowTemplatesService.remove(id);
  }
}
