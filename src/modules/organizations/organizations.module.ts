import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { Organization, OrganizationSchema } from './schemas/organization.schema';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationsService } from './organizations.service';
import { PlatformOrganizationsController } from './platform-organizations.controller';
import { PlatformStatsController } from './platform-stats.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Organization.name, schema: OrganizationSchema }]),
    UsersModule,
  ],
  controllers: [PlatformOrganizationsController, PlatformStatsController],
  providers: [OrganizationsRepository, OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
