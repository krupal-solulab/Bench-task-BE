import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { UsersModule } from '../users/users.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ApiToken, ApiTokenSchema } from './schemas/api-token.schema';
import { ApiTokensService } from './api-tokens.service';
import { ApiTokensController } from './api-tokens.controller';

@Module({
  imports: [
    AuditLogModule,
    UsersModule,
    OrganizationsModule,
    MongooseModule.forFeature([{ name: ApiToken.name, schema: ApiTokenSchema }]),
  ],
  controllers: [ApiTokensController],
  providers: [ApiTokensService],
  // Exported for the global JwtAuthGuard, which authenticates `Bearer pat_...` requests.
  exports: [ApiTokensService],
})
export class ApiTokensModule {}
