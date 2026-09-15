import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SavedFilter, SavedFilterSchema } from './schemas/saved-filter.schema';
import { SavedFiltersRepository } from './saved-filters.repository';
import { SavedFiltersService } from './saved-filters.service';
import { SavedFiltersController } from './saved-filters.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: SavedFilter.name, schema: SavedFilterSchema }])],
  controllers: [SavedFiltersController],
  providers: [SavedFiltersRepository, SavedFiltersService],
  exports: [SavedFiltersService],
})
export class SavedFiltersModule {}
