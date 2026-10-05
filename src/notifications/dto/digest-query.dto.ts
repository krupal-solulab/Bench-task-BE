import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

/** Module 11 gap-closure: which period the in-app digest covers. */
export class DigestQueryDto {
  @ApiPropertyOptional({ enum: ['daily', 'weekly'], default: 'daily' })
  @IsOptional()
  @IsIn(['daily', 'weekly'])
  period: 'daily' | 'weekly' = 'daily';
}
