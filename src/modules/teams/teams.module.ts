import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { Team, TeamSchema } from './schemas/team.schema';
import { TeamsRepository } from './teams.repository';
import { TeamsService } from './teams.service';
import { TeamsController } from './teams.controller';

/** Standalone, like PermissionSchemesModule: no other module has a reason to import it back, so
 * it has no natural "parent" and is registered directly in app.module.ts. */
@Module({
  imports: [UsersModule, MongooseModule.forFeature([{ name: Team.name, schema: TeamSchema }])],
  controllers: [TeamsController],
  providers: [TeamsRepository, TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
