import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SecurityLevelDto } from './security-level.dto';

export class CreateSecuritySchemeDto {
  @ApiProperty({ example: 'Standard confidentiality levels' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ type: [SecurityLevelDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SecurityLevelDto)
  levels!: SecurityLevelDto[];
}
