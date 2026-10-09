import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsModule } from '../../notifications/notifications.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CustomRolesModule } from '../custom-roles/custom-roles.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ProjectsModule } from '../projects/projects.module';
import { UsersModule } from '../users/users.module';
import { ProjectInvite, ProjectInviteSchema } from './schemas/project-invite.schema';
import { ProjectInvitesController } from './project-invites.controller';
import { OrganizationInvitesController } from './organization-invites.controller';
import { ProjectInvitesService } from './project-invites.service';

@Module({
  imports: [
    ProjectsModule,
    UsersModule,
    OrganizationsModule,
    NotificationsModule,
    AuditLogModule,
    CustomRolesModule,
    MongooseModule.forFeature([{ name: ProjectInvite.name, schema: ProjectInviteSchema }]),
  ],
  controllers: [ProjectInvitesController, OrganizationInvitesController],
  providers: [ProjectInvitesService],
  // AuthModule uses it for the public accept-invite routes and invite sign-in on the login form.
  exports: [ProjectInvitesService],
})
export class ProjectInvitesModule {}
