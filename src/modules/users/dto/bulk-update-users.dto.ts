import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn } from 'class-validator';
import { ORG_ROLES, OrgRole } from '../../../common/enums/role.enum';
import { IsObjectId } from '../../../common/validators/is-object-id.validator';

// Module 8 gap-closure: bulk user actions on the Admin Users page.
class BulkUserIdsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsObjectId({ each: true })
  userIds!: string[];
}

export class BulkUpdateRoleDto extends BulkUserIdsDto {
  @ApiProperty({ enum: ORG_ROLES })
  @IsIn(ORG_ROLES)
  role!: OrgRole;
}

export class BulkUpdateStatusDto extends BulkUserIdsDto {
  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;
}

export interface BulkUserResult {
  succeeded: string[];
  failed: Array<{ userId: string; message: string }>;
}
