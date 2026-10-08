import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { Organization, OrganizationSchema } from '../organizations/schemas/organization.schema';
import {
  ProjectInvite,
  ProjectInviteSchema,
} from '../project-invites/schemas/project-invite.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { CustomRole, CustomRoleSchema } from './schemas/custom-role.schema';
import { CustomRolesController } from './custom-roles.controller';
import { CustomRolesService } from './custom-roles.service';

// Registers the User/Organization/ProjectInvite models directly (instead of importing their
// modules) so Users, Auth and ProjectInvites can all import this module without a cycle.
@Module({
  imports: [
    AuditLogModule,
    MongooseModule.forFeature([
      { name: CustomRole.name, schema: CustomRoleSchema },
      { name: User.name, schema: UserSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: ProjectInvite.name, schema: ProjectInviteSchema },
    ]),
  ],
  controllers: [CustomRolesController],
  providers: [CustomRolesService],
  exports: [CustomRolesService],
})
export class CustomRolesModule {}
