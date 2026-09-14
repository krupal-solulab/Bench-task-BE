import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { SprintStatus } from '../../../common/enums/sprint-status.enum';

const toArray = ({ value }: { value: unknown }) =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

export class ListSprintsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SprintStatus, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsEnum(SprintStatus, { each: true })
  status?: SprintStatus[];
}
