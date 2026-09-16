import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IssueTypeLevel } from '../../../common/enums/issue-type.enum';
import { ISSUE_TYPE_COLORS, ISSUE_TYPE_ICONS } from '../schemas/issue-type.schema';

export class IssueTypeDefinitionDto {
  @ApiProperty({ example: 'Chore' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;

  @ApiProperty({ enum: IssueTypeLevel })
  @IsEnum(IssueTypeLevel)
  level!: IssueTypeLevel;

  @ApiProperty({ enum: ISSUE_TYPE_ICONS })
  @IsIn(ISSUE_TYPE_ICONS)
  icon!: (typeof ISSUE_TYPE_ICONS)[number];

  @ApiProperty({ enum: ISSUE_TYPE_COLORS })
  @IsIn(ISSUE_TYPE_COLORS)
  color!: (typeof ISSUE_TYPE_COLORS)[number];
}

export class PutIssueTypesDto {
  @ApiProperty({ type: [IssueTypeDefinitionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => IssueTypeDefinitionDto)
  issueTypes!: IssueTypeDefinitionDto[];
}
