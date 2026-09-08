import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { OrganizationStatus } from '../../../common/enums/organization-status.enum';

export class UpdateOrganizationStatusDto {
  @ApiProperty({ enum: OrganizationStatus })
  @IsEnum(OrganizationStatus)
  status!: OrganizationStatus;
}
