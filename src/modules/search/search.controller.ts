import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { SearchService } from './search.service';
import { GlobalSearchQueryDto } from './dto/global-search-query.dto';

@ApiTags('search')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({ summary: 'Module 11: search tasks, projects, and users in one call' })
  async search(@Query() query: GlobalSearchQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.searchService.searchAll(query.q, query.limit, user);
  }
}
