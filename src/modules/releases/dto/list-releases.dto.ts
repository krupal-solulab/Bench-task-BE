import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ReleaseStatus } from '../../../common/enums/release-status.enum';

const toArray = ({ value }: { value: unknown }) =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

export class ListReleasesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ReleaseStatus, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsEnum(ReleaseStatus, { each: true })
  status?: ReleaseStatus[];
}
