import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

export class DashboardScopeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsObjectId()
  projectId?: string;
}

export class TaskTrendQueryDto extends DashboardScopeDto {
  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  days?: number = 30;
}

const WORKLOAD_SORT = ['workload', 'completionRate', 'name'] as const;

export class DeveloperWorkloadQueryDto extends DashboardScopeDto {
  @ApiPropertyOptional({ enum: WORKLOAD_SORT, default: 'workload' })
  @IsOptional()
  @IsIn(WORKLOAD_SORT)
  sortBy: (typeof WORKLOAD_SORT)[number] = 'workload';
}
