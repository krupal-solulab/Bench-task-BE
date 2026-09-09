import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AppConfig } from '../config/configuration';
import { UsersModule } from '../modules/users/users.module';
import { OrganizationsModule } from '../modules/organizations/organizations.module';
import { ProjectsModule } from '../modules/projects/projects.module';
import { EventsGateway } from './events.gateway';

// Registers its own JwtModule (mirroring AuthModule's) rather than importing AuthModule, since
// AuthModule only exports AuthService - this keeps EventsModule's dependency surface to exactly
// what handshake auth needs (JwtService, UsersService, OrganizationsService) plus ProjectsService
// for the join:project room check.
@Module({
  imports: [
    UsersModule,
    OrganizationsModule,
    ProjectsModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => ({
        secret: configService.get('jwt.accessSecret', { infer: true }),
      }),
    }),
  ],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
