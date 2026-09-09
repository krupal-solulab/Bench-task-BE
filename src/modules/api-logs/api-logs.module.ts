import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ApiLog, ApiLogSchema } from './schemas/api-log.schema';
import { ApiLogsRepository } from './api-logs.repository';
import { ApiLogsService } from './api-logs.service';
import { ApiLogsController } from './api-logs.controller';
import { ApiLogInterceptor } from './api-log.interceptor';

@Module({
  imports: [MongooseModule.forFeature([{ name: ApiLog.name, schema: ApiLogSchema }])],
  controllers: [ApiLogsController],
  providers: [
    ApiLogsRepository,
    ApiLogsService,
    // Registered here (rather than in AppModule.providers) so this module is fully
    // self-contained - Nest applies APP_INTERCEPTOR globally regardless of which module
    // declares it, as long as the module is part of the app's import graph.
    { provide: APP_INTERCEPTOR, useClass: ApiLogInterceptor },
  ],
  exports: [ApiLogsService],
})
export class ApiLogsModule {}
