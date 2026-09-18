import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CannedResponse, CannedResponseSchema } from './schemas/canned-response.schema';
import { CannedResponsesRepository } from './canned-responses.repository';
import { CannedResponsesService } from './canned-responses.service';
import { CannedResponsesController } from './canned-responses.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: CannedResponse.name, schema: CannedResponseSchema }]),
  ],
  controllers: [CannedResponsesController],
  providers: [CannedResponsesRepository, CannedResponsesService],
  exports: [CannedResponsesService],
})
export class CannedResponsesModule {}
