import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProjectsModule } from '../projects/projects.module';
import { UsersModule } from '../users/users.module';
import {
  DashboardPreference,
  DashboardPreferenceSchema,
} from './schemas/dashboard-preference.schema';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [
    ProjectsModule,
    UsersModule,
    MongooseModule.forFeature([
      { name: DashboardPreference.name, schema: DashboardPreferenceSchema },
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
